import { randomUUID } from 'node:crypto'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'

const endpoint = '/api/desktop.authorization'
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const safeUrl = (value) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

/** Browser attempts expose notices and prompts, never credential records or provider errors. */
export function createAuthorizationBridge(ctx) {
  const attempts = new Map()
  const snapshot = (a) => ({ id: a.id, status: a.status, notices: a.notices, prompts: [...a.prompts.values()].map(p => p.view), error: a.error })
  const dispose = () => { for (const a of attempts.values()) a.controller.abort(); attempts.clear() }
  const sweep = setInterval(() => {
    for (const [id, a] of attempts) if (Date.now() - a.touched > (a.status === 'running' ? 15 * 60_000 : 60_000)) { a.controller.abort(); attempts.delete(id) }
  }, 15_000)
  sweep.unref?.()
  const list = async () => Promise.all(ctx.llm.listConfigurableProviders().filter(p => p.authFlow).map(async p => {
    const flow = ctx.authorization.describe(p.authFlow)
    const info = await ctx.credentials.describeRecord(p.authFlow)
    return { key: p.authFlow, configured: !!flow && info.configured === true, label: flow?.label ?? p.displayName,
      methods: flow?.methods.map(({ id, label }) => ({ id, label })) ?? [] }
  }))
  return {
    dispose() { clearInterval(sweep); dispose() },
    async fetch(request) {
      try {
        if (request.method === 'GET') return json(await list())
        const body = await request.json()
        if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, 400)
        if (body.action === 'start') {
          const flow = ctx.authorization.describe(body.key)
          if (!ctx.llm.listConfigurableProviders().some(p => p.authFlow === body.key) || !flow || !flow.methods.some(m => m.id === body.method)) return json({ error: 'Login method unavailable' }, 400)
          if ([...attempts.values()].some(a => a.key === body.key && a.status === 'running')) return json({ error: 'Login already in progress' }, 409)
          const a = { id: randomUUID(), key: body.key, controller: new AbortController(), status: 'running', touched: Date.now(), notices: [], prompts: new Map() }
          attempts.set(a.id, a)
          const interaction = {
            notify(n) {
              if (a.controller.signal.aborted || a.status !== 'running') return
              const notice = { message: n.message, ...(safeUrl(n.url) ? { url: safeUrl(n.url) } : {}), ...(n.code ? { code: n.code } : {}) }
              // Progress replaces progress; actionable links/codes remain available.
              if (!notice.url && !notice.code && a.notices.length && !a.notices.at(-1).url && !a.notices.at(-1).code) a.notices.pop()
              a.notices.push(notice)
            },
            prompt(p) {
              return new Promise((resolve, reject) => {
                if (a.controller.signal.aborted || p.signal?.aborted) { reject(new Error('Prompt withdrawn')); return }
                const id = randomUUID()
                const cleanup = () => { a.prompts.delete(id); a.controller.signal.removeEventListener('abort', abort); p.signal?.removeEventListener('abort', abort) }
                const finish = (fn, value) => { cleanup(); fn(value) }
                const abort = () => finish(reject, new Error('Prompt withdrawn'))
                const view = { id, kind: p.kind, message: p.message, ...(p.placeholder ? { placeholder: p.placeholder } : {}), ...(p.kind === 'select' ? { options: p.options.map(({ id, label, description }) => ({ id, label, description })) } : {}) }
                a.prompts.set(id, { view, resolve: value => finish(resolve, value), decline: () => finish(reject, new AuthorizationDeclinedError()) })
                a.controller.signal.addEventListener('abort', abort, { once: true })
                p.signal?.addEventListener('abort', abort, { once: true })
              })
            }
          }
          a.done = ctx.authorization.begin({ key: body.key, method: body.method, interaction, signal: a.controller.signal })
            .then(result => { a.status = result.status })
            .catch(() => { a.status = a.controller.signal.aborted ? 'cancelled' : 'failed'; a.error = a.status === 'failed' ? 'Sign-in failed. Please try again.' : undefined })
            .finally(() => { a.controller.abort(); a.prompts.clear(); a.notices = []; a.touched = Date.now() })
          return json(snapshot(a))
        }
        const a = attempts.get(body.id)
        if (!a) return json({ error: 'Login expired. Please try again.' }, 404)
        a.touched = Date.now()
        if (body.action === 'poll') return json(snapshot(a))
        if (body.action === 'cancel') { a.controller.abort(); await a.done; return json(snapshot(a)) }
        if (body.action === 'answer') {
          const p = a.prompts.get(body.promptId)
          if (!p || a.status !== 'running') return json({ error: 'Prompt expired' }, 409)
          if (body.declined === true) p.decline()
          else {
            if (typeof body.value !== 'string' || (p.view.kind === 'select' && !p.view.options.some(o => o.id === body.value))) return json({ error: 'Invalid answer' }, 400)
            p.resolve(body.value)
          }
          return json(snapshot(a))
        }
        return json({ error: 'Invalid action' }, 400)
      } catch { return json({ error: 'Authorization unavailable. Please try again.' }, 500) }
    }
  }
}

export function registerAuthorization(ctx) {
  ctx.inject(['connection', 'authorization', 'credentials', 'llm'], scope => {
    const bridge = createAuthorizationBridge(scope)
    scope.effect(() => scope.connection.fetch.register({ path: endpoint, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: request => bridge.fetch(request) }))
    scope.effect(() => () => bridge.dispose())
  })
}
