import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'

export const chatFile = 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
export function region(source: string, name: string) {
  const start = source.indexOf(`//#region ${name}`)
  if (start < 0) throw new Error(`Missing shipped region: ${name}`)
  return source.slice(start, source.indexOf('//#endregion', start))
}

export function chatRuntime(extra = {}) {
  const source = readFileSync(chatFile, 'utf8')
  const code = ['lib/types/client/conversation-nodes/event-projection.js',
    'lib/types/client/conversation-nodes/assistant.js'].map(name => region(source, name)).join('\n')
  return runInNewContext(`${code}; ({initialState, updateChunk, settleMessage, resetForRetry, projectAssistant,
    assistantDefinition, ...(typeof AssistantHandoffProjector === 'undefined' ? {} : {AssistantHandoffProjector})})`, {
    console, CHAT_SYNTHETIC_SEQ_OFFSETS: { interruptedAssistant: -0.9 }, ...extra
  })
}

/** Load the complete shipped module; only host services are substituted. */
export function fullChatRuntime(extra = {}) {
  const require = createRequire(import.meta.url)
  let result: any
  const source = readFileSync(chatFile, 'utf8').replace('exports.EMPTY_CHAT_SNAPSHOT =',
    'exports.__test = {ChatSnapshotBuilder, assistantDefinition, initialState, updateChunk, settleMessage, resetForRetry, projectAssistant, derivePresentation, AssistantHandoffView, AssistantNodeView, ChatNodeSeat}; exports.EMPTY_CHAT_SNAPSHOT =')
  runInNewContext(source, {
    console, setTimeout, clearTimeout, AbortController,
    window: { __ModuleLoader__: { load(module: any) {
      result = module.factory((name: string) => {
        if (name === '@deepseek-ai/dsh-client-store') return { notifySubscribers: (listeners: Set<() => void>) => {
          for (const listener of listeners) listener()
        } }
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
        return require(name)
      }).__test
    } } }, ...extra
  })
  return result
}

export function context(state: any, closed = false) {
  return { state, start: { event: { time: 0 }, location: { kind: 'step', step: { status: 'open' },
    turn: { status: closed ? 'closed' : 'open', end: closed ? { seq: 20, time: 20 } : undefined } } }, matches: [] }
}
export function text(runtime: any, state: any, value = '正文', seq = 2) {
  return runtime.updateChunk(state, { type: 'text-delta', index: 0, text: value }, seq, seq)
}
export function settle(runtime: any, state: any, content: any[], seq = 3) {
  const event = { type: 'assistant/message', seq, time: seq,
    data: { turn: state.turn, step: state.step, message: { id: `m${seq}`, content } } }
  return runtime.settleMessage(state, { event }, event)
}
