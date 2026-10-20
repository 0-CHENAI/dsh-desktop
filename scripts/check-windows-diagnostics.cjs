const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { buildSync } = require('esbuild')

if (process.platform !== 'win32') throw new Error('This native test requires Windows')
const scratch = mkdtempSync(join(tmpdir(), 'dsh-windows-diagnostics-'))
const entry = join(scratch, 'fixture.cjs')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
function run(stateDir, mode) {
  rmSync(join(stateDir, 'observed.json'), { force: true })
  try {
    execFileSync(require('electron'), [entry, stateDir, mode,
      resolve(__dirname, 'fixtures/windows-message.cjs'), resolve(__dirname, '..')], {
      env, windowsHide: true, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    let observed = 'No event observation recorded'
    try { observed = readFileSync(join(stateDir, 'observed.json'), 'utf8') } catch {}
    throw new Error(`${mode} failed (${error.status}): ${observed}; ${String(error.stderr || '')}`)
  }
  const result = JSON.parse(readFileSync(join(stateDir, 'observed.json'), 'utf8'))
  assert.equal(result.error, '', `${mode}: ${result.error}`)
  assert.equal(result.requests, 0, 'Reports must never be uploaded by a test')
  return result
}
try {
  buildSync({ entryPoints: [resolve(__dirname, 'fixtures/windows-diagnostics.ts')], outfile: entry,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] })
  for (const mode of ['system-end', 'query-only', 'tray-close', 'clean-quit', 'crash', 'system-end-with-crash', 'probe-guard']) {
    const stateDir = join(scratch, mode)
    mkdirSync(stateDir)
    const repetitions = mode === 'system-end' ? 3 : 1
    for (let attempt = 0; attempt < repetitions; attempt++) {
      const result = run(stateDir, mode)
      const clean = ['system-end', 'system-end-with-crash', 'clean-quit', 'probe-guard'].includes(mode)
      assert.equal(result.marker, !clean, `${mode}: session marker`)
      assert.equal(result.sessionEnd, mode.startsWith('system-end'), `${mode}: native session-end`)
      assert.equal(result.willQuit, mode === 'clean-quit' || mode === 'probe-guard', `${mode}: will-quit`)
      if (mode === 'probe-guard') assert.equal(result.probeRejections, 2, 'Reject foreign owners and unapproved messages')
      const next = run(stateDir, 'check')
      const reports = mode.includes('crash') ? ['main-crash'] : clean ? [] : ['unclean-exit']
      assert.deepEqual(next.reports, reports, `${mode}: next startup reports`)
      assert.deepEqual(run(stateDir, 'check').reports, [], `${mode}: declined report must not reappear`)
    }
  }
  console.log('Windows diagnostics: 7 native scenarios passed, including 3 system-end/restart cycles and isolated probe guards')
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
