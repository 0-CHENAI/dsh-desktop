import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { HarnessRuntime } from '../src/main/runtime/harness-runtime'

it('boots the full desktop profile and serves authenticated PPT RPC with Harness 0.1.5', async () => {
  const root = resolve(import.meta.dirname, '..')
  const home = await mkdtemp(join(tmpdir(), 'dsh-upgrade-runtime-'))
  const runtime = new HarnessRuntime({
    dshEntryPath: join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    nodeEntryPath: join(root, 'build/harness-node-entry.mjs'),
    nodeExecutablePath: process.execPath,
    dshPatchPath: join(root, 'build/dsh-desktop.patch.yml'),
    dshSafePatchPath: join(root, 'build/dsh-desktop-safe.patch.yml'),
    dshHome: home,
    logPath: join(home, 'runtime.log'),
    startupTimeoutMs: 30_000,
    launchProcess: (executable, args, options) => spawn(executable, args, options),
    onChanged() {}
  })
  try {
    await runtime.start(home)
    const state = runtime.snapshot()
    expect(state.phase, state.logs.join('\n')).toBe('ready')
    const url = new URL(state.url!)
    url.searchParams.set('token', state.authToken!)
    const exchange = await fetch(url, { redirect: 'manual' })
    const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!
    const endpoint = new URL('/dsh-ppt/state', url)
    expect((await fetch(endpoint, { method: 'POST' })).status).toBe(401)
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 'upgrade-ppt', method: 'state', payload: { sessionId: 'upgrade-test' } })
    })
    expect(response.status).toBe(200)
    expect((await response.json()).result.ok).toBe(true)
  } finally {
    await runtime.stop()
    await rm(home, { recursive: true, force: true })
  }
}, 45_000)
