import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { SessionSeq } from '@deepseek-ai/dsh-session'

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
    Symbol, RemoteError, SessionSeq: Number, SessionLogOffset: Number, buildForkSeed,
    brandString: String, randomUUID: () => 'child', SessionQueryError: class extends Error {}
  })
  const events = [{ seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } }, { seq: 1, time: 1, type: 'message', data: {} },
    ...(completed ? [{ seq: 2, time: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }, { seq: 3, time: 3, type: 'turn/start', data: { turn: 2 } }] : [])]
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
    await expect(f.controller.fork({ sessionId: 'source', atSeq: 2 })).resolves.toEqual({ sessionId: 'session-child' })
    expect(f.agents.resolvedAgentOptions).toHaveBeenCalledOnce()
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({
      seed: buildForkSeed(f.events as any, SessionSeq(2)), inheritedEventCount: 3,
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

  it('branches from an open turn, closes only the child tail and keeps the parent intact', async () => {
    const f = await fixture(false)
    const original = JSON.stringify(f.events)
    await expect(f.controller.fork({ sessionId: 'source', atSeq: 1 })).resolves.toEqual({ sessionId: 'session-child' })
    const call = f.create.mock.calls[0]
    if (!call) throw new Error('Fork did not create a child')
    const options = call[0]
    expect(options.inheritedEventCount).toBe(2)
    expect(options.seed.slice(0, 2)).toEqual(f.events)
    expect(options.seed.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'forked' } } })
    expect(JSON.stringify(f.events)).toBe(original)
    expect(f.attachSession).toHaveBeenCalledWith('session-child')
  })

  it('rejects a nonexistent anchor without creating a child', async () => {
    const f = await fixture(false)
    await expect(f.controller.fork({ sessionId: 'source', atSeq: 99 })).rejects.toMatchObject({ code: 'session/fork-unavailable' })
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
      ctx: { sessions: { fork }, uiWorkspace: { openSession: open } }, chat: { getSnapshot: () => ({ timeline: { turns: new Map() } }) }, sessionId: 'source', window: { alert },
      console: { error: vi.fn() }, t: (key: string) => key
    })
    actions.forkAt(5)
    await new Promise(resolve => setImmediate(resolve))
    expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'source', atSeq: 5, increaseTitle: true, onCreated: expect.any(Function) }))
    if (failed) {
      expect(open).not.toHaveBeenCalled()
      expect(alert).toHaveBeenCalledWith('message.branchFailed')
    } else {
      expect(open).toHaveBeenCalledWith('child')
      expect(alert).not.toHaveBeenCalled()
    }
  })
})
