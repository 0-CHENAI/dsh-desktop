import { describe, expect, it } from 'vitest'
import {
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
})
