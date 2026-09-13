import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Authorization from '@deepseek-ai/dsh-authorization'
import Llm from '@deepseek-ai/dsh-llm'
import * as Pi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, expect, it } from 'vitest'
import { createAuthorizationBridge } from '../packages/dsh-desktop-client-ui/authorization.js'

const cleanup = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
async function fixture(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-auth-test-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  for (const [plugin, config] of [[Credentials, { dshHome: home, watch: false }], [Authorization], [Llm]]) {
    const fiber = await ctx.plugin(plugin, config); cleanup.push(() => fiber.dispose())
  }
  const key = 'test-login/vendor'
  if (run) {
    cleanup.push(ctx.authorization.registerFlow({ key, label: 'Test account', methods: [{ id: 'oauth', label: 'Login' }], run: session => run(session, ctx, key) }))
    const dir = ctx.llm.registerConfigurableProviders([{ provider: 'vendor', displayName: 'Vendor', settingsNs: 'test', settingsPath: [], authFlow: key }])
    cleanup.push(dir)
  }
  const bridge = createAuthorizationBridge(ctx); cleanup.push(() => bridge.dispose())
  const request = async body => {
    const response = await bridge.fetch(new Request('http://localhost/api/desktop.authorization', body ? { method: 'POST', body: JSON.stringify(body) } : {}))
    return { status: response.status, value: await response.json() }
  }
  return { ctx, key, request }
}
async function waitFor(request, id, predicate) {
  let result
  await expect.poll(async () => { result = (await request({ action: 'poll', id })).value; return predicate(result) }).toBe(true)
  return result
}
it('discovers the real Codex and Kimi flows without changing API-key providers', async () => {
  const { ctx } = await fixture()
  const f = await ctx.plugin(Pi, { providers: {} }); cleanup.push(() => f.dispose())
  const directory = ctx.llm.listConfigurableProviders()
  expect(directory.find(p => p.provider === 'openai-codex').authFlow).toBe('llm-pi-ai/openai-codex')
  expect(directory.find(p => p.provider === 'kimi-coding').authFlow).toBe('llm-pi-ai/kimi-coding')
  expect(directory.find(p => p.provider === 'anthropic').authFlow).toBeUndefined()
  expect(ctx.authorization.describe('llm-pi-ai/openai-codex').label).toBe('ChatGPT')
})
it('relays device codes and prompts, and reports success only after the real credential store commits', async () => {
  const { request, key } = await fixture(async (s, ctx, key) => {
    s.notify({ message: 'Verify', url: 'https://example.com/device', code: 'ABCD' })
    s.notify({ message: 'Unsafe', url: 'javascript:alert(1)' })
    const answer = await s.prompt({ kind: 'secret', message: 'Verification code' })
    expect(answer).toBe('secret-test-value')
    await ctx.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: { access: answer } }))
  })
  const { value: started } = await request({ action: 'start', key, method: 'oauth' })
  const running = await waitFor(request, started.id, a => a.prompts.length === 1)
  expect(running.notices[0].code).toBe('ABCD')
  expect(running.notices[1].url).toBeUndefined()
  await request({ action: 'answer', id: started.id, promptId: running.prompts[0].id, value: 'secret-test-value' })
  const done = await waitFor(request, started.id, a => a.status === 'authorized')
  expect(JSON.stringify(done)).not.toContain('secret-test-value')
  expect((await request()).value[0].configured).toBe(true)
})
it('cancels without credentials and permits a new attempt', async () => {
  const { request, key } = await fixture(s => s.prompt({ kind: 'text', message: 'Code' }))
  const first = (await request({ action: 'start', key, method: 'oauth' })).value
  expect((await request({ action: 'start', key, method: 'oauth' })).status).toBe(409)
  expect((await request({ action: 'cancel', id: first.id })).value.status).toBe('cancelled')
  expect((await request()).value[0].configured).toBe(false)
  const second = await request({ action: 'start', key, method: 'oauth' })
  expect(second.status).toBe(200)
  expect(second.value.id).not.toBe(first.id)
  await request({ action: 'cancel', id: second.value.id })
})
it('maps declined prompts to cancellation and rejects stale answers', async () => {
  const { request, key } = await fixture(s => s.prompt({ kind: 'text', message: 'Code' }))
  const a = (await request({ action: 'start', key, method: 'oauth' })).value
  const p = await waitFor(request, a.id, a => a.prompts.length > 0)
  await request({ action: 'answer', id: a.id, promptId: p.prompts[0].id, declined: true })
  await waitFor(request, a.id, a => a.status === 'cancelled')
  expect((await request({ action: 'answer', id: a.id, promptId: p.prompts[0].id, value: 'late' })).status).toBe(409)
})
it('withdraws a losing prompt without cancelling a successful browser callback', async () => {
  const { request, key } = await fixture(async (s, ctx, key) => {
    const controller = new AbortController()
    const losing = s.prompt({ kind: 'text', message: 'Paste callback', signal: controller.signal }).catch(() => {})
    controller.abort(); await losing
    await ctx.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: { access: 'test-only' } }))
  })
  const a = (await request({ action: 'start', key, method: 'oauth' })).value
  expect((await waitFor(request, a.id, a => a.status === 'authorized')).prompts).toEqual([])
})
it('does not accept an uncommitted login and can retry after failure without leaking provider errors', async () => {
  let runs = 0
  const { request, key } = await fixture(async (_s, ctx, key) => {
    if (++runs === 1) throw new Error('secret-provider-token')
    await ctx.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: { token: 'test-only' } }))
  })
  const a = (await request({ action: 'start', key, method: 'oauth' })).value
  const failed = await waitFor(request, a.id, a => a.status === 'failed')
  expect(JSON.stringify(failed)).not.toContain('secret-provider-token')
  expect((await request()).value[0].configured).toBe(false)
  const b = (await request({ action: 'start', key, method: 'oauth' })).value
  await waitFor(request, b.id, a => a.status === 'authorized')
})
it('requires a commit even when the flow resolves normally', async () => {
  const { request, key } = await fixture(async () => {})
  const a = (await request({ action: 'start', key, method: 'oauth' })).value
  await waitFor(request, a.id, a => a.status === 'failed')
  expect((await request()).value[0].configured).toBe(false)
})
it('uses authorization records for default-model eligibility even when an optional named key is absent', async () => {
  const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js', import.meta.url), 'utf8')
  const helpers = new Function(source.slice(source.indexOf('function deriveProviderKeyRef('), source.indexOf('async function buildModelCatalog')) + '; return { providerHasUsableCredential };')()
  let configured = false, named
  const credentials = { describeRecord: async () => ({ configured }), describe: async () => ({ configured: false }) }
  const ctx = { llm: { listConfigurableProviders: () => [{ provider: 'vendor', authFlow: 'test-login/vendor', settingsNs: 'test', settingsPath: [] }] }, get: name => ({ credentials, authorization: { describe: () => ({}) }, settings: { get: () => ({ apiKeyEnv: named }) } })[name] }
  expect(await helpers.providerHasUsableCredential(ctx, 'vendor')).toBe(false)
  configured = true
  expect(await helpers.providerHasUsableCredential(ctx, 'vendor')).toBe(true)
  named = 'EXPLICIT_KEY'
  expect(await helpers.providerHasUsableCredential(ctx, 'vendor')).toBe(true)
})
it('keeps flow metadata through the UI directory join and excludes unsigned-in providers', async () => {
  const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js', import.meta.url), 'utf8')
  const extract = name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\t\\t\\}`))[0]
  const { joinProviderDirectory, providerUsable } = new Function(`${extract('joinProviderDirectory')}\n${extract('providerUsable')}; return {joinProviderDirectory, providerUsable};`)()
  const [entry] = joinProviderDirectory([{id:'codex'}], [{provider:'codex', displayName:'ChatGPT',settingsNs:'llm',settingsPath:[],authFlow:'llm/codex'}])
  expect(entry.authFlow).toBe('llm/codex')
  expect(providerUsable({entry})).toBe(false)
  expect(providerUsable({entry,authorization:{configured:true}})).toBe(true)
  expect(providerUsable({entry:{...entry,authFlow:undefined}})).toBe(true)
})
it('mounts only inside the authenticated Connection fence and cleans up on unload', async () => {
  const { ctx } = await fixture(async s => s.prompt({kind:'text',message:'Code'}))
  const Connection = await import('@deepseek-ai/dsh-client-connection')
  const {default: WebServer} = await import('@deepseek-ai/dsh-host-webserver')
  const {registerAuthorization} = await import('../packages/dsh-desktop-client-ui/authorization.js')
  for (const [plugin, config] of [[Connection], [WebServer,{host:'127.0.0.1',port:0}]]) {
    const f=await ctx.plugin(plugin,config);cleanup.push(()=>f.dispose())
  }
  const f=await ctx.plugin({apply:registerAuthorization});cleanup.push(()=>f.dispose())
  await new Promise(setImmediate)
  const base=`http://127.0.0.1:${ctx.webServer.port}`
  const response=await fetch(`${base}/api/desktop.authorization`)
  expect(response.status).toBe(401)
  const wrongOrigin=await fetch(`${base}/api/desktop.authorization`,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'})
  expect(wrongOrigin.status).toBe(403)
})
it('rejects unknown methods, unrelated flows and unknown attempt capabilities', async () => {
  const {request,key}=await fixture(async () => {})
  expect((await request({action:'start',key:'unrelated/key',method:'oauth'})).status).toBe(400)
  expect((await request({action:'start',key,method:'not-offered'})).status).toBe(400)
  expect((await request({action:'cancel',id:'not-an-attempt'})).status).toBe(404)
})
