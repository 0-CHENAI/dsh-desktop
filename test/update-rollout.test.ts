import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '', selected: '', skipped: vi.fn(), catalog: vi.fn(), send: vi.fn(), policy: vi.fn(), netFetch: vi.fn(),
  handlers: new Map<string, (...args: any[]) => void>(),
  updater: { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(), on: vi.fn() }
}))
vi.mock('../src/main/update/version-catalog', async original => ({ ...await original<object>(), fetchAvailableReleases: mocks.catalog }))
vi.mock('../src/main/update/skipped-version', async original => ({ ...await original<object>(), readSkippedVersion: mocks.skipped }))
vi.mock('../src/main/desktop-service', () => ({ checkDesktopUpdate: mocks.policy }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.8.0', getPath: () => mocks.root, isReady: () => true },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }] },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() }, ipcMain: { handle: vi.fn() },
  net: { fetch: mocks.netFetch }
}))
vi.mock('../src/main/update/update-policy', async original => ({ ...await original<object>(), supportsAutoUpdates: () => true }))
let manager: typeof import('../src/main/update/update-manager')
const latest = (version: string) => new Response(JSON.stringify({ tag_name: 'v' + version, draft: false }))
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.root = await mkdtemp(join(tmpdir(), 'dsh-release-source-'))
  mocks.skipped.mockReturnValue(undefined)
  mocks.netFetch.mockImplementation(async () => latest('0.9.0'))
  mocks.catalog.mockResolvedValue([{ version: '0.7.0', tag: 'v0.7.0' }])
  mocks.updater.on.mockImplementation((event, listener) => mocks.handlers.set(event, listener))
  mocks.updater.setFeedURL.mockImplementation(({ url }) => { mocks.selected = /\/v([^/]+)\/$/.exec(url)?.[1] ?? '' })
  mocks.updater.checkForUpdates.mockImplementation(async () => {
    mocks.handlers.get('update-available')?.({ version: mocks.selected })
    return { updateInfo: { version: mocks.selected } }
  })
  mocks.updater.downloadUpdate.mockImplementation(async () => {
    mocks.handlers.get('update-downloaded')?.({ version: mocks.selected })
    return []
  })
  manager = await import('../src/main/update/update-manager')
  manager.startUpdateManager({ prepareToInstall: async () => {} })
})
afterEach(async () => {
  manager.stopUpdateManager()
  await rm(mocks.root, { recursive: true, force: true, maxRetries: 3 })
})

it('uses the fork GitHub index through Chromium proxy support and never the parent rollout service', async () => {
  await manager.checkForUpdates(true)
  expect(mocks.policy).not.toHaveBeenCalled()
  expect(mocks.netFetch).toHaveBeenCalledWith('https://api.github.com/repos/0-CHENAI/dsh-desktop/releases/latest', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://github.com/0-CHENAI/dsh-desktop/releases/download/v0.9.0/' })
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'available', availableVersion: '0.9.0' })
})

it.each(['up-to-date', 'invalid-index', 'offline'])('does not download after %s', async state => {
  if (state === 'up-to-date') mocks.netFetch.mockImplementation(async () => latest('0.8.0'))
  if (state === 'invalid-index') mocks.netFetch.mockResolvedValue(new Response('{}'))
  if (state === 'offline') mocks.netFetch.mockRejectedValue(new Error('index offline'))
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus().phase).toBe(state === 'up-to-date' ? 'up-to-date' : 'error')
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
})

it('shares an automatic check and allows an explicit manual check to offer a skipped version', async () => {
  mocks.skipped.mockReturnValue('0.9.0')
  const automatic = manager.checkForUpdates()
  await automatic
  expect(manager.getUpdateStatus().phase).toBe('idle')
  await manager.checkForUpdates(true)
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'available', manual: true, availableVersion: '0.9.0' })
})

it('verifies the exact selected archive before allowing a download', async () => {
  mocks.updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.10.0' } })
  await manager.checkForUpdates(true)
  await manager.downloadAvailableUpdate()
  expect(manager.getUpdateStatus().phase).toBe('error')
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
})

it('validates historical versions, keeps their source and never grants automatic install consent', async () => {
  await manager.installSpecificVersion('../../unsafe')
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  await manager.installSpecificVersion('0.7.0')
  expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://github.com/0-CHENAI/dsh-desktop/releases/download/v0.7.0/' })
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'downloaded', availableVersion: '0.7.0' })
})

it.each([false, true])('revalidates consent while an in-flight manual check replaces the offer: %s', async replacement => {
  let finishArchive: (() => void) | undefined
  mocks.netFetch.mockImplementationOnce(async () => latest('0.9.0'))
    .mockImplementation(async () => latest(replacement ? '0.10.0' : '0.9.0'))
  mocks.updater.checkForUpdates.mockImplementationOnce(async () => {
    mocks.handlers.get('update-available')?.({ version: '0.9.0' })
    await new Promise<void>(resolve => { finishArchive = resolve })
    return { updateInfo: { version: '0.9.0' } }
  })
  const automatic = manager.checkForUpdates()
  await vi.waitFor(() => expect(manager.getUpdateStatus().phase).toBe('available'))
  const manual = manager.checkForUpdates(true)
  const accepted = manager.downloadAvailableUpdate()
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  finishArchive?.()
  await Promise.all([automatic, manual, accepted])
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(replacement ? 0 : 1)
  expect(manager.getUpdateStatus().availableVersion).toBe(replacement ? '0.10.0' : '0.9.0')
})
