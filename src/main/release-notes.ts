import type { DesktopReleaseNote } from '../shared/contracts'

/** GitHub repo that publishes this fork's installers and release notes. */
export const GITHUB_RELEASES_REPO = '0-CHENAI/dsh-desktop'

const RELEASES_TIMEOUT_MS = 8_000

export function githubReleasesUrl(repo = GITHUB_RELEASES_REPO): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=10`
}

export function githubLatestReleaseUrl(repo = GITHUB_RELEASES_REPO): string {
  return `https://api.github.com/repos/${repo}/releases/latest`
}

export function githubLatestReleasePage(repo = GITHUB_RELEASES_REPO): string {
  return `https://github.com/${repo}/releases/latest`
}

export function formatReleaseBody(body: string): string {
  return body
    .replaceAll('\r\n', '\n')
    .replace(/^# .+\n+/u, '')
    .replace(/^#{1,6} /gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function releaseHeading(tag: string, name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return tag
  return trimmed.replace(/^DSH Desktop\s+/iu, '')
}

export function parseGitHubReleases(raw: unknown): DesktopReleaseNote[] {
  if (!Array.isArray(raw)) return []
  const notes: DesktopReleaseNote[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (record.draft === true) continue
    const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : ''
    if (!tag) continue
    const name = typeof record.name === 'string' ? record.name : ''
    notes.push({
      version: tag.replace(/^v/iu, ''),
      tag,
      heading: releaseHeading(tag, name),
      publishedAt: typeof record.published_at === 'string' ? record.published_at : null,
      body: formatReleaseBody(typeof record.body === 'string' ? record.body : '')
    })
  }
  return notes
}

export async function fetchDesktopReleaseNotes(
  fetchImpl: typeof fetch = globalThis.fetch,
  repo = GITHUB_RELEASES_REPO
): Promise<{ releases: DesktopReleaseNote[]; failed: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RELEASES_TIMEOUT_MS)
  try {
    const response = await fetchImpl(githubReleasesUrl(repo), {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-desktop'
      }
    })
    if (!response.ok) return { releases: [], failed: true }
    return { releases: parseGitHubReleases(await response.json()), failed: false }
  } catch {
    return { releases: [], failed: true }
  } finally {
    clearTimeout(timer)
  }
}
