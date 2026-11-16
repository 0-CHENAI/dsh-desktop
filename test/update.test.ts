import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  AUTO_INSTALL_ON_APP_QUIT,
  shouldCheckAfterResume,
  supportsAutoUpdates,
  UPDATE_CHECK_INTERVAL_MS
} from '../src/main/update/update-policy'

const execFile = promisify(execFileCallback)
const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('desktop update policy', () => {
  it('only installs a downloaded update after explicit user confirmation', () => {
    expect(AUTO_INSTALL_ON_APP_QUIT).toBe(false)
  })

  it('only enables updates for installed macOS and Windows builds', () => {
    expect(supportsAutoUpdates(true, 'darwin')).toBe(true)
    expect(supportsAutoUpdates(true, 'darwin', false)).toBe(false)
    expect(supportsAutoUpdates(true, 'win32')).toBe(true)
    expect(supportsAutoUpdates(true, 'linux')).toBe(false)
    expect(supportsAutoUpdates(false, 'darwin')).toBe(false)
  })

  it('starts the update manager for packaged development builds too', async () => {
    const main = await readFile(path.join(projectRoot, 'src/main/shell/app.ts'), 'utf8')
    expect(main).toContain('startUpdateManager({')
    expect(main).not.toContain('if (!developmentBuild) {\n    startUpdateManager')
  })

  it('checks after resume only when the interval has elapsed', () => {
    const now = 20_000_000
    expect(shouldCheckAfterResume(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true)
    expect(shouldCheckAfterResume(now - UPDATE_CHECK_INTERVAL_MS + 1, now)).toBe(false)
  })

  it('quarantines app-bundle LaunchAgents before replacing the application', async () => {
    const main = await readFile(path.join(projectRoot, 'src/main/shell/app.ts'), 'utf8')
    const prepare = main.slice(main.indexOf('prepareToInstall: async () => {'))
    expect(prepare.indexOf('await backend.stop()')).toBeLessThan(prepare.indexOf('await quarantineAppBundleLaunchAgents('))
    const recovery = prepare.slice(prepare.indexOf('installFailed: async () => {'))
    expect(recovery.indexOf('quitting = false')).toBeLessThan(recovery.indexOf('await restartDesktop()'))
    expect(recovery).toContain("if (!restored) throw new Error")
  })})

describe('macOS update metadata', () => {
  it('merges both architectures and keeps only ZIP update payloads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-update-metadata-'))
    temporaryRoots.push(root)
    const armPath = path.join(root, 'latest-mac-arm64.yml')
    const x64Path = path.join(root, 'latest-mac-x64.yml')
    const outputPath = path.join(root, 'latest-mac.yml')

    await Promise.all([
      writeFile(
        armPath,
        stringify(metadata('arm64', '2026-08-14T01:00:00.000Z')),
        'utf8'
      ),
      writeFile(x64Path, stringify(metadata('x64', '2026-08-14T02:00:00.000Z')), 'utf8')
    ])
    await execFile(process.execPath, [
      path.join(projectRoot, 'scripts', 'release', 'merge-mac-update-metadata.mjs'),
      armPath,
      x64Path,
      outputPath
    ])

    const merged = parse(await readFile(outputPath, 'utf8')) as {
      version: string
      files: Array<{ url: string; sha512: string }>
      path: string
      releaseDate: string
    }
    expect(merged.version).toBe('0.2.0')
    expect(merged.files.map((file) => file.url)).toEqual([
      'dsh-desktop-mac-arm64.zip',
      'dsh-desktop-mac-x64.zip'
    ])
    expect(merged.path).toBe('dsh-desktop-mac-arm64.zip')
    expect(merged.releaseDate).toBe('2026-08-14T02:00:00.000Z')
  })
})

describe('installing a specific version', () => {
  it('wires the list and install IPC handlers and the downgrade-safe feed swap', async () => {
    const manager = await readFile(
      path.join(projectRoot, 'src/main/update/update-manager.ts'),
      'utf8'
    )
    expect(manager).toContain("ipcMain.handle('updates:list-versions'")
    expect(manager).toContain("ipcMain.handle('updates:install-version'")
    expect(manager).toContain('fetchAvailableReleases(app.getVersion(), requestVersionIndex)')
    expect(manager).toContain('export async function installSpecificVersion')
    expect(manager).toContain('archiveFeedUrl(version)')
    expect(manager).toContain('autoUpdater.allowDowngrade = true')
    expect(manager).toContain("setFeedURL({ provider: 'generic', url: STABLE_FEED_URL })")
    expect(manager).toContain('autoUpdater.allowDowngrade = false')
    expect(manager).toContain('downloadAvailableUpdateOwned(owner)')
  })
})

describe('unpackaged update checks', () => {
  it('compares GitHub Releases instead of marking the environment unsupported', async () => {
    const manager = await readFile(path.join(projectRoot, 'src/main/update/update-manager.ts'), 'utf8')
    expect(manager).toContain('if (!supportsUpdates() && !manual)')
    expect(manager).toContain('fetchLatestPublishedVersion(requestVersionIndex)')
    expect(manager).toContain('if (!canInstallUpdates)')
    expect(manager).not.toContain('checkDesktopUpdate')
    expect(manager).toContain('initialUpdateStatus(app.getVersion(), canInstallUpdates, macOSSupport?.reason)')
  })
  it('labels a GitHub-only offer as a download page, not an in-app install', async () => {
    const [manager, preload, view, messages] = await Promise.all([
      readFile(path.join(projectRoot, 'src/main/update/update-manager.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src/preload/desktop-update-ui.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src/preload/update-view.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src/shared/desktop-update-messages.ts'), 'utf8')
    ])
    expect(manager).toContain('await shell.openExternal(releasePageUrl(status.availableVersion))')
    expect(preload).toContain("'openDownloadPage'")
    expect(view).toContain('status.canInstall === false')
    expect(messages).toContain('打开下载页面')
    expect(messages).toContain('Open download page')
  })})

function metadata(architecture: 'arm64' | 'x64', releaseDate: string) {
  return {
    version: '0.2.0',
    files: [
      {
        url: `dsh-desktop-mac-${architecture}.zip`,
        sha512: `zip-${architecture}`,
        size: 100
      },
      {
        url: `dsh-desktop-mac-${architecture}.dmg`,
        sha512: `dmg-${architecture}`,
        size: 200
      }
    ],
    releaseDate
  }
}
