import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// electron-builder writes a top-level stable version into each update manifest.
// Use those versions instead of recomputing from tags after the build finishes.
export function readReleaseArtifactVersion(directory) {
  const versions = ['latest-mac.yml', 'latest.yml'].map(name => {
    const text = readFileSync(join(directory, name), 'utf8')
    const fields = [...text.matchAll(/^version:[ \t]*(.*?)[ \t]*\r?$/gm)]
    if (fields.length !== 1) throw new Error(`${name}: expected one version field`)
    const value = fields[0][1].replace(/^(['"])(.*)\1$/, '$2')
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
      throw new Error(`${name}: invalid stable version ${value}`)
    }
    return value
  })
  if (versions[0] !== versions[1]) throw new Error(`Artifact versions differ: ${versions.join(' / ')}`)
  return versions[0]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${readReleaseArtifactVersion(process.argv[2] ?? 'release-assets')}\n`)
}
