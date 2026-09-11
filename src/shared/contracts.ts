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
  /** Set while an explicitly chosen older version is being installed. */
  downgrade?: boolean
  /**
   * False when this build can only open a download page. Signed macOS and
   * installed Windows builds download and apply the update in-app.
   */
  canInstall?: boolean
  /** Why an installed build requires a one-time manual update. */
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
