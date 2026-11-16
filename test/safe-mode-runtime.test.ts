import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { temporaryDesktopHost } from './helpers/desktop-host'

it('creates a default-preset session in recovery with optional Office/PPT absent and no shared modules', async () => {
  const runtime = await temporaryDesktopHost(true)
  try {
    const ready = await runtime.host.start()
    const url = new URL(ready.url)
    const login = await fetch(url, { redirect: 'manual' })
    expect(login.status).toBe(303)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const graph = JSON.stringify(ready.injections)
    expect(graph).toContain('@deepseek-ai/dsh-client-modules')
    expect(graph).not.toContain('dsh-ppt-composer')
    expect(graph).not.toContain('dsh-desktop-office')
    await expect(lstat(join(runtime.home, 'profiles/node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
    const created = await fetch(new URL('/api/session/create', url), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'safe-mode-session', method: 'session/create', payload: { args: { request: {} } } })
    })
    const envelope = await created.json()
    expect(envelope.result?.ok, JSON.stringify(envelope)).toBe(true)
    expect(envelope.result?.value?.sessionId).toBeTruthy()
    await expect(lstat(join(runtime.home, 'profiles/node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await runtime.close() }
}, 120_000)
