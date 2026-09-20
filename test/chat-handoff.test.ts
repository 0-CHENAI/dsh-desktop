import { describe, expect, it } from 'vitest'
import { chatRuntime, context, settle, text } from './helpers/chat-handoff-runtime'

describe('流式正文交接回归（执行已安装的聊天投影）', () => {
  it('工具调用完整消息不清空已展示正文，且不改写权威消息', () => {
    const r = chatRuntime()
    let state = text(r, r.initialState(1, 1))
    state = settle(r, state, [{ type: 'tool-call', id: 'tool', name: 'submit', arguments: '{}' }])
    const p = r.projectAssistant(context(state))
    expect(p.visible).toBe(true)
    expect(p.data.presentation.blocks).toEqual([{ kind: 'text', text: '正文' }])
    expect(p.data.presentation.phase).toBe('waiting')
    expect(p.data.blocks[0].kind).toBe('tool-call')
    expect(p.data.finalNode.blocks[0].kind).toBe('tool-call')
  })

  it('重试期间保留草稿但不将不同尝试的增量拼接', () => {
    const r = chatRuntime()
    let state = r.resetForRetry(text(r, r.initialState(1, 1), '旧正文'))
    let p = r.projectAssistant(context(state))
    expect(p.visible).toBe(true)
    expect(p.data.presentation.phase).toBe('retrying')
    state = text(r, state, '新正文', 5)
    p = r.projectAssistant(context(state))
    expect(p.data.blocks).toEqual([{ kind: 'text', text: '新正文' }])
    expect(p.data.presentation.draft.blocks).toEqual([{ kind: 'text', text: '旧正文' }])
  })
})
