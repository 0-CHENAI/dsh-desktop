import type { UpdateStatus } from '../shared/contracts'

export type UpdateLocale = 'en' | 'zh'

export function shouldShowUpdate(status: UpdateStatus): boolean {
  if (['available', 'downloading', 'downloaded'].includes(status.phase)) return true
  return status.manual && ['checking', 'up-to-date', 'error', 'unsupported'].includes(status.phase)
}

export function isUpdateDismissed(
  status: UpdateStatus,
  dismissedVersion: string | null,
  dismissedTransientPhase: UpdateStatus['phase'] | null = null
): boolean {
  if (status.availableVersion) return status.availableVersion === dismissedVersion
  return status.phase === dismissedTransientPhase
}

export interface UpdateHeadline {
  title: string
  description: string
}

/**
 * The card's two lines: what happened, then what it means for the user.
 *
 * The version belongs in the second line rather than the first — a release
 * number answers "which one", not "what now", and reading the state should not
 * require parsing a version string out of a sentence.
 */
export function updateHeadline(status: UpdateStatus, locale: UpdateLocale): UpdateHeadline {
  const zh = locale === 'zh'
  const version = status.availableVersion ? `v${status.availableVersion}` : ''

  if (status.installing) {
    return {
      title: zh ? '正在重启…' : 'Restarting…',
      description: zh ? `正在安装 ${version}` : `Installing ${version}`
    }
  }

  if (status.downgrade && status.availableVersion) {
    return {
      title: zh ? `正在降级到 ${version}` : `Downgrading to ${version}`,
      description: zh
        ? `将当前 v${status.currentVersion} 回退到 ${version}`
        : `Rolling back v${status.currentVersion} to ${version}`
    }
  }

  switch (status.phase) {
    case 'checking':
      return {
        title: zh ? '正在检查更新' : 'Checking for updates',
        description: zh ? `当前 v${status.currentVersion}` : `Currently on v${status.currentVersion}`
      }
    case 'available':
      return {
        title: zh ? '有可用更新' : 'Update available',
        description: status.canInstall === false
          ? manualInstallDescription(status, locale, version)
          : zh
            ? `${version} 已发布，同意后下载并自动重启安装。`
            : `${version} will download and automatically restart to install.`
      }
    case 'downloading':
      return {
        title: zh ? '正在下载更新' : 'Downloading update',
        description: zh ? `${version} · ${Math.round(status.percent ?? 0)}%` : `${version} · ${Math.round(status.percent ?? 0)}%`
      }
    case 'downloaded':
      return {
        title: zh ? '更新已就绪' : 'Update ready',
        description: zh
          ? `${version} 将在重启后生效。`
          : `${version} will be applied on next launch.`
      }
    case 'up-to-date':
      return {
        title: zh ? '已是最新版本' : 'Up to date',
        description: zh ? `当前 v${status.currentVersion}` : `Currently on v${status.currentVersion}`
      }
    case 'unsupported':
      return {
        title: zh ? '此版本不支持自动更新' : 'Automatic updates unavailable',
        description: zh ? '请从官网下载新版本。' : 'Download new versions from the website.'
      }
    case 'error':
      return {
        title: zh ? '更新失败' : 'Update failed',
        description: zh ? '无法检查或下载更新。' : 'Unable to check for or download updates.'
      }
    case 'idle':
      return { title: '', description: '' }
  }
}

export function updateMessage(status: UpdateStatus, locale: UpdateLocale): string {
  const zh = locale === 'zh'
  const version = status.availableVersion ? ` ${status.availableVersion}` : ''

  if (status.downgrade && status.availableVersion) {
    const percent = Math.round(status.percent ?? 0)
    if (status.phase === 'downloading') {
      return zh ? `正在降级到 ${status.availableVersion}（${percent}%）` : `Downgrading to ${status.availableVersion} (${percent}%)`
    }
    if (status.phase === 'downloaded') {
      return zh
        ? `降级包 ${status.availableVersion} 已就绪，重启后生效`
        : `Downgrade ${status.availableVersion} is ready to install`
    }
    return zh ? `正在准备降级到 ${status.availableVersion}` : `Preparing to downgrade to ${status.availableVersion}`
  }

  switch (status.phase) {
    case 'checking':
      return zh ? '正在检查更新…' : 'Checking for updates…'
    case 'available':
      return status.canInstall === false
        ? manualInstallMessage(status, locale, version)
        : zh
          ? `发现新版本${version}，是否更新？`
          : `DSH Desktop${version} is available. Update now?`
    case 'downloading': {
      const percent = Math.round(status.percent ?? 0)
      return zh ? `正在下载更新 ${percent}%` : `Downloading update ${percent}%`
    }
    case 'downloaded':
      return zh ? `DSH Desktop${version} 已下载完成` : `DSH Desktop${version} is ready to install`
    case 'up-to-date':
      return zh ? 'DSH Desktop 已是最新版本' : 'DSH Desktop is up to date'
    case 'unsupported':
      return zh ? '当前版本不支持自动更新' : 'Automatic updates are unavailable in this build'
    case 'error':
      return zh ? '无法检查或下载更新' : 'Unable to check for or download updates'
    case 'idle':
      return ''
  }
}

function manualInstallDescription(
  status: UpdateStatus,
  locale: UpdateLocale,
  version: string
): string {
  const zh = locale === 'zh'
  if (status.manualUpdateReason === 'unsigned-macos') {
    return zh
      ? `${version} 已发布。当前 macOS 版本未使用 Developer ID 签名，请手动安装一次；后续版本即可自动更新。`
      : `${version} is out. This macOS build is not Developer ID signed; install it manually once to enable future automatic updates.`
  }
  if (status.manualUpdateReason === 'readonly-macos') {
    return zh
      ? `${version} 已发布。请将应用移入“应用程序”并手动安装一次，不能从磁盘映像或隔离位置原地更新。`
      : `${version} is out. Move the app to Applications and install it manually once; it cannot update from a disk image or translocated location.`
  }
  return zh
    ? `${version} 已发布。当前构建不能在应用内安装，请手动下载安装包。`
    : `${version} is out. This build cannot install updates in-app; download the installer yourself.`
}

function manualInstallMessage(
  status: UpdateStatus,
  locale: UpdateLocale,
  version: string
): string {
  const zh = locale === 'zh'
  if (status.manualUpdateReason === 'unsigned-macos') {
    return zh
      ? `发现新版本${version}，请手动安装一次以启用后续自动更新。`
      : `DSH Desktop${version} is available. Install it manually once to enable future automatic updates.`
  }
  if (status.manualUpdateReason === 'readonly-macos') {
    return zh
      ? `发现新版本${version}，请移入“应用程序”并手动安装。`
      : `DSH Desktop${version} is available. Move it to Applications and install manually.`
  }
  return zh
    ? `发现新版本${version}，请手动下载安装包。`
    : `DSH Desktop${version} is available. Download the installer yourself.`
}
