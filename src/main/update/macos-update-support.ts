import { spawnSync } from 'node:child_process'
import type { ManualUpdateReason } from '../../shared/contracts'

export interface MacOSUpdateSupport {
  supported: boolean
  reason?: ManualUpdateReason
}

interface CommandResult {
  status: number | null
  stdout?: string | Buffer | null
  stderr?: string | Buffer | null
}

type CommandRunner = (file: string, args: readonly string[]) => CommandResult

interface MacOSUpdateSupportOptions {
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  runCommand?: CommandRunner
}

/** Resolve the bundle that Squirrel.Mac must replace from its executable. */
export function macApplicationBundlePath(execPath: string): string | undefined {
  const normalized = execPath.replaceAll('\\', '/')
  return normalized.match(/^(.+\.app)\/Contents\/MacOS\/[^/]+$/u)?.[1]
}

/**
 * Squirrel.Mac cannot update an unsigned application or one launched from a
 * read-only/translocated bundle. Detect both before presenting an in-app
 * install action so legacy unsigned builds get a usable migration path.
 */
export function macOSUpdateSupport(
  options: MacOSUpdateSupportOptions
): MacOSUpdateSupport {
  if (!options.isPackaged || options.platform !== 'darwin') return { supported: false }

  const bundlePath = macApplicationBundlePath(options.execPath)
  if (!bundlePath) return { supported: false, reason: 'readonly-macos' }
  if (bundlePath.startsWith('/Volumes/') || bundlePath.includes('/AppTranslocation/')) {
    return { supported: false, reason: 'readonly-macos' }
  }

  const runCommand = options.runCommand ?? runCodesign
  const verified = runCommand('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    bundlePath
  ])
  if (verified.status !== 0) return { supported: false, reason: 'unsigned-macos' }

  const details = runCommand('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    bundlePath
  ])
  const output = `${details.stdout ?? ''}\n${details.stderr ?? ''}`
  return /(?:^|\n)Authority=Developer ID Application:/u.test(output)
    ? { supported: true }
    : { supported: false, reason: 'unsigned-macos' }
}

function runCodesign(file: string, args: readonly string[]): CommandResult {
  return spawnSync(file, args, { encoding: 'utf8', windowsHide: true })
}
