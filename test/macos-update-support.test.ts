import { describe, expect, it, vi } from 'vitest'
import {
  macApplicationBundlePath,
  macOSUpdateSupport
} from '../src/main/update/macos-update-support'

const executable = '/Applications/DSH Desktop Dev.app/Contents/MacOS/DSH Desktop Dev'

describe('macOS automatic update eligibility', () => {
  it('resolves the application bundle from its executable', () => {
    expect(macApplicationBundlePath(executable)).toBe('/Applications/DSH Desktop Dev.app')
    expect(macApplicationBundlePath('/usr/local/bin/dsh-desktop')).toBeUndefined()
  })

  it('accepts a verified Developer ID application', () => {
    const runCommand = vi.fn((_file: string, args: readonly string[]) => ({
      status: 0,
      stdout: '',
      stderr: args.includes('--display')
        ? 'Authority=Developer ID Application: DSH Desktop (TEAMID)\nTeamIdentifier=TEAMID'
        : ''
    }))

    expect(macOSUpdateSupport({
      isPackaged: true,
      platform: 'darwin',
      execPath: executable,
      runCommand
    })).toEqual({ supported: true })
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('requires one manual install for an unsigned legacy build', () => {
    expect(macOSUpdateSupport({
      isPackaged: true,
      platform: 'darwin',
      execPath: executable,
      runCommand: () => ({ status: 1 })
    })).toEqual({ supported: false, reason: 'unsigned-macos' })
  })

  it.each([
    '/Volumes/DSH Desktop/DSH Desktop Dev.app/Contents/MacOS/DSH Desktop Dev',
    '/private/var/folders/x/AppTranslocation/DSH Desktop Dev.app/Contents/MacOS/DSH Desktop Dev'
  ])('rejects a read-only or translocated bundle at %s', (execPath) => {
    const runCommand = vi.fn()
    expect(macOSUpdateSupport({
      isPackaged: true,
      platform: 'darwin',
      execPath,
      runCommand
    })).toEqual({ supported: false, reason: 'readonly-macos' })
    expect(runCommand).not.toHaveBeenCalled()
  })
})
