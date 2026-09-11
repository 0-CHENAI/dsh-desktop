import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adaptMarketGenerationSource } from '../build/market-generation-compat.mjs'

function update(...args) {
  const output = execFileSync(process.execPath, ['test/fixtures/market-generation-update.mjs', ...args], { encoding: 'utf8' })
  return JSON.parse(output.trim().split('\n').at(-1))
}

describe('market generation update compatibility', () => {
  it('keeps the bundled Node CJS/ESM dependency graph loadable', () => {
    const node = join('node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const script = `
      import { installMarketGenerationCompatibility } from './build/market-generation-compat.mjs';
      installMarketGenerationCompatibility();
      await import('jsdom');
      console.log('loaded');
    `
    expect(execFileSync(node, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('loaded')
  })

  it('lets the published market observe the installed version without the adapter', () => {
    const result = update('--unpatched')
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({ ok: true, installed: { widget: '2.0.0' }, exitCode: 0 })
  })

  it('validates the published version and reports that loaded code needs a restart', () => {
    const result = update()
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({ ok: true, installed: { widget: '2.0.0' }, activation: { widget: { state: 'restart', hot: false } } })
    expect(result.payload.stale).toBeUndefined()
    expect(result.activeVersion).toBe('2.0.0')
    expect(result.linkUnchanged).toBe(false)
  })

  it.each([
    ['--broken', '缺少入口文件'],
    ['--invalid-patch', '组合无法启动'],
  ])('still rejects and rolls back an invalid candidate: %s', (flag, error) => {
    const result = update(flag)
    expect(result.status).toBe(502)
    expect(result.payload.ok).toBe(false)
    expect(result.payload.error).toContain(error)
    expect(result.payload.installed.widget).toBe('1.0.0')
    expect(result.activeVersion).toBe('1.0.0')
    expect(result.linkUnchanged).toBe(true)
  })

  it('rejects a mismatched version before publishing the generation', () => {
    const result = update('--mismatch')
    expect(result.status).toBe(502)
    expect(result.payload).toMatchObject({ ok: false, exitCode: 1, installed: { widget: '1.0.0' } })
    expect(result.payload.stderr).toContain('ERR_RESOLVED_VERSION_MISMATCH')
    expect(result.activeVersion).toBe('1.0.0')
    expect(result.linkUnchanged).toBe(true)
  })

  it('leaves the active-profile rollback path intact and is idempotent', () => {
    const source = readFileSync('node_modules/dshmarket/lib/routes.js', 'utf8')
    const patched = adaptMarketGenerationSource(source, 'routes.js')
    expect(patched).toContain('restoreProfileManifest(config.profile, manifestBefore, activeProfileDir)')
    expect(adaptMarketGenerationSource(patched, 'routes.js')).toBe(patched)
    expect(() => adaptMarketGenerationSource('unknown upstream contract', 'routes.js')).toThrow('unsupported')
  })
})
