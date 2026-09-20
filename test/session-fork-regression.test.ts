import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

async function fixture(completed = true) {
  const source = await readFile('node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js', 'utf8')
  const start = source.indexOf('//#region lib/types/commands.js')
  const end = source.indexOf('//#endregion', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  class RemoteError extends Error {
    constructor(public code: string, message: string) { super(message) }
  }
  const Controller = runInNewContext(`${source.slice(start, end)}; SessionCommandController`, {
    Symbol, RemoteError, SessionSeq: Number, SessionLogOffset: Number,
    brandString: String, randomUUID: () => 'child', SessionQueryError: class extends Error {}
  })
  const events = [{ seq: 0, type: 'turn/start' }, { seq: 1, type: 'message' },
    ...(completed ? [{ seq: 2, type: 'turn/end' }, { seq: 3, type: 'turn/start' }] : [])]
  const dispose = vi.fn()
  const attachSession = vi.fn()
  const create = vi.fn().mockResolvedValue({ agent: { id: 'session-child' } })
  const agents = {
    resolvedAgentOptions: vi.fn().mockResolvedValue({ provider: 'custom', model: 'selected' }),
    composeAgent: vi.fn().mockResolvedValue({ agentPreset: 'preset', setup: 'setup' }),
    presetForObservation: vi.fn().mockReturnValue('preset'), retainHandle: vi.fn()
  }
  const ctx = {
    sessionQuery: { observeSession: vi.fn().mockResolvedValue({
      header: { id: 'source', cwd: '/project' }, events, [Symbol.dispose]: dispose
    }) },
    workspaceRegistry: { list: () => [{ id: 'workspace', sessionIds: ['source'], attachSession }] },
    agents: { create }
  }
  return { controller: new Controller(ctx, agents), agents, create, attachSession, dispose, events }
}

describe('issue #96 session branching', () => {
  it('creates the child using the agent controller and only the completed prefix', async () => {
    const f = await fixture()
    await expect(f.controller.fork({ sessionId: 'source', atSeq: 1 })).resolves.toEqual({ sessionId: 'session-child' })
    expect(f.agents.resolvedAgentOptions).toHaveBeenCalledOnce()
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({
      seed: f.events.slice(0, 3), inheritedEventCount: 3,
      agentOptions: { provider: 'custom', model: 'selected' },
      meta: { cwd: '/project', parentSession: 'source', isSeeded: true, agentPreset: 'preset' }
    }))
    expect(f.attachSession).toHaveBeenCalledWith('session-child')
    expect(f.agents.retainHandle).toHaveBeenCalledOnce()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it('supports the sidebar fork without an explicit message anchor', async () => {
    const f = await fixture()
    await expect(f.controller.fork({ sessionId: 'source' })).resolves.toEqual({ sessionId: 'session-child' })
  })

  it('rejects incomplete turns without creating a child', async () => {
    const f = await fixture(false)
    await expect(f.controller.fork({ sessionId: 'source', atSeq: 1 })).rejects.toMatchObject({ code: 'session/fork-unavailable' })
    expect(f.create).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it('does not attach a child when model resolution fails', async () => {
    const f = await fixture()
    f.agents.resolvedAgentOptions.mockRejectedValue(new Error('model unavailable'))
    await expect(f.controller.fork({ sessionId: 'source' })).rejects.toMatchObject({ code: 'gateway/internal' })
    expect(f.create).not.toHaveBeenCalled()
    expect(f.attachSession).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it.each([false, true])('opens a successful fork or reports failure (failed=%s)', async (failed) => {
    const source = await readFile('node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', 'utf8')
    const start = source.lastIndexOf('forkAt: (seq) => {')
    const end = source.indexOf('\n\t\t\t\t\t\t\t}', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const open = vi.fn()
    const alert = vi.fn()
    const fork = failed ? vi.fn().mockRejectedValue(new Error('failed')) : vi.fn().mockResolvedValue('child')
    const actions = runInNewContext(`({${source.slice(start, end)}\n}})`, {
      ctx: { sessions: { fork, open } }, sessionId: 'source', window: { alert },
      console: { error: vi.fn() }, t: (key: string) => key
    })
    actions.forkAt(5)
    await new Promise(resolve => setImmediate(resolve))
    expect(fork).toHaveBeenCalledWith({ sessionId: 'source', atSeq: 5, increaseTitle: true })
    if (failed) {
      expect(open).not.toHaveBeenCalled()
      expect(alert).toHaveBeenCalledWith('message.branchFailed')
    } else {
      expect(open).toHaveBeenCalledWith('child')
      expect(alert).not.toHaveBeenCalled()
    }
  })
})
