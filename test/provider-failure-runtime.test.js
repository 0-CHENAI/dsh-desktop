import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, it, expect, vi } from 'vitest'
import { apply } from '@deepseek-ai/dsh-llm-retry'
import { stream } from '@earendil-works/pi-ai/api/openai-completions'

const source = readFileSync('node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'utf8')
const mapping = source.slice(source.indexOf('function mapUsage('), source.indexOf('//#endregion', source.indexOf('async function* toStreamChunks')))
const { mapStopReason, toStreamChunks } = runInNewContext(mapping + '; ({ mapStopReason, toStreamChunks })', {
  isContextOverflow: () => false, isContextWindowExceededError: () => false,
  isQuotaExceededError: text => /quota/i.test(text), QUOTA_EXCEEDED_CODE: 'QUOTA',
  CONTEXT_WINDOW_EXCEEDED_CODE: 'CONTEXT_WINDOW_EXCEEDED', EMPTY_RESPONSE_CODE: 'EMPTY_RESPONSE',
  LlmError: Error, brandString: s => s
})
const empty = { stopReason: 'error', errorMessage: 'An unexpected error occurred.', content: [],
  usage: { input: 0, output: 0, totalTokens: 0 } }

it.each([[401, 'AUTH'], [403, 'FORBIDDEN'], [404, 'INVALID_REQUEST'], [429, 'RATE_LIMIT'], [503, 'SERVER']])(
  'classifies structured HTTP %s and preserves request identity', (status, code) => {
    expect(mapStopReason({ ...empty, errorDetails: { status, requestId: 'req-123' } }).failure)
      .toMatchObject({ code, status, requestId: 'req-123' })
  })
it('retries only unknown failures with no generated content', async () => {
  expect(mapStopReason(empty).failure.code).toBe('PI_AI_EMPTY_ERROR')
  expect(mapStopReason({ ...empty, usage: { ...empty.usage, output: 1 } }).failure.code).toBe('PI_AI_ERROR')
  expect(mapStopReason({ ...empty, content: [{ type: 'toolCall' }] }).failure.code).toBe('PI_AI_ERROR')
  const chunks = []
  for await (const chunk of toStreamChunks([
    { type: 'text_delta', contentIndex: 0, delta: 'partial' },
    { type: 'error', error: empty }
  ])) chunks.push(chunk)
  expect(chunks.at(-1).reason.failure.code).toBe('PI_AI_ERROR')
  expect(mapStopReason({ ...empty, stopReason: 'aborted' }).kind).toBe('aborted')
})

it('retains diagnostics from an actual SDK HTTP rejection without exposing headers', async () => {
  const model = { id: 'test', name: 'test', api: 'openai-completions', provider: 'openai',
    baseUrl: 'https://example.invalid/v1', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 100 }
  const events = []
  for await (const event of stream(model, { messages: [{ role: 'user', content: 'test', timestamp: 0 }] }, {
    apiKey: 'test-key', maxRetries: 0,
    fetch: async () => new Response(JSON.stringify({ error: { message: 'An unexpected error occurred.' } }), {
      status: 503, headers: { 'content-type': 'application/json', 'x-request-id': 'req-503', authorization: 'secret' }
    })
  })) events.push(event)
  const failure = mapStopReason(events.at(-1).error).failure
  expect(failure).toMatchObject({ code: 'SERVER', status: 503, requestId: 'req-503' })
  expect(JSON.stringify(failure)).not.toContain('secret')
})

it('limits unknown empty errors to one durable retry and respects disabled retry budgets', async () => {
  let listener
  let state = {}
  const append = vi.fn()
  apply({ sessionProjections: { register() {}, stateOf: () => state },
    on: (_name, fn) => { listener = fn; return () => {} }, effect() {} })
  const policy = { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE'], maxRetries: 3,
    initialDelayMs: 0, maxDelayMs: 1, jitterRatio: 0 }
  const args = { agent: { session: { append } }, provider: 'order', turn: 1, step: 24,
    failure: { code: 'PI_AI_EMPTY_ERROR', message: 'unknown' }, retryPolicy: policy, signal: new AbortController().signal }
  const next = vi.fn()
  expect(await listener(args, next)).toEqual({ kind: 'retry' })
  const data = append.mock.calls[0][1]
  state = { [JSON.stringify(['order', data.policyKey])]: { retry: 1, retryId: data.retryId } }
  await listener(args, next)
  expect(next).toHaveBeenCalledOnce()
  expect(append.mock.calls.map(c => c[0])).toEqual(['llm/retry', 'llm/retry-started'])
  state = {}
  await listener({ ...args, retryPolicy: { ...policy, maxRetries: 0 } }, next)
  await listener({ ...args, failure: { code: 'AUTH' } }, next)
  expect(append).toHaveBeenCalledTimes(2)
})

it('maps unrecognized codes to localized UI messages', () => {
  const text = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', 'utf8')
  const start = text.indexOf('function failureMessage(')
  const fn = text.slice(start, text.indexOf('\n\t\t}', start) + 4)
  const failureMessage = runInNewContext(fn + '; failureMessage')
  expect(failureMessage('raw gateway response', 'FUTURE_ERROR', key => key)).toBe('message.failure.unknown')
  expect(failureMessage('raw', 'SERVER', key => key)).toBe('message.failure.server')
})

it('does not classify malformed status metadata as a server error', () => {
  expect(mapStopReason({ ...empty, errorDetails: { status: '503', requestId: 'bad\nheader' } }).failure)
    .toEqual({ code: 'PI_AI_EMPTY_ERROR', message: empty.errorMessage })
})
it.each(['text_end', 'thinking_end'])('treats %s as output even when deltas were absent', async type => {
  const chunks = []
  for await (const chunk of toStreamChunks([
    { type, contentIndex: 0, content: 'already generated' },
    { type: 'error', error: empty }
  ])) chunks.push(chunk)
  expect(chunks.at(-1).reason.failure.code).toBe('PI_AI_ERROR')
})
it('retains the successful handshake request ID when the SSE stream fails', async () => {
  const model = { id: 'test', name: 'test', api: 'openai-completions', provider: 'openai',
    baseUrl: 'https://example.invalid/v1', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 100 }
  const events = []
  for await (const event of stream(model, { messages: [{ role: 'user', content: 'test', timestamp: 0 }] }, {
    apiKey: 'test-key', maxRetries: 0,
    fetch: async () => new Response('data: {"error":{"message":"An unexpected error occurred."}}\n\n', {
      status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-sse' }
    })
  })) events.push(event)
  expect(mapStopReason(events.at(-1).error).failure).toMatchObject({ requestId: 'req-sse' })
  expect(mapStopReason(events.at(-1).error).failure.status).toBeUndefined()
})
it('cancels a pending retry without starting another attempt', async () => {
  let listener
  const append = vi.fn()
  const controller = new AbortController()
  apply({ sessionProjections: { register() {}, stateOf: () => ({}) },
    on: (_name, fn) => { listener = fn; return () => {} }, effect() {} })
  const pending = listener({ agent: { session: { append } }, provider: 'order', turn: 1, step: 1,
    failure: { code: 'PI_AI_EMPTY_ERROR', message: 'unknown' },
    retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE'], maxRetries: 3,
      initialDelayMs: 60000, maxDelayMs: 60000, jitterRatio: 0 }, signal: controller.signal }, vi.fn())
  expect(append.mock.calls[0][1].maxRetries).toBe(1)
  controller.abort()
  expect(await pending).toBeUndefined()
  expect(append.mock.calls.map(call => call[0])).toEqual(['llm/retry'])
})
