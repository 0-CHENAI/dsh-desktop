import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readReleaseArtifactVersion } from '../scripts/read-release-artifact-version.mjs'

const directories = []
function fixture(mac, windows) {
  const dir = mkdtempSync(join(tmpdir(), 'release-artifacts-'))
  directories.push(dir)
  writeFileSync(join(dir, 'latest-mac.yml'), mac)
  writeFileSync(join(dir, 'latest.yml'), windows)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('uses the matching built version, including CRLF and quoted YAML scalars', () => {
  expect(readReleaseArtifactVersion(fixture('version: 0.1.7\nfiles: []\n', 'version: "0.1.7"\r\nfiles: []\r\n'))).toBe('0.1.7')
})
it('refuses mismatched builds instead of publishing a misleading release', () => {
  expect(() => readReleaseArtifactVersion(fixture('version: 0.1.7\n', 'version: 0.1.8\n'))).toThrow('versions differ')
})
it.each(['files: []\n', 'version: 0.1.7\nversion: 0.1.8\n', 'version: 0.1.7-rc.1\n'])('refuses malformed manifests: %s', manifest => {
  expect(() => readReleaseArtifactVersion(fixture(manifest, 'version: 0.1.7\n'))).toThrow()
})
