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
    expect(workflow).toContain('npm test')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm run build')
  })
})
