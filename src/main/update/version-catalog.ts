import type { AvailableRelease } from '../../shared/contracts'
import {
  GITHUB_RELEASES_REPO,
  githubLatestReleaseUrl,
  githubReleasesUrl,
  parseGitHubReleases
} from '../release-notes'

export type { AvailableRelease }

export const STABLE_FEED_URL = `https://github.com/${GITHUB_RELEASES_REPO}/releases/latest/download/`

const INDEX_TIMEOUT_MS = 8_000

export function githubReleaseTag(version: string): string {
  const trimmed = version.trim()
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

export function archiveFeedUrl(version: string): string {
  return `https://github.com/${GITHUB_RELEASES_REPO}/releases/download/${githubReleaseTag(version)}/`
}

/** Split "1.2.3-rc.1" into ([1,2,3], "rc.1"). Non-numeric segments read as 0. */
function splitVersion(value: string): { nums: number[]; pre: string } {
  const [core = '', ...preParts] = value.trim().split('-')
  const nums = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
  while (nums.length < 3) nums.push(0)
  return { nums, pre: preParts.join('-') }
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = splitVersion(a)
  const right = splitVersion(b)
  for (let i = 0; i < Math.max(left.nums.length, right.nums.length); i += 1) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return comparePrerelease(left.pre, right.pre)
}

/**
 * Semver-style prerelease precedence once the numeric core is equal. A release
 * (no prerelease) sorts above any prerelease; dot-separated identifiers
 * compare with numeric identifiers numerically and below alphanumeric ones,
 * and fewer identifiers sort below more ("alpha" < "alpha.1"). Plain string
 * comparison would order "rc.10" below "rc.9", mis-sorting the archive index
 * (and the picker/downgrade split in the preload) once a prerelease counter
 * reaches two digits.
 */
function comparePrerelease(left: string, right: string): -1 | 0 | 1 {
  if (left === right) return 0
  if (!left) return 1 // release > prerelease
  if (!right) return -1
  const l = left.split('.')
  const r = right.split('.')
  const length = Math.max(l.length, r.length)
  for (let i = 0; i < length; i += 1) {
    const x = l[i]
    const y = r[i]
    if (x === undefined) return -1 // fewer identifiers sorts below
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      // Compare without Number() so leading-zero forms and large counters do
      // not lose precision.
      const nx = x.replace(/^0+/, '') || '0'
      const ny = y.replace(/^0+/, '') || '0'
      if (nx.length !== ny.length) return nx.length < ny.length ? -1 : 1
      if (nx !== ny) return nx < ny ? -1 : 1
      continue
    }
    if (xn) return -1 // numeric identifiers sort below alphanumeric ones
    if (yn) return 1
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

function isRelease(value: unknown): value is AvailableRelease {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.version === 'string' &&
    record.version.length > 0 &&
    typeof record.tag === 'string' &&
    record.tag.length > 0 &&
    typeof record.archiveUrl === 'string' &&
    record.archiveUrl.length > 0
  )
}

export function parseVersionIndex(raw: unknown): AvailableRelease[] {
  if (typeof raw !== 'object' || raw === null) return []
  const versions = (raw as { versions?: unknown }).versions
  if (!Array.isArray(versions)) return []
  return versions.filter(isRelease)
}

export async function fetchAvailableReleases(
  currentVersion: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<AvailableRelease[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), INDEX_TIMEOUT_MS)
  try {
    const response = await fetchImpl(githubReleasesUrl(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-desktop'
      }
    })
    if (!response.ok) {
      throw new Error(`Version index request failed: ${response.status}`)
    }
    return parseGitHubReleases(await response.json())
      .map((release) => ({
        version: release.version,
        tag: release.tag,
        archiveUrl: archiveFeedUrl(release.version)
      }))
      .filter((release) => compareVersions(release.version, currentVersion) !== 0)
      .sort((a, b) => compareVersions(b.version, a.version))
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchLatestPublishedVersion(
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), INDEX_TIMEOUT_MS)
  try {
    const response = await fetchImpl(githubLatestReleaseUrl(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-desktop'
      }
    })
    if (!response.ok) {
      throw new Error(`Latest release request failed: ${response.status}`)
    }
    const version = parseGitHubReleases([await response.json()])[0]?.version
    if (!version) throw new Error('Latest GitHub Release has no version')
    return version
  } finally {
    clearTimeout(timer)
  }
}
