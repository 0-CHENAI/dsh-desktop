/** Real Electron/Harness bootstrap, with isolated profiles and no external LLM calls. */
const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const temp = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
try {
  const worker = join(temp, 'main.cjs')
  buildSync({ entryPoints: ['scripts/fixtures/desktop-profile-preload.ts'], outfile: join(temp, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  buildSync({
    entryPoints: ['scripts/fixtures/desktop-profile.ts'], outfile: worker,
    bundle: true, platform: 'node', format: 'cjs', external: ['electron']
  })
  const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [worker, resolve(process.argv[2] || '.'),
    process.argv[3] ? resolve(process.argv[3]) : '', process.argv[4] ? resolve(process.argv[4]) : '',
    resolve('.build/desktop-profile-smoke')], { cwd: temp, env, stdio: 'inherit', timeout: 120_000, windowsHide: true })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  // This directory was created by this process, never a user Profile.
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
