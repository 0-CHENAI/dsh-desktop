import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

/**
 * Write a stable version into package.json and the lockfile root.
 * Avoids spawning `npm` so Windows CI does not fail with spawnSync ENOENT.
 * @param {string} version
 * @param {string} projectRoot
 */
export function applyReleaseVersion(version, projectRoot) {
  const normalized = formatStableVersion(parseStableVersion(version))
  const packagePath = path.join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  packageJson.version = normalized
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const lockPath = path.join(projectRoot, 'package-lock.json')
  if (!existsSync(lockPath)) return normalized
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.version = normalized
  if (lock.packages && typeof lock.packages === 'object' && lock.packages['']) {
    lock.packages[''].version = normalized
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  return normalized
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
  let apply = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--minor') bump = 'minor'
    else if (arg === '--major') bump = 'major'
    else if (arg === '--apply') apply = true
    else if (arg === '--set') {
      setVersion = argv[index + 1] ?? ''
      index += 1
    } else if (arg.startsWith('--set=')) setVersion = arg.slice('--set='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return { bump, setVersion, apply }
}

function resolveCliVersion(setVersion, bump) {
  if (setVersion) return formatStableVersion(parseStableVersion(setVersion))
  const override = String(process.env.RELEASE_VERSION_OVERRIDE ?? '').trim()
  if (override) return formatStableVersion(parseStableVersion(override))
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  return resolveNextReleaseVersion({
    packageVersion: String(packageJson.version),
    lastStableVersion: readLastStableVersion(readGitStableTags()),
    bump
  })
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const { bump, setVersion, apply } = parseArgs(process.argv.slice(2))
  const version = resolveCliVersion(setVersion, bump)
  if (apply) {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    applyReleaseVersion(version, projectRoot)
    console.log(`Resolved app version ${version}`)
  } else {
    process.stdout.write(`${version}\n`)
  }
}
