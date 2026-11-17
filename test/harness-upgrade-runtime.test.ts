import { expect, it } from 'vitest'
import { temporaryDesktopHost } from './helpers/desktop-host'

it('boots the full desktop profile and serves authenticated PPT RPC with Harness 0.2.2', async () => {
  const runtime = await temporaryDesktopHost()
  try {
    const ready = await runtime.host.start()
    const url = new URL(ready.url)
    expect(url.hostname).toBe('127.0.0.1')
    const exchange = await fetch(url, { redirect: 'manual' })
    expect(exchange.status).toBe(303)
    const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    expect(cookie).not.toBe('')
    const endpoint = new URL('/dsh-ppt/state', url)
    expect((await fetch(endpoint, { method: 'POST' })).status).toBe(401)
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 'upgrade-ppt', method: 'state', payload: { sessionId: 'upgrade-test' } })
    })
    expect(response.status).toBe(200)
    expect((await response.json()).result.ok).toBe(true)
  } finally { await runtime.close() }
}, 120_000)
