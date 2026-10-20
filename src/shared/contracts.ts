import type { PluginStartupFailure } from './plugin-startup-failure'

export type RuntimePhase =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface RuntimeSnapshot {
  phase: RuntimePhase
  message: string
  launchDirectory?: string
  logs: string[]
  url?: string
  /** Per-process launch token; only `GET /?token=` exchanges it for a session cookie. */
  authToken?: string
  pluginFailures?: PluginStartupFailure[]
  /** Desktop-owned failure classification; Harness-reported causes stay in `message`/`pluginFailures`. */
  failureReason?: 'startup-timeout'
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unsupported'

export type ManualUpdateReason = 'unsigned-macos' | 'readonly-macos'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  availableVersion?: string
  installing?: boolean
  percent?: number
  message?: string
  manual: boolean
  source?: 'startup' | 'runtime' | 'manual'
  /** Changes only when the user explicitly requests another presentation. */
  presentationId?: number
  locale?: 'en' | 'zh'
  /** Plain text only; render without interpreting HTML from update metadata. */
  releaseNotes?: string
  /** Set while an explicitly chosen older version is being installed. */
  downgrade?: boolean
  /**
   * False when this build can only open a download page. Signed macOS and
   * installed Windows builds download and apply the update in-app.
   */
  canInstall?: boolean
  /** Why this installed build requires manual updates. */
  manualUpdateReason?: ManualUpdateReason
}

/** One past release the user may install or roll back to, from the update index. */
export interface AvailableRelease {
  version: string
  tag: string
  archiveUrl: string
}

/** One published GitHub Release shown on the Settings > Version page. */
export interface DesktopReleaseNote {
  version: string
  tag: string
  heading: string
  publishedAt: string | null
  body: string
}

/** Payload for the Settings > Version page. */
export interface VersionPageInfo {
  desktopVersion: string
  harnessVersion: string
  locale: 'en' | 'zh'
  releases: DesktopReleaseNote[]
  notesError?: string
}
