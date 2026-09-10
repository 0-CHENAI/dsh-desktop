import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it } from 'vitest'

it('supports a carrier-free connection and retires each plugin RPC/Fetch route with its owner', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-rpc-lifecycle-'))
  const ctx = new Context()
  const fibers = []
  try {
    fibers.push(await ctx.plugin(Credentials, { dshHome: home, watch: false }))
    fibers.push(await ctx.plugin(Connection))
    expect(ctx.get('connection')).toBeDefined()
    expect(ctx.get('webServer')).toBeUndefined()
    const plugin = {
      inject: ['connection'],
      apply(owner) {
        owner.connection.rpc.handle('/audit-rpc', async () => ({ ok: true, value: 'ok' }))
        owner.connection.fetch.register({ path: '/api/audit-fetch', methods: ['GET'], fetch: () => Promise.resolve(new Response('ok')) })
      }
    }
    const first = await ctx.plugin(plugin)
    fibers.push(first)
    fibers.push(await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
    await new Promise(setImmediate)
    expect(ctx.webServer.match('/audit-rpc/test')).toBeDefined()
    await first.dispose()
    expect(ctx.webServer.match('/audit-rpc/test')).toBeUndefined()
    // Both registries must release their names, so a plugin can be reloaded.
    const second = await ctx.plugin(plugin)
    fibers.push(second)
    await new Promise(setImmediate)
    expect(ctx.webServer.match('/audit-rpc/test')).toBeDefined()
    await second.dispose()
    expect(ctx.webServer.match('/audit-rpc/test')).toBeUndefined()
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
