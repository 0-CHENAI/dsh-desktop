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

  it('reproduces exit=0 STALE against the unadapted market route', () => {
    const result = update('--unpatched')
    expect(result.status).toBe(502)
    expect(result.payload).toMatchObject({ ok: false, stale: true, exitCode: 0 })
  })

  it('validates the new bytes and reports restart without replacing the running link', () => {
    const result = update()
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({ ok: true, installed: { widget: '2.0.0' }, activation: { widget: { state: 'restart', hot: false } } })
    expect(result.payload.stale).toBeUndefined()
    expect(result.activeVersion).toBe('1.0.0')
    expect(result.linkUnchanged).toBe(true)
  })

  it.each([
    ['--broken', '缺少入口文件'],
    ['--invalid-patch', '组合无法启动'],
    ['--mismatch', '实际安装为 v1.5.0'],
  ])('still rejects and rolls back an invalid candidate: %s', (flag, error) => {
    const result = update(flag)
    expect(result.status).toBe(502)
    expect(result.payload.ok).toBe(false)
    expect(result.payload.error).toContain(error)
    expect(result.payload.installed.widget).toBe('1.0.0')
    expect(result.activeVersion).toBe('1.0.0')
    expect(result.linkUnchanged).toBe(true)
  })

  it('leaves the active-profile rollback path intact and is idempotent', () => {
    const source = readFileSync('packages/dshmarket/lib/routes.js', 'utf8')
    const patched = adaptMarketGenerationSource(source, 'routes.js')
    expect(patched).toContain('restoreProfileManifest(config.profile, manifestBefore, activeProfileDir)')
    expect(adaptMarketGenerationSource(patched, 'routes.js')).toBe(patched)
    expect(() => adaptMarketGenerationSource('unknown upstream contract', 'routes.js')).toThrow('unsupported')
  })
})
