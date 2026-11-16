import { readFileSync, existsSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { resolveVitestConfig, WINDOWS_COMPLETE_EXCLUDES, WINDOWS_SERIAL_SUITES } from '../vitest.config'

const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
const nativeJobs = ['macos-apple-silicon', 'windows-x64']
function enabled(expression, target, event = 'workflow_dispatch', ref = 'refs/heads/test') {
  return runInNewContext(expression, {
    github: { event_name: event, ref }, inputs: { target, prerelease_tag: '' },
    startsWith: (value, prefix) => value.startsWith(prefix)
  })
}

describe('fork release CI after the v0.14 migration', () => {
  it('preserves the existing dispatch and release identity instead of importing parent signing inputs', () => {
    expect(Object.keys(release.on.workflow_dispatch.inputs)).toEqual(['target', 'prerelease_tag', 'version'])
    expect(release.on.workflow_dispatch.inputs.target.default).toBe('all')
    expect(release.on.pull_request.branches).toEqual(['main'])
    expect(release.concurrency['cancel-in-progress']).toBe(false)
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).not.toContain('DESKTOP_CSC_LINK')
  })

  it.each(['all', 'macos', 'windows'])('schedules the requested native build for %s', target => {
    expect(enabled(release.jobs['macos-apple-silicon'].if, target)).toBe(target !== 'windows')
    expect(enabled(release.jobs['windows-x64'].if, target)).toBe(target !== 'macos')
    for (const name of nativeJobs) {
      expect(enabled(release.jobs[name].if, target, 'pull_request')).toBe(true)
      expect(enabled(release.jobs[name].if, target, 'push', 'refs/tags/v1.0.0')).toBe(true)
    }
  })

  it('retains complete tests, type checks and native client acceptance before packaging', () => {
    for (const name of nativeJobs) {
      const steps = release.jobs[name].steps
      const commands = steps.map(step => step.run || '').join('\n')
      expect(commands).toContain('npm test')
      expect(commands).toContain('npm run typecheck')
      expect(commands).toContain('npm run build')
      expect(commands).toContain('node scripts/check-desktop-profile.cjs')
      expect(steps.some(step => step.run === 'npm ci')).toBe(true)
      for (const step of steps.filter(step => step.uses === 'actions/setup-node@v4')) {
        expect(step.with['node-version']).toBe(24)
      }
    }
  })

  it('keeps publication downstream of the successful native builds and Windows signing', () => {
    expect(release.jobs['sign-windows'].needs).toBe('windows-x64')
    for (const name of ['publish', 'publish-main', 'publish-prerelease']) {
      const windows = name === 'publish-main' ? 'windows-x64' : 'sign-windows'
      expect(release.jobs[name].needs).toEqual(['macos-apple-silicon', windows])
      expect(release.jobs[name].if).toContain("needs.macos-apple-silicon.result == 'success'")
      expect(release.jobs[name].if).toContain(`needs.${windows}.result == 'success'`)
    }
  })

  it('uses moved verification scripts which actually exist', () => {
    for (const workflow of [release, ci]) for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps || []) for (const match of (step.run || '').matchAll(/\bnode (scripts\/[\w/.-]+\.(?:mjs|cjs))/g)) {
        expect(existsSync(match[1]), match[1]).toBe(true)
      }
    }
  })

  it('retains native packaged-client verification and does not permanently exclude Windows tests', () => {
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('dist-dev/win-unpacked/resources/app.asar')
    expect(WINDOWS_COMPLETE_EXCLUDES).toEqual([])
    const parallel = resolveVitestConfig('windows-parallel').test
    const serial = resolveVitestConfig('windows-serial').test
    expect(parallel.fileParallelism).toBe(true)
    expect(serial.fileParallelism).toBe(false)
    expect(serial.include).toEqual(WINDOWS_SERIAL_SUITES)
    for (const pattern of WINDOWS_SERIAL_SUITES) expect(parallel.exclude).toContain(pattern)
  })
})
