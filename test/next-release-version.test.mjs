import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyReleaseVersion,
  bumpStableVersion,
  readLastStableVersion,
  resolveNextReleaseVersion
} from '../scripts/next-release-version.mjs'

describe('next release version', () => {
  it('defaults to last tag plus one patch', () => {
    expect(
      resolveNextReleaseVersion({
        packageVersion: '0.1.2',
        lastStableVersion: '0.1.2'
      })
    ).toBe('0.1.3')
    expect(
      resolveNextReleaseVersion({
        packageVersion: '0.1.1',
        lastStableVersion: '0.1.1'
      })
    ).toBe('0.1.2')
  })

  it('keeps a newer package.json so a requested minor or major is not overwritten', () => {
    expect(
      resolveNextReleaseVersion({
        packageVersion: '0.2.0',
        lastStableVersion: '0.1.5'
      })
    ).toBe('0.2.0')
    expect(
      resolveNextReleaseVersion({
        packageVersion: '1.0.0',
        lastStableVersion: '0.9.9'
      })
    ).toBe('1.0.0')
  })

  it('bumps from the higher of package.json and the last tag when asked', () => {
    expect(bumpStableVersion('0.1.2', 'minor')).toBe('0.2.0')
    expect(bumpStableVersion('0.1.2', 'major')).toBe('1.0.0')
    expect(
      resolveNextReleaseVersion({
        packageVersion: '0.1.2',
        lastStableVersion: '0.1.9',
        bump: 'minor'
      })
    ).toBe('0.2.0')
  })

  it('reads the highest stable v tag and ignores pre-releases', () => {
    expect(readLastStableVersion(['v0.1.1', 'v0.1.2-rc.1', 'v0.0.9', 'nightly'])).toBe('0.1.1')
  })

  it('applies the resolved version with a Node command that Windows can run', async () => {
    const workflow = await readFile(
      path.join(import.meta.dirname, '..', '.github', 'workflows', 'release.yml'),
      'utf8'
    )
    expect(workflow).toContain('node scripts/next-release-version.mjs --apply')
    expect(workflow).not.toContain('if [ -n "${{ inputs.version }}" ]')
  })

  it('writes package.json and the lockfile without spawning npm', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dsh-version-'))
    await writeFile(
      path.join(dir, 'package.json'),
      `${JSON.stringify({ name: 'dsh-desktop', version: '0.1.1' }, null, 2)}\n`
    )
    await writeFile(
      path.join(dir, 'package-lock.json'),
      `${JSON.stringify({ name: 'dsh-desktop', version: '0.1.1', packages: { '': { version: '0.1.1' } } }, null, 2)}\n`
    )
    const source = await readFile(
      path.join(import.meta.dirname, '..', 'scripts', 'next-release-version.mjs'),
      'utf8'
    )
    expect(source).not.toContain("execFileSync('npm'")
    expect(applyReleaseVersion('0.1.2', dir)).toBe('0.1.2')
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const lock = JSON.parse(await readFile(path.join(dir, 'package-lock.json'), 'utf8'))
    expect(pkg.version).toBe('0.1.2')
    expect(lock.version).toBe('0.1.2')
    expect(lock.packages[''].version).toBe('0.1.2')
  })
})
