import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { estimateMessage, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter/estimate'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LlmRuntime, { LlmAdapter, LlmError, createUserMessage, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import * as completions from '@earendil-works/pi-ai/api/openai-completions'
import { createServer } from 'node:http'
import { once } from 'node:events'

// Execute the shipped configuration implementation, not a duplicate formula.
const source = readFileSync('node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js', 'utf8')
const configSource = source.slice(source.indexOf('const DEFAULT_THRESHOLD_RATIO'), source.indexOf('//#region lib/types/summarizer'))
const { resolveConfig, resolveTargetPolicy, resolveCompactSpec } = runInNewContext(
  configSource + '; ({ resolveConfig, resolveTargetPolicy, resolveCompactSpec })', { deepFreeze: value => value })
const policy = config => resolveTargetPolicy(resolveConfig(config), { provider: 'fixture', model: 'small' })

describe('context compaction budgets', () => {
  it.each([8192, 32768, 65536, 131072])('has a usable default pressure budget for a %i window', window => {
    const spec = resolveCompactSpec(policy({}), window, 2048)
    expect(spec.thresholdTokens).toBeGreaterThan(spec.retainTokens)
    expect(spec.thresholdTokens).toBeLessThan(window - 2048)
  })
  it('preserves explicit invalid reservations instead of silently disabling protection', () => {
    expect(() => resolveCompactSpec(policy({ headroomTokens: 65536 }), 32768, 2048)).toThrow(/pressure budget/)
  })
  it('prices Chinese text and tool schemas consistently in the runtime and public estimator', () => {
    const message = { role: 'user', content: [{ type: 'text', text: '中文内容'.repeat(1000) }] }
    expect(estimateMessage(message)).toBeGreaterThanOrEqual(4000)
    expect(TokenMeter.prototype.estimateMessage(message)).toBe(estimateMessage(message))
    expect(estimateToolsTokens({ tools: [{ name: 'tool', description: message.content[0].text }] })).toBeGreaterThanOrEqual(4000)
  })
  it('checks pressure after the complete request is admitted and does not swallow a failure', async () => {
    const listeners = new Map()
    const session = Session.create('budget-test')
    session.append('request/header', { header: { config: { provider: 'fixture', model: 'small', maxTokens: 2048 } }, reason: 'initial' })
    const engine = Object.create(BasicCompactionEngine.prototype)
    Object.assign(engine, {
      ctx: { on: (name, fn) => listeners.set(name, fn), logger: { info() {}, warn() {} },
        tokenMeter: { measure: () => ({ totalTokens: 32000 }) },
        llm: { resolveModelInfo: async () => ({ context: { contextWindow: 32768 }, defaultMaxTokens: 2048 }) } },
      config: resolveConfig({}), overflowRetries: new WeakMap(), overflowAgents: new WeakMap(), warnedPressureConfigTargets: new Set(),
      compactIfNeeded: async () => { throw new Error('summary failed') }
    })
    engine._registerAutomaticCompaction()
    expect(listeners.has('agent/request-ready')).toBe(true)
    expect(listeners.has('agent/pre-step')).toBe(false)
    await expect(listeners.get('agent/request-ready')({ agent: { session }, signal: new AbortController().signal }))
      .rejects.toThrow(/summary failed|context|budget/)
  })
})

async function runtime(config = {}, model = 'small', adapter) {
  const ctx = new Context()
  const fibers = []
  const calls = []
  const endings = []
  ctx.on('session/event', (_session, event) => { if (event.type === 'turn/end') endings.push(event.data.reason) })
  const controls = { failSummary: false, abortSummary: false, invokeTool: false, summaryFailureCode: undefined }
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) {
      return { provider, id, name: id, context: { contextWindow: id === 'large' ? 131072 : 8192 }, defaultMaxTokens: 1024 }
    }
    async *stream(options) {
      calls.push(options)
      if (options.purpose === 'compaction' && controls.abortSummary) ctx.agents.get('compaction-runtime').cancel({ kind: 'user' })
      if (options.purpose === 'compaction' && controls.failSummary) {
        if (controls.summaryFailureCode) throw new LlmError('fixture summary failure', controls.summaryFailureCode)
        throw new Error('fixture summary failure')
      }
      if (options.purpose !== 'compaction' && controls.invokeTool) {
        controls.invokeTool = false
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'fixture-call', name: 'large_result', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const text = options.purpose === 'compaction' ? 'Earlier discussion summary.' : 'Answer.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  for (const plugin of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime, ToolRuntime]) fibers.push(await ctx.plugin(plugin))
  fibers.push(await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }))
  const release = ctx.llm.registerAdapter(['fixture'], adapter ?? new Adapter())
  fibers.push(await ctx.plugin(TokenMeter, {}))
  fibers.push(await ctx.plugin(BasicCompactionEngine, config))
  fibers.push(await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 }))
  const agent = await ctx.agentLoop.create('compaction-runtime', { provider: 'fixture', model })
  return { ctx, agent, calls, controls, endings, async close() { release(); for (const fiber of fibers.reverse()) await fiber.dispose() } }
}

async function send(agent, text) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

// Real LLM adapter, serializer and HTTP/SSE transport. Only model inference is
// synthetic, and every endpoint/credential belongs to this loopback fixture.
async function wireRuntime({ config = {}, effort = 'max', defaultEffort, rejectSummary = false, off = 'off' } = {}) {
  const requests = []
  const instruction = JSON.parse(source.match(/const COMPACTION_INSTRUCTION = \[\s*("[^\n]+"),/)[1])
  const controls = { rejectSummary }
  const server = createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const summary = JSON.stringify(body.messages.at(-1).content).includes(instruction.slice(0, 60))
      requests.push({ body, summary })
      if (body.reasoning_effort === 'off' || summary && controls.rejectSummary) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Invalid request: reasoning_effort must be none, low, high or max' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const content = summary ? 'Earlier discussion summary.' : 'Answer.'
      for (const [delta, finishReason] of [[{ role: 'assistant', content }, null], [{}, 'stop']]) {
        response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0,
          model: body.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`)
      }
      response.end('data: [DONE]\n\n')
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const model = { id: 'small', name: 'Fixture', provider: 'fixture', api: 'openai-completions', baseUrl,
    input: ['text'], reasoning: true, contextWindow: 8192, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    thinkingLevelMap: { ...(off === null ? {} : { off }), high: 'high', max: 'max' },
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false } }
  const models = [model, { ...model, id: 'summary', thinkingLevelMap: { off: null, minimal: null,
    low: 'low', medium: null, high: null, xhigh: null, max: null } }]
  const piProvider = { id: 'fixture', name: 'Fixture', baseUrl, getModels: () => models,
    auth: { apiKey: { name: 'Fixture', resolve: async ({ credential }) => ({ auth: { apiKey: credential.key }, source: 'fixture' }) } },
    stream: completions.stream, streamSimple: completions.streamSimple }
  const profiles = new Map([['fixture', { provider: 'fixture', displayName: 'Fixture', piProvider,
    reasoning: defaultEffort, streamIdleTimeoutMs: 5000, configuredMaxTokens: new Map([['small', 1024], ['summary', 1024]]),
    maxRequestImageBytes: 1024, requestImagePixelBudget: 1024, requestImageMaxBytes: 1024,
    retryPolicy: resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'fixture'), modelErrors: new Map() }]])
  try {
    const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => 'synthetic-only', auth: {} })
    const harness = await runtime(config, 'small', adapter)
    harness.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), reasoningEffort: effort }))
    return { ...harness, requests, wireControls: controls, async close() {
      try { await harness.close() } finally {
        const closed = new Promise(resolve => server.close(resolve))
        server.closeAllConnections()
        await closed
      }
    } }
  } catch (error) {
    await new Promise(resolve => server.close(resolve))
    throw error
  }
}

it('inherits the active effort for same-model compaction through the actual pi-ai HTTP path', async () => {
  const harness = await wireRuntime()
  try {
    await send(harness.agent, 'a'.repeat(12000))
    await send(harness.agent, 'b'.repeat(12000))
    const summaries = harness.requests.filter(request => request.summary)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].body.reasoning_effort).toBe('max')
    expect(harness.requests).toHaveLength(3)
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
    expect(JSON.stringify(harness.agent.session.deriveMessages())).toContain('Earlier discussion summary.')
  } finally { await harness.close() }
})

it('keeps a separately configured summarizer on its own reasoning defaults', async () => {
  const harness = await wireRuntime({ config: { summarizationProvider: 'fixture', summarizationModel: 'summary' }, defaultEffort: 'low' })
  try {
    await send(harness.agent, 'a'.repeat(12000))
    await send(harness.agent, 'b'.repeat(12000))
    const summaries = harness.requests.filter(request => request.summary)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].body.model).toBe('summary')
    expect(summaries[0].body.reasoning_effort).toBe('low')
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
  } finally { await harness.close() }
})

it('honors explicitly disabled reasoning without falling back to the route default', async () => {
  const harness = await wireRuntime({ effort: 'off', defaultEffort: 'high', off: null })
  try {
    await send(harness.agent, 'a'.repeat(12000))
    await send(harness.agent, 'b'.repeat(12000))
    expect(harness.requests.filter(request => request.summary)).toHaveLength(1)
    expect(harness.requests.every(request => !Object.hasOwn(request.body, 'reasoning_effort'))).toBe(true)
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
  } finally { await harness.close() }
})

it('stops on a rejected summary instead of repeating it until the context budget is exhausted', async () => {
  const harness = await wireRuntime({ rejectSummary: true })
  try {
    await send(harness.agent, 'a'.repeat(12000))
    await send(harness.agent, 'b'.repeat(12000))
    expect(harness.requests).toHaveLength(2)
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'error', error: { code: 'INVALID_REQUEST' } })
    const history = JSON.stringify(harness.agent.session.deriveMessages())
    expect(history).toContain('a'.repeat(12000))
    expect(history).toContain('b'.repeat(12000))
    harness.wireControls.rejectSummary = false
    await send(harness.agent, 'retry after correcting the configuration')
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
    expect(harness.requests.filter(request => request.summary)).toHaveLength(2)
  } finally { await harness.close() }
})

it.each(['INVALID_REQUEST', 'AUTH', 'FORBIDDEN', 'UNSUPPORTED_REASONING_EFFORT', 'UNSUPPORTED_OPTION'])(
  'does not hide a deterministic %s summary rejection behind a later budget error', async code => {
    const harness = await runtime()
    try {
      await send(harness.agent, 'a'.repeat(12000))
      harness.controls.failSummary = true
      harness.controls.summaryFailureCode = code
      await send(harness.agent, 'b'.repeat(12000))
      expect(harness.calls.filter(call => call.purpose !== 'compaction')).toHaveLength(1)
      expect(harness.endings.at(-1)).toMatchObject({ kind: 'error', error: { code } })
    } finally { await harness.close() }
  })

it.each(['SERVER', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT'])(
  'keeps a transient %s summary failure recoverable while below the hard budget', async code => {
    const harness = await runtime()
    try {
      await send(harness.agent, 'a'.repeat(12000))
      harness.controls.failSummary = true
      harness.controls.summaryFailureCode = code
      await send(harness.agent, 'b'.repeat(12000))
      expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
      harness.controls.failSummary = false
      await send(harness.agent, 'retry summary after the transient failure')
      expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
      expect(JSON.stringify(harness.agent.session.deriveMessages())).toContain('Earlier discussion summary.')
    } finally { await harness.close() }
  })

it('runs real agent admission, compaction and request rebuilding without external model access', async () => {
  const harness = await runtime()
  try {
    await send(harness.agent, 'a'.repeat(12000))
    await send(harness.agent, 'b'.repeat(12000))
    const summary = harness.calls.find(call => call.purpose === 'compaction')
    expect(summary).toBeDefined()
    expect(summary.maxTokens).toBeLessThanOrEqual(1024)
    const final = harness.calls.at(-1)
    expect(final.purpose).not.toBe('compaction')
    expect(JSON.stringify(final.messages)).toContain('Earlier discussion summary.')
    expect(JSON.stringify(final.messages)).not.toContain('a'.repeat(12000))
    expect(JSON.stringify(final.messages)).toContain('b'.repeat(12000))
  } finally { await harness.close() }
})

it('does not send an indivisible oversized first input and preserves it in the session', async () => {
  const harness = await runtime()
  try {
    const text = '中文'.repeat(5000)
    await send(harness.agent, text)
    expect(harness.calls).toHaveLength(0)
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'error', error: { code: 'CONTEXT_WINDOW_EXCEEDED' } })
    expect(JSON.stringify(harness.agent.session.deriveMessages())).toContain(text)
  } finally { await harness.close() }
})

it('uses the newly routed smaller model rather than the previous header', async () => {
  const harness = await runtime({}, 'large')
  try {
    await send(harness.agent, 'a'.repeat(12000))
    harness.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: 'small' }))
    await send(harness.agent, 'b'.repeat(12000))
    expect(harness.calls.some(call => call.purpose === 'compaction' && call.model === 'small')).toBe(true)
    expect(harness.calls.at(-1).model).toBe('small')
    expect(JSON.stringify(harness.calls.at(-1).messages)).toContain('Earlier discussion summary.')
  } finally { await harness.close() }
})

it('retains history and stops before a known oversized call when summarization fails', async () => {
  const harness = await runtime()
  try {
    await send(harness.agent, 'a'.repeat(12000))
    harness.controls.failSummary = true
    await send(harness.agent, 'b'.repeat(18000))
    expect(harness.calls.filter(call => call.purpose !== 'compaction')).toHaveLength(1)
    expect(harness.calls.filter(call => call.purpose === 'compaction')).toHaveLength(1)
    const messages = JSON.stringify(harness.agent.session.deriveMessages())
    expect(messages).toContain('a'.repeat(12000))
    expect(messages).toContain('b'.repeat(18000))
  } finally { await harness.close() }
})

it('honors explicitly disabled automatic compaction', async () => {
  const harness = await runtime({ auto: false })
  try {
    await send(harness.agent, 'a'.repeat(12000))
    await send(harness.agent, 'b'.repeat(12000))
    expect(harness.calls).toHaveLength(2)
    expect(harness.calls.some(call => call.purpose === 'compaction')).toBe(false)
  } finally { await harness.close() }
})

it('does not issue a conversation request after cancellation during summarization', async () => {
  const harness = await runtime()
  try {
    await send(harness.agent, 'a'.repeat(12000))
    harness.controls.abortSummary = true
    await send(harness.agent, 'b'.repeat(12000))
    expect(harness.calls.filter(call => call.purpose !== 'compaction')).toHaveLength(1)
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'aborted', reason: { kind: 'user' } })
  } finally { await harness.close() }
})

it('keeps exact-target headroom overrides explicit and isolates other targets', () => {
  const config = resolveConfig({ modelPolicies: [{ provider: 'fixture', model: 'small', headroomTokens: 1000 }] })
  expect(resolveTargetPolicy(config, { provider: 'fixture', model: 'small' }).autoHeadroom).toBe(false)
  expect(resolveTargetPolicy(config, { provider: 'fixture', model: 'other' }).autoHeadroom).toBe(true)
})

it('compacts after a large tool result without separating its call/result pair', async () => {
  const harness = await runtime()
  const result = 'tool result '.repeat(1500)
  const unregister = harness.ctx.tools.register(defineContentToolFixture({
    name: 'large_result', description: 'Return fixture text', parameters: {},
    execute: async () => [{ type: 'text', text: result }]
  }))
  try {
    await send(harness.agent, 'a'.repeat(8000))
    harness.controls.invokeTool = true
    await send(harness.agent, 'search now')
    expect(harness.endings.at(-1)).toMatchObject({ kind: 'completed' })
    expect(harness.calls.some(call => call.purpose === 'compaction')).toBe(true)
    const final = harness.calls.at(-1)
    expect(JSON.stringify(final.messages)).toContain('Earlier discussion summary.')
    expect(final.messages.some(message => message.content.some(block => block.type === 'tool-call' && block.id === 'fixture-call'))).toBe(true)
    expect(JSON.stringify(final.messages)).toContain(result)
  } finally { unregister(); await harness.close() }
})
