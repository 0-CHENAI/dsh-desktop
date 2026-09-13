import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { macPackagePaths } from '../scripts/verify-macos-package.mjs'

describe('macOS package verification paths', () => {
  it('resolves the unpacked app and both distributed containers', () => {
    expect(
      macPackagePaths('dist-dev', 'DSH Desktop Dev', 'dsh-desktop-dev-mac-arm64', 'arm64')
    ).toEqual({
      app: path.resolve('dist-dev', 'mac-arm64', 'DSH Desktop Dev.app'),
      dmg: path.resolve('dist-dev', 'dsh-desktop-dev-mac-arm64.dmg'),
      zip: path.resolve('dist-dev', 'dsh-desktop-dev-mac-arm64.zip')
    })
  })

  it('rejects an incomplete verification target', () => {
    expect(() => macPackagePaths('dist', '', 'dsh-desktop-mac-arm64', 'arm64')).toThrow(
      'output directory, product name, artifact stem, and architecture are required'
    )
  })
})
