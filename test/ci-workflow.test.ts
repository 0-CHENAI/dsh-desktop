import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('pull request CI', () => {
  it('runs test, typecheck, and build on PRs to main and test', async () => {
    const workflow = (
      await readFile(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
    ).replace(/\r\n/g, '\n')

    expect(workflow).toMatch(/^name: CI$/m)
    expect(workflow).toContain('pull_request:')
    expect(workflow).toMatch(
      /pull_request:\n(?:[ \t]+[^\n]+\n)*?[ \t]+branches:\n(?:[ \t]+-[ \t]+\S+\n)*?[ \t]+- main\n(?:[ \t]+-[ \t]+\S+\n)*?[ \t]+- test\n/
    )
    const config = parse(workflow) as {
      jobs: {
        check: { 'runs-on': string }
        'native-runtime': { strategy: { matrix: { os: string[] } } }
      }
    }
    // Office preparation is intentionally target-native, not bypassed for CI.
    expect(config.jobs.check['runs-on']).toBe('windows-latest')
    expect(config.jobs['native-runtime'].strategy.matrix.os).toEqual([
      'windows-latest', 'macos-15'
    ])
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm exec -- vitest run')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm run build')
  })
})


it('builds once per native job while retaining tests, packaging and target gates', async () => {
  for (const file of ['ci.yml', 'release.yml']) {
    const workflow = parse(await readFile(path.join(projectRoot, '.github/workflows', file), 'utf8'))
    const jobs = file === 'ci.yml' ? ['check', 'native-runtime'] : ['macos-apple-silicon', 'windows-x64']
    for (const name of jobs) {
      const steps = workflow.jobs[name].steps as { run?: string; uses?: string; with?: { path?: string } }[]
      const runs = steps.map(step => step.run || '')
      expect(runs.filter(run => run.includes('npm run build'))).toHaveLength(1)
      expect(runs.some(run => /npm test|npm run package:/.test(run))).toBe(false)
      expect(steps.some(step => step.uses === 'actions/cache@v4' && step.with?.path?.includes('.build/office-downloads'))).toBe(true)
      if (name !== 'native-runtime') {
        expect(runs).toContain('npm exec -- vitest run')
        expect(runs.indexOf('npm run typecheck')).toBeGreaterThanOrEqual(0)
        expect(runs.indexOf('npm run typecheck')).toBeLessThan(runs.indexOf('npm run build'))
        expect(runs.indexOf('npm run build')).toBeLessThan(runs.indexOf('npm exec -- vitest run'))
      }
      if (name !== 'check') {
        expect(runs.some(run => run.includes('verify-target.mjs'))).toBe(true)
        expect(runs.some(run => run.includes('electron-builder'))).toBe(true)
      }
    }
  }
})

it('cancels obsolete PR installers without interrupting releases', async () => {
  const workflow = parse(await readFile(path.join(projectRoot, '.github/workflows/release.yml'), 'utf8'))
  expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}")
  expect(workflow.concurrency.group).toBe('desktop-release-${{ github.ref }}')
})
