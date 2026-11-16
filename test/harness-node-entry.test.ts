import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { expect, it } from 'vitest'
import {
  PACKAGED_PNPM_ENTRY_ENV, PACKAGED_PNPM_RUNNER_ENV, buildPackagedPnpmInvocation
} from '../build/packaged-pnpm-invocation.mjs'

// The obsolete CLI bootstrap/child_process monkey-patch is no longer shipped.
// Test the replacement Host's actual resolver; test/host covers its subprocess.
it.each(['missing', 'blocked', 'unresolved'] as const)('preserves the scoped host peer boundary: %s', async scenario => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-host-peer-'))
  try {
    const host = join(home, 'host')
    const plugin = join(home, 'plugin')
    const peer = join(host, 'node_modules/@deepseek-ai/shared-peer')
    const ordinary = join(host, 'node_modules/ordinary-host-only')
    await Promise.all([mkdir(peer, { recursive: true }), mkdir(ordinary, { recursive: true }), mkdir(plugin, { recursive: true })])
    await writeFile(join(peer, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/shared-peer', type: 'module', exports: { '.': './index.js', './control': './index.js' }
    }))
    await writeFile(join(peer, 'index.js'), 'export const source = "host"\n')
    await writeFile(join(ordinary, 'package.json'), JSON.stringify({ name: 'ordinary-host-only', type: 'module', exports: './index.js' }))
    await writeFile(join(ordinary, 'index.js'), 'export const source = "must-not-leak"\n')
    await writeFile(join(plugin, 'package.json'), '{"type":"module"}')
    if (scenario === 'blocked') {
      const localPeer = join(plugin, 'node_modules/@deepseek-ai/shared-peer')
      await mkdir(localPeer, { recursive: true })
      await writeFile(join(localPeer, 'package.json'), JSON.stringify({ name: '@deepseek-ai/shared-peer', type: 'module', exports: { '.': './index.js' } }))
      await writeFile(join(localPeer, 'index.js'), 'export const source = "local"\n')
    }
    const specifier = scenario === 'unresolved' ? '@deepseek-ai/missing-peer'
      : scenario === 'blocked' ? '@deepseek-ai/shared-peer/control' : '@deepseek-ai/shared-peer'
    await writeFile(join(plugin, 'index.js'), `import { source } from ${JSON.stringify(specifier)};
      let ordinary = 'missing'; try { await import('ordinary-host-only'); ordinary = 'leaked' } catch {}
      export const result = { source, ordinary }`)
    const hook = join(home, 'host-fallback.mjs')
    const built = buildSync({ entryPoints: ['src/host/module-fallback.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
    await writeFile(hook, built.outputFiles[0]!.text)
    const code = `import { registerHostModuleFallback } from ${JSON.stringify(pathToFileURL(hook).href)};
      const release = registerHostModuleFallback(${JSON.stringify(join(host, 'anchor.mjs'))});
      try { console.log(JSON.stringify({ ok: true, result: (await import(${JSON.stringify(pathToFileURL(join(plugin, 'index.js')).href)})).result })) }
      catch (error) { console.log(JSON.stringify({ ok: false, code: error.code, message: error.message })) }
      finally { release() }`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: home, encoding: 'utf8', timeout: 10_000 })
    expect(child.status, child.stderr).toBe(0)
    const result: { ok: boolean; result?: unknown; code?: string; message?: string } = JSON.parse(child.stdout.trim())
    if (scenario === 'missing') expect(result).toEqual({ ok: true, result: { source: 'host', ordinary: 'missing' } })
    if (scenario === 'blocked') {
      expect(result).toMatchObject({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
      expect(result.message).not.toContain('host fallback')
    }
    if (scenario === 'unresolved') {
      expect(result).toMatchObject({ ok: false, code: 'ERR_MODULE_NOT_FOUND' })
      expect(result.message).toContain(plugin)
      expect(result.message).toContain('host fallback')
    }
  } finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

it('uses the owned Electron pnpm runner rather than a PATH shim', () => {
  expect(buildPackagedPnpmInvocation({
    [PACKAGED_PNPM_ENTRY_ENV]: 'C:\\app\\pnpm.cjs',
    [PACKAGED_PNPM_RUNNER_ENV]: 'C:\\app\\pnpm-runner.mjs'
  }, 'C:\\app\\DSH Desktop.exe', () => true)).toEqual({
    command: 'C:\\app\\DSH Desktop.exe', args: ['C:\\app\\pnpm-runner.mjs', 'C:\\app\\pnpm.cjs'],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  })
})
it('does not pass a missing lock-recovery runner', () => {
  expect(buildPackagedPnpmInvocation({
    [PACKAGED_PNPM_ENTRY_ENV]: 'C:\\app\\pnpm.cjs',
    [PACKAGED_PNPM_RUNNER_ENV]: 'C:\\missing\\runner.mjs'
  }, 'C:\\app\\DSH Desktop.exe', path => path === 'C:\\app\\pnpm.cjs')?.args).toEqual(['C:\\app\\pnpm.cjs'])
})
it('does not invent a packaged pnpm entry', () => {
  expect(buildPackagedPnpmInvocation({}, 'C:\\app\\DSH Desktop.exe', () => true)).toBeUndefined()
})
