const globals = window as any
const modules = globals.__dshVendors
const React = modules.react
const { useSyncExternalStore } = React
const ReactDOM = modules['react-dom']
const { createRoot } = modules['react-dom/client']
globals.__ModuleLoader__ = { load(module: any) { globals.chat = module.factory((name: string) => {
  if (!(name in modules)) throw new Error(`Unexpected browser dependency: ${name}`)
  return modules[name]
}).__test } }

globals.runHandoff = async (mode: string, processOpen = false) => {
  const r = globals.chat
  const builder = new r.ChatSnapshotBuilder()
  const root = createRoot(document.getElementById('root')!)
  let stepOne = r.initialState(1, 1)
  let seq = 1
  const t = (key: string, values: Record<string, unknown> = {}) => (r.zh[key] ?? key).replace(/\{(\w+)\}/g, (match: string, name: string) => String(values[name] ?? match))
  let snapshot: any
  let currentTimeline: any
  let processExpanded = false
  const makeTimeline = (closed: boolean, reason = 'completed') => {
    const turn = { turn: 1, status: closed ? 'closed' : 'open', steps: [1, 2].map(step => ({ step, data: new Map() })),
      data: new Map(), end: closed ? { data: { reason: { kind: reason } } } : undefined }
    return { turns: new Map([[1, turn]]), turnOrder: [1] }
  }
  const row = (state: any) => {
    const turn = currentTimeline.turns.get(1)
    const ctx = { state, start: { event: { time: 0 }, location: { kind: 'step', turn, step: turn.steps[state.step - 1] } }, matches: [] }
    const p = r.projectAssistant(ctx)
    return { key: `1:${state.step}`, kind: 'assistant-step', anchorSeq: p.anchorSeq,
      visibility: p.visible ? 'visible' : 'hidden', location: ctx.start.location, data: p.data }
  }
  const chunk = (state: any, text: string) => r.updateChunk(state, { type: 'text-delta', index: 0, text }, ++seq, seq)
  const settle = (state: any, content: any[]) => {
    const event = { type: 'assistant/message', seq: ++seq, time: seq,
      data: { turn: 1, step: state.step, message: { id: `message-${seq}`, content } } }
    return r.settleMessage(state, { event }, event)
  }
  const useNode = (key: string) => {
    const source = snapshot.nodes.source(key)
    return useSyncExternalStore(source.subscribe, source.getSnapshot)
  }
  const useProcess = (key: string) => {
    const source = snapshot.nodes.processSource(key)
    return useSyncExternalStore(source.subscribe, source.getSnapshot)
  }
  const App = () => <>{snapshot.order.map((key: string) => <r.ChatNodeSeat key={key}
    nodeKey={key} useChatNode={useNode} useChatNodeProcess={useProcess}
    compactTranscript={mode === 'compact'} historyIncomplete={false}
    useStore={(selector: any) => selector({ turnProcesses: processExpanded ? [{ turn: 1, answerStep: 2 }] : [] })}
    actions={{ setTurnProcessOpen(_turn: number, _step: number, open: boolean) {
      processExpanded = open; ReactDOM.flushSync(() => root.render(<App />))
    } }} t={t} cwd="/fixture" openFile={() => {}}
    inspectCall={() => {}} forkAt={() => {}} loadImage={() => {}} fileMentions={() => undefined}
    renderMessageImages={({ images }: any) => images.map((_: any, i: number) => <img key={i} alt="测试附件" style={{ width: 64, height: 64 }} src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='blue'/%3E%3C/svg%3E" />)}
    renderSlot={(_: string, owner: any) => owner.node.kind === 'turn-process' ? <r.TurnProcessNodeView {...owner} t={t} /> :
      <r.AssistantNodeView {...owner} useTurnData={() => undefined} t={t} />}
  />)}</>
  const stages: any[] = []
  globals.handoffFrames = []
  let running = true
  const observe = () => {
    const bodies = [...document.querySelectorAll('[data-answer-body]')].filter(el => (el as HTMLElement).checkVisibility())
    globals.handoffFrames.push(bodies.map(el => el.textContent).join('\n'))
    if (running) requestAnimationFrame(observe)
  }
  const publish = async (states: any[], closed = false, reason = 'completed') => {
    if (closed) currentTimeline = makeTimeline(true, reason)
    ReactDOM.flushSync(() => {
      const upserts = states.map(row)
      if (closed) upserts.push({ key: 'control', kind: 'turn-process', anchorSeq: 1, visibility: 'visible',
        location: { kind: 'turn', turn: currentTimeline.turns.get(1) }, data: { turn: 1, controlAnchorSeq: 1,
          processStartSeq: 1, answerStep: 2, answerAnchorSeq: seq, messageCount: 1, toolCallCount: 1, subagentCount: 0 } } as any)
      snapshot = snapshot === undefined ? builder.replace({ nodes: states.map(row), timeline: currentTimeline }) :
        builder.apply({ upserts, timeline: currentTimeline })
      root.render(<App />)
    })
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }
  globals.handoffStage = async (stage: number) => {
    if (stage === 0) {
      currentTimeline = makeTimeline(false)
      stepOne = chunk(stepOne, '# 原正文\n\n这段正文在工具交接时必须保持可读。\n\n```js\nconst answer = 42\n```\n\n' + '长正文验证。\n\n'.repeat(100))
      await publish([stepOne])
      requestAnimationFrame(observe)
    } else if (stage === 1) {
      stepOne = settle(stepOne, [{ type: 'tool-call', id: 'submit', name: 'submit_answer', arguments: '{}' }])
      await publish([stepOne])
    } else if (stage === 2) {
      stepOne = r.assistantDefinition.update({ state: stepOne }, { event: { type: 'llm/retry', seq: ++seq } })
      await publish([stepOne])
    } else if (stage === 3) {
      stepOne = chunk(stepOne, '重试后的新正文')
      await publish([stepOne])
    } else if (stage === 4) {
      const next = chunk(r.initialState(1, 2), '最终正文')
      await publish([next])
      if (processOpen && mode === 'compact') {
        (document.querySelector('[data-answer-replaced] > button') as HTMLButtonElement).click()
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    } else if (stage === 5) {
      const next = settle(r.initialState(1, 2), [{ type: 'text', text: '最终正文' }, { type: 'image', attachment: { id: 'fixture' } }])
      await publish([next], true)
    }
    const bodies = [...document.querySelectorAll('[data-answer-body]')].filter(el => (el as HTMLElement).checkVisibility())
    stages.push({ stage, text: bodies.map(el => el.textContent).join('\n'), status: [...document.querySelectorAll('[role=status]')].map(el => el.textContent) })
    return stages.at(-1)
  }
  globals.finishHandoff = () => { running = false; root.unmount(); return { stages, frames: globals.handoffFrames } }
}
