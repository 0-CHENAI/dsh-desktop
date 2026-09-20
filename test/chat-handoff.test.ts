import { describe, expect, it, vi } from 'vitest'
import { chatRuntime, fullChatRuntime, context, settle, text } from './helpers/chat-handoff-runtime'

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

function row(r: any, state: any, turn: any) {
  const p = r.projectAssistant(context(state))
  return { key: `${state.turn}:${state.step}`, kind: 'assistant-step', visibility: p.visible ? 'visible' : 'hidden',
    anchorSeq: p.anchorSeq, location: { kind: 'step', turn, step: turn.steps.find((step: any) => step.step === state.step) }, data: p.data }
}
function timeline(status = 'open', steps = [1], reason = 'completed') {
  const turn = { turn: 1, status, data: new Map(), steps: steps.map(step => ({ step, data: new Map() })),
    end: status === 'closed' ? { data: { reason: { kind: reason } } } : undefined }
  return { turns: new Map([[1, turn]]), turnOrder: [1] }
}

describe('原子跨步骤展示投影', () => {
  it('完整 ChatSnapshotBuilder 在通知订阅者前同步更新旧正文和新正文', () => {
    const r = fullChatRuntime()
    const builder = new r.ChatSnapshotBuilder()
    const t = timeline('open', [1, 2])
    const a = row(r, text(r, r.initialState(1, 1), '原正文'), t.turns.get(1))
    let snapshot = builder.replace({ nodes: [a], timeline: t })
    let notifications = 0
    const unsubscribe = snapshot.nodes.source(a.key).subscribe(() => {
      notifications++
      const old = snapshot.nodes.get(a.key)
      const next = snapshot.nodes.get(old.data.presentation.replacedBy)
      expect(next?.visibility).toBe('visible')
      expect(next?.data.presentation.blocks[0].text).toBe('新正文')
    })
    snapshot = builder.apply({ upserts: [row(r, text(r, r.initialState(1, 2), '新正文', 5), t.turns.get(1))], timeline: t })
    expect(notifications).toBe(1)
    expect(snapshot.order).toEqual(['1:1', '1:2'])
    unsubscribe()
  })

  it('最终节点尚未进入可见存储时，不允许结束轮次的过程折叠', () => {
    const r = fullChatRuntime()
    const t = timeline('closed')
    const control = { key: 'control', kind: 'turn-process', anchorSeq: 1, visibility: 'visible',
      location: { kind: 'turn', turn: t.turns.get(1) }, data: { turn: 1, answerStep: 1, answerAnchorSeq: 3, processStartSeq: 1 } }
    const nodes = new Map<string, any>([['control', control]])
    const locations = { getTurn: () => [...nodes.keys()] }
    expect(r.derivePresentation(1, locations, nodes).answerReady).toBe(false)
    const a = row(r, settle(r, text(r, r.initialState(1, 1)), [{ type: 'text', text: '正文' }]), t.turns.get(1))
    nodes.set(a.key, a)
    expect(r.derivePresentation(1, locations, nodes).answerReady).toBe(true)
    nodes.set(a.key, { ...a, visibility: 'hidden' })
    expect(r.derivePresentation(1, locations, nodes).answerReady).toBe(false)
  })
  it('正文 → 提交工具 → 最终答案：只有可见正文才能接替旧正文', () => {
    const r = chatRuntime()
    const store = new r.AssistantHandoffProjector()
    const t = timeline('open', [1, 2])
    let first = text(r, r.initialState(1, 1), '原正文')
    first = settle(r, first, [{ type: 'tool-call', id: 'submit', name: 'submit', arguments: '{}' }])
    const old = row(r, first, t.turns.get(1))
    let out = store.replace([old], t)
    expect(out[0].data.presentation.phase).toBe('waiting')
    const reasoning = r.updateChunk(r.initialState(1, 2), { type: 'reasoning-delta', index: 0, text: '思考' }, 4, 4)
    out = store.apply([row(r, reasoning, t.turns.get(1))], t)
    expect(out.find((n: any) => n.key === old.key)?.data.presentation.replacedBy).toBeUndefined()
    const answer = text(r, r.initialState(1, 2), '最终正文', 6)
    out = store.apply([row(r, answer, t.turns.get(1))], t)
    expect(out.find((n: any) => n.key === old.key).data.presentation.replacedBy).toBe('1:2')
    expect(out.find((n: any) => n.key === '1:2').data.presentation.blocks[0].text).toBe('最终正文')
    const closed = timeline('closed', [1, 2])
    out = store.apply([row(r, settle(r, answer, [{ type: 'text', text: '最终正文' }], 7), closed.turns.get(1))], closed)
    expect(out.find((n: any) => n.key === '1:2').data.presentation.phase).toBe('final')
    expect(out.filter((n: any) => n.data.presentation.phase === 'final')).toHaveLength(1)
  })

  it.each(['aborted', 'error', 'interrupted', 'max-tokens', 'completed'])('结束时不遗留处理中状态：%s', reason => {
    const r = chatRuntime()
    const store = new r.AssistantHandoffProjector()
    const t = timeline()
    const state = r.resetForRetry(text(r, r.initialState(1, 1)))
    store.replace([row(r, state, t.turns.get(1))], t)
    const closed = timeline('closed', [1], reason)
    const out = store.apply([], closed)
    expect(out[0].data.presentation.phase).toBe(({ aborted: 'cancelled', error: 'failed', interrupted: 'incomplete',
      'max-tokens': 'incomplete', completed: 'missing' } as Record<string, string>)[reason])
    expect(out[0].data.presentation.blocks[0].text).toBe('正文')
    expect(out[0].data.finalNode).toBeUndefined()
  })

  it('只有工具回执也显示缺失最终正文提示，不伪造正文', () => {
    const r = chatRuntime()
    const store = new r.AssistantHandoffProjector()
    const t = timeline()
    const state = settle(r, r.initialState(1, 1), [{ type: 'tool-call', id: 'call', name: 'submit', arguments: '{}' }])
    store.replace([row(r, state, t.turns.get(1))], t)
    const out = store.apply([], timeline('closed'))
    expect(out[0].visibility).toBe('visible')
    expect(out[0].data.presentation.phase).toBe('missing')
    expect(out[0].data.presentation.blocks.some((b: any) => b.kind === 'text')).toBe(false)
  })

  it('附件型最终回答有效，临时附件保留原引用', () => {
    const r = chatRuntime()
    const attachment = { id: 'attachment' }
    let state = r.updateChunk(r.initialState(1, 1), { type: 'block-end', index: 0, block: { type: 'image', attachment } }, 2, 2)
    const pending = settle(r, state, [{ type: 'tool-call', id: 'c', name: 'submit', arguments: '{}' }])
    expect(r.projectAssistant(context(pending)).data.presentation.blocks[0].attachment).toBe(attachment)
    state = settle(r, state, [{ type: 'image', attachment }])
    const t = timeline('closed')
    const out = new r.AssistantHandoffProjector().replace([row(r, state, t.turns.get(1))], t)
    expect(out[0].data.presentation.phase).toBe('final')
  })

  it('不同会话的相同 turn/step 不共享快照，replace 丢弃旧临时状态', () => {
    const r = chatRuntime()
    const t = timeline()
    const a = new r.AssistantHandoffProjector()
    const b = new r.AssistantHandoffProjector()
    a.replace([row(r, text(r, r.initialState(1, 1), 'A'), t.turns.get(1))], t)
    expect(b.replace([], t)).toEqual([])
    expect(a.replace([], t)).toEqual([])
    expect(a.apply([], timeline('closed'))).toEqual([])
  })

  it('正文不泄漏到诊断记录，诊断默认关闭', () => {
    const debug = vi.fn()
    for (const enabled of [false, true]) {
      const r = chatRuntime({ __DSH_CHAT_HANDOFF_DEBUG__: enabled, console: { debug } })
      const t = timeline()
      new r.AssistantHandoffProjector().replace([row(r, text(r, r.initialState(1, 1), 'SECRET正文'), t.turns.get(1))], t)
      expect(debug.mock.calls.length).toBe(enabled ? 1 : 0)
    }
    expect(JSON.stringify(debug.mock.calls)).not.toContain('SECRET')
    expect(debug.mock.calls[0]?.[1]).toMatchObject({ seq: 2, eventType: 'assistant/live-chunk', textLength: 8 })
  })
})

describe('增量与权威消息边界', () => {
  it('重复或迟到的增量不重复追加；完整消息可以纠正流式文本', () => {
    const r = chatRuntime()
    let state = text(r, r.initialState(1, 1), '旧')
    expect(text(r, state, '重复', 2)).toBe(state)
    state = settle(r, state, [{ type: 'text', text: '纠正后的正文' }])
    expect(text(r, state, '迟到', 4)).toBe(state)
    const p = r.projectAssistant(context(state))
    expect(p.data.presentation.blocks).toEqual([{ kind: 'text', text: '纠正后的正文' }])
    expect(p.anchorSeq).toBe(2)
  })

  it('重复重试事件不递增代次；推理和工具参数不会成为草稿', () => {
    const r = chatRuntime()
    const state = text(r, r.initialState(1, 1))
    const event = { type: 'llm/retry', seq: 3 }
    const retry = r.assistantDefinition.update(context(state), { event })
    expect(r.assistantDefinition.update(context(retry), { event })).toBe(retry)
    expect(retry.attempt).toBe(1)
    const pending = r.updateChunk(retry, { type: 'reasoning-delta', index: 0, text: '新尝试推理' }, 4, 4)
    expect(r.projectAssistant(context(pending)).data.presentation.phase).toBe('retrying')
    const reasoning = r.updateChunk(r.initialState(1, 1), { type: 'reasoning-delta', index: 0, text: '内部推理' }, 2, 2)
    expect(r.resetForRetry(reasoning).preview).toBeUndefined()
  })

  it('基线回放只含持久化工具消息时不恢复不存在的临时正文', () => {
    const r = chatRuntime()
    const state = settle(r, r.initialState(1, 1), [{ type: 'tool-call', id: 'c', name: 'submit', arguments: '{}' }])
    expect(r.projectAssistant(context(state)).data.presentation.blocks.every((b: any) => b.kind === 'tool-call')).toBe(true)
  })
})
