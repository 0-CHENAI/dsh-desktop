import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('pull request CI', () => {
  it('runs test, typecheck, and build on PRs to main and test', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'ci.yml'),
      'utf8'
    )

    expect(workflow).toMatch(/^name: CI$/m)
    expect(workflow).toContain('pull_request:')
    expect(workflow).toMatch(
      /pull_request:\n(?:[ \t]+[^\n]+\n)*?[ \t]+branches:\n(?:[ \t]+-[ \t]+\S+\n)*?[ \t]+- main\n(?:[ \t]+-[ \t]+\S+\n)*?[ \t]+- test\n/
    )
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm test')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm run build')
  })
})
