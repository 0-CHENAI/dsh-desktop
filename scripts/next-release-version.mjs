import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STABLE = /^v?(\d+)\.(\d+)\.(\d+)$/u

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number }}
 */
export function parseStableVersion(version) {
  const match = String(version).trim().match(STABLE)
  if (!match) throw new Error(`Not a stable x.y.z version: ${version}`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/**
 * @param {{ major: number, minor: number, patch: number }} parts
 * @returns {string}
 */
export function formatStableVersion(parts) {
  return `${String(parts.major)}.${String(parts.minor)}.${String(parts.patch)}`
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareStableVersion(left, right) {
  const a = parseStableVersion(left)
  const b = parseStableVersion(right)
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/**
 * @param {string} version
 * @param {'patch' | 'minor' | 'major'} bump
 * @returns {string}
 */
export function bumpStableVersion(version, bump) {
  const parts = parseStableVersion(version)
  if (bump === 'major') return formatStableVersion({ major: parts.major + 1, minor: 0, patch: 0 })
  if (bump === 'minor') return formatStableVersion({ major: parts.major, minor: parts.minor + 1, patch: 0 })
  return formatStableVersion({ major: parts.major, minor: parts.minor, patch: parts.patch + 1 })
}

/**
 * Default is last released tag + 0.0.1. A newer package.json wins so a
 * requested 0.2.0 / 1.0.0 is not overwritten.
 * @param {{ packageVersion: string, lastStableVersion?: string, bump?: 'patch' | 'minor' | 'major' }} options
 * @returns {string}
 */
export function resolveNextReleaseVersion({
  packageVersion,
  lastStableVersion = '',
  bump = 'patch'
}) {
  if (bump === 'minor' || bump === 'major') {
    const base = lastStableVersion && compareStableVersion(packageVersion, lastStableVersion) < 0
      ? lastStableVersion
      : packageVersion
    return bumpStableVersion(base, bump)
  }
  if (!lastStableVersion) return bumpStableVersion(packageVersion, 'patch')
  if (compareStableVersion(packageVersion, lastStableVersion) > 0) {
    return formatStableVersion(parseStableVersion(packageVersion))
  }
  return bumpStableVersion(lastStableVersion, 'patch')
}

/**
 * @param {readonly string[]} tagNames
 * @returns {string}
 */
export function readLastStableVersion(tagNames) {
  let latest = ''
  for (const name of tagNames) {
    const normalized = String(name).trim()
    if (!STABLE.test(normalized)) continue
    const version = formatStableVersion(parseStableVersion(normalized))
    if (!latest || compareStableVersion(version, latest) > 0) latest = version
  }
  return latest
}

function readGitStableTags() {
  try {
    const output = execFileSync('git', ['tag', '--list', 'v*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return output.split(/\r?\n/u).filter(Boolean)
  } catch {
    return []
  }
}

function parseArgs(argv) {
  let bump = 'patch'
  let setVersion = ''
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--minor') bump = 'minor'
    else if (arg === '--major') bump = 'major'
    else if (arg === '--set') {
      setVersion = argv[index + 1] ?? ''
      index += 1
    } else if (arg.startsWith('--set=')) setVersion = arg.slice('--set='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return { bump, setVersion }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const { bump, setVersion } = parseArgs(process.argv.slice(2))
  if (setVersion) {
    process.stdout.write(`${formatStableVersion(parseStableVersion(setVersion))}\n`)
  } else {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const version = resolveNextReleaseVersion({
      packageVersion: String(packageJson.version),
      lastStableVersion: readLastStableVersion(readGitStableTags()),
      bump
    })
    process.stdout.write(`${version}\n`)
  }
}
