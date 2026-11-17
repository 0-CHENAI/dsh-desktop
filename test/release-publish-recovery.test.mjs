import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { pythonExecutable } from './python-executable'

const source = readFileSync('.github/workflows/release.yml', 'utf8')
const { jobs } = parse(source)

// Parent-only dispatch modes are deliberately not installed in this fork.
// Keep their standalone validator exercised without claiming those modes exist.
describe('fork publication and optional source validator', () => {
  it('rejects invalid source runs and signed artifacts through the real validator', () => {
    const result = spawnSync(pythonExecutable, ['test/release-publish-source.py'], { encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
  })

  it('publishes only after native and signing dependencies succeed', () => {
    for (const name of ['publish', 'publish-main', 'publish-prerelease']) {
      const windows = name === 'publish-main' ? 'windows-x64' : 'sign-windows'
      expect(jobs[name].needs).toEqual(['macos-apple-silicon', windows])
      expect(jobs[name].if).toContain("needs.macos-apple-silicon.result == 'success'")
      expect(jobs[name].if).toContain(`needs.${windows}.result == 'success'`)
      const steps = jobs[name].steps
      if (name === 'publish-main') {
        expect(steps.some(step => step.name === 'Publish GitHub Release')).toBe(true)
        continue
      }
      const verify = steps.findIndex(step => /verify-release-assets\.mjs/.test(step.run || ''))
      const publish = steps.findIndex(step => /gh release (?:create|upload)/.test(step.run || ''))
      expect(verify).toBeGreaterThan(-1)
      expect(publish).toBeGreaterThan(verify)
    }
  })

  it('retains immutable tag checks and the fork artifact source', () => {
    expect(source).toContain('refusing to overwrite it')
    expect(source).toContain('git rev-parse')
    expect(source).not.toContain('DESKTOP_CSC_LINK')
    expect(source).not.toContain("inputs.mode == 'publish'")
    expect(jobs['publish-main'].steps.find(step => step.uses === 'actions/checkout@v4').with['fetch-depth']).toBe(0)
  })
})
