import { describe, expect, it, vi } from 'vitest'
import {
  fetchDesktopReleaseNotes,
  formatReleaseBody,
  GITHUB_RELEASES_REPO,
  githubReleasesUrl,
  parseGitHubReleases,
  releaseHeading
} from '../src/main/release-notes'

describe('GitHub release notes for Settings > Version', () => {
  it('reads this fork’s published releases', () => {
    expect(GITHUB_RELEASES_REPO).toBe('0-CHENAI/dsh-desktop')
    expect(githubReleasesUrl()).toBe(
      'https://api.github.com/repos/0-CHENAI/dsh-desktop/releases?per_page=10'
    )
  })

  it('keeps published notes and drops drafts or malformed rows', () => {
    expect(
      parseGitHubReleases([
        {
          tag_name: 'v0.1.2',
          name: 'DSH Desktop v0.1.2 — Win64 发版',
          published_at: '2026-04-01T12:00:00Z',
          draft: false,
          body: '# DSH Desktop v0.1.2 — Win64 发版\n\n## 更新内容\n\n### 发版\n\nWindows 可以打出版本号。'
        },
        {
          tag_name: 'v0.1.1',
          name: '',
          published_at: '2026-03-20T12:00:00Z',
          draft: true,
          body: 'hidden'
        },
        { name: 'no tag' },
        42
      ])
    ).toEqual([
      {
        version: '0.1.2',
        tag: 'v0.1.2',
        heading: 'v0.1.2 — Win64 发版',
        publishedAt: '2026-04-01T12:00:00Z',
        body: '更新内容\n\n发版\n\nWindows 可以打出版本号。'
      }
    ])
  })

  it('returns an empty list for a non-array payload', () => {
    expect(parseGitHubReleases(null)).toEqual([])
    expect(parseGitHubReleases({ tag_name: 'v1' })).toEqual([])
  })

  it('strips markdown headings and the duplicated title line', () => {
    expect(
      formatReleaseBody('# DSH Desktop v0.1.2 — theme\r\n\r\n## 问题修复\r\n\r\n\r\n修好了。')
    ).toBe('问题修复\n\n修好了。')
  })

  it('falls back to the tag when the release has no title', () => {
    expect(releaseHeading('v0.1.2', '')).toBe('v0.1.2')
    expect(releaseHeading('v0.1.2', '  hotfix  ')).toBe('hotfix')
  })

  it('fetches and parses the GitHub releases payload', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          tag_name: 'v0.1.2',
          name: 'DSH Desktop v0.1.2',
          published_at: '2026-04-01T00:00:00Z',
          body: '## 更新内容\n修好了。'
        }
      ]
    }))
    await expect(fetchDesktopReleaseNotes(fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      releases: [
        {
          version: '0.1.2',
          tag: 'v0.1.2',
          heading: 'v0.1.2',
          publishedAt: '2026-04-01T00:00:00Z',
          body: '更新内容\n修好了。'
        }
      ],
      failed: false
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      githubReleasesUrl(),
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github+json' })
      })
    )
  })

  it('marks a failed request without throwing', async () => {
    await expect(
      fetchDesktopReleaseNotes(async () => ({ ok: false, status: 502 }) as Response)
    ).resolves.toEqual({ releases: [], failed: true })
    await expect(
      fetchDesktopReleaseNotes(async () => {
        throw new Error('offline')
      })
    ).resolves.toEqual({ releases: [], failed: true })
  })
})
