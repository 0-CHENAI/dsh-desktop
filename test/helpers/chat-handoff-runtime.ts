import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

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
