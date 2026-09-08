import { describe, expect, it } from 'vitest'
import { githubLatestReleaseUrl, githubReleasesUrl } from '../src/main/release-notes'
import {
  archiveFeedUrl,
  compareVersions,
  fetchAvailableReleases,
  fetchLatestPublishedVersion,
  githubReleaseTag,
  parseVersionIndex,
  STABLE_FEED_URL
} from '../src/main/update/version-catalog'

describe('version-catalog constants', () => {
  it('points the stable feed at this fork’s GitHub Releases', () => {
    expect(STABLE_FEED_URL).toBe(
      'https://github.com/0-CHENAI/dsh-desktop/releases/latest/download/'
    )
  })

  it('builds a per-version GitHub Release download url', () => {
    expect(githubReleaseTag('1.2.3')).toBe('v1.2.3')
    expect(githubReleaseTag('v1.2.3')).toBe('v1.2.3')
    expect(archiveFeedUrl('1.2.3')).toBe(
      'https://github.com/0-CHENAI/dsh-desktop/releases/download/v1.2.3/'
    )
  })
})

describe('compareVersions', () => {
  it('orders by numeric segments', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('treats a prerelease as lower than its release', () => {
    expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1)
    expect(compareVersions('1.2.3-rc.1', '1.2.3-rc.2')).toBe(-1)
  })

  it('compares prerelease counters numerically, not lexicographically', () => {
    // "rc.10" < "rc.9" under string comparison; semver says the reverse.
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.9')).toBe(1)
    expect(compareVersions('1.2.3-rc.9', '1.2.3-rc.10')).toBe(-1)
    expect(compareVersions('1.2.3-alpha.10', '1.2.3-alpha.9')).toBe(1)
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.1')).toBe(1)
  })

  it('follows semver identifier precedence', () => {
    // fewer identifiers < more ("alpha" < "alpha.1")
    expect(compareVersions('1.2.3-alpha', '1.2.3-alpha.1')).toBe(-1)
    // numeric identifiers < alphanumeric ones ("1" < "alpha")
    expect(compareVersions('1.2.3-1', '1.2.3-alpha')).toBe(-1)
    expect(compareVersions('1.2.3-alpha', '1.2.3-beta')).toBe(-1)
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.10')).toBe(0)
  })
})

describe('parseVersionIndex', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const raw = {
      versions: [
        { version: '1.2.3', tag: 'v1.2.3', archiveUrl: 'https://example.test/1.2.3/' },
        { version: '', tag: 'v0', archiveUrl: 'x' },
        { nope: true },
        42
      ]
    }
    expect(parseVersionIndex(raw)).toEqual([
      { version: '1.2.3', tag: 'v1.2.3', archiveUrl: 'https://example.test/1.2.3/' }
    ])
  })

  it('returns an empty array for non-objects or a missing versions array', () => {
    expect(parseVersionIndex(null)).toEqual([])
    expect(parseVersionIndex({})).toEqual([])
    expect(parseVersionIndex('nope')).toEqual([])
  })
})

describe('fetchAvailableReleases', () => {
  const index = [
    { tag_name: 'v1.0.0', name: 'v1.0.0', draft: false },
    { tag_name: 'v1.2.0', name: 'v1.2.0', draft: false },
    { tag_name: 'v1.1.0', name: 'v1.1.0', draft: false }
  ]
  const ok = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(index) } as Response)

  it('drops the current version and sorts descending from GitHub Releases', async () => {
    const releases = await fetchAvailableReleases('1.1.0', ok as unknown as typeof fetch)
    expect(releases.map((r) => r.version)).toEqual(['1.2.0', '1.0.0'])
    expect(releases[0]).toEqual({
      version: '1.2.0',
      tag: 'v1.2.0',
      archiveUrl: archiveFeedUrl('1.2.0')
    })
  })

  it('requests this fork’s GitHub Releases API', async () => {
    const fetchImpl = async (url: unknown) => {
      expect(url).toBe(githubReleasesUrl())
      return { ok: true, json: async () => [] }
    }
    await expect(
      fetchAvailableReleases('1.0.0', fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual([])
  })

  it('throws when the request fails', async () => {
    const bad = () => Promise.resolve({ ok: false, status: 503 } as Response)
    await expect(
      fetchAvailableReleases('1.1.0', bad as unknown as typeof fetch)
    ).rejects.toThrow()
  })

  it('throws when the network rejects', async () => {
    const boom = () => Promise.reject(new Error('offline'))
    await expect(
      fetchAvailableReleases('1.1.0', boom as unknown as typeof fetch)
    ).rejects.toThrow('offline')
  })
})

describe('fetchLatestPublishedVersion', () => {
  it('reads the latest GitHub Release version', async () => {
    const fetchImpl = async (url: unknown) => {
      expect(url).toBe(githubLatestReleaseUrl())
      return {
        ok: true,
        json: async () => ({ tag_name: 'v0.1.2', name: 'v0.1.2', draft: false })
      }
    }
    await expect(
      fetchLatestPublishedVersion(fetchImpl as unknown as typeof fetch)
    ).resolves.toBe('0.1.2')
  })

  it('throws when the latest release has no version', async () => {
    const empty = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ draft: true }) } as Response)
    await expect(
      fetchLatestPublishedVersion(empty as unknown as typeof fetch)
    ).rejects.toThrow('Latest GitHub Release has no version')
  })

  it('throws when the request fails', async () => {
    const bad = () => Promise.resolve({ ok: false, status: 404 } as Response)
    await expect(fetchLatestPublishedVersion(bad as unknown as typeof fetch)).rejects.toThrow(
      'Latest release request failed: 404'
    )
  })
})
