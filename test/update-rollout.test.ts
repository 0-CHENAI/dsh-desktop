import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  policy: vi.fn(), handlers: new Map<string, (...args: any[]) => void>(),
  updater: { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(), on: vi.fn(), autoDownload: false, allowDowngrade: false, allowPrerelease: false }
}))
vi.mock('../src/main/desktop-service', () => ({ checkDesktopUpdate: mocks.policy }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.8.0', getPath: () => '/nonexistent-desktop-test', isReady: () => true }, BrowserWindow: { getAllWindows: () => [] }, powerMonitor: { on: vi.fn(), removeListener: vi.fn() }, ipcMain: { handle: vi.fn() } }))
vi.mock('../src/main/update/update-policy', async importOriginal => ({ ...await importOriginal<object>(), supportsAutoUpdates: () => true }))
let manager: typeof import('../src/main/update/update-manager')
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.handlers.clear()
  mocks.updater.on.mockImplementation((event, callback) => { mocks.handlers.set(event, callback) })
  mocks.updater.downloadUpdate.mockResolvedValue([])
  manager = await import('../src/main/update/update-manager')
  manager.startUpdateManager({ prepareToInstall: async () => {} })
})
afterEach(() => manager.stopUpdateManager())
it('keeps packaged update checks on this fork release channel', async () => {
  await manager.checkForUpdates(true)
  expect(mocks.policy).not.toHaveBeenCalled()
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({
    provider: 'generic',
    url: 'https://github.com/0-CHENAI/dsh-desktop/releases/latest/download/'
  })
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
})
it('holds the existing lock and waits for user acceptance to download', async () => {
  let resolve!: () => void
  mocks.updater.checkForUpdates.mockImplementation(async () => {
    mocks.handlers.get('update-available')!({ version: '0.9.0' })
    await new Promise<void>(r => { resolve = r })
    return { updateInfo: { version: '0.9.0' } }
  })
  const checking = manager.checkForUpdates()
  await manager.checkForUpdates(true)
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(manager.getUpdateStatus().phase).toBe('available')
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  resolve()
  await checking
  await manager.downloadAvailableUpdate()
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
})
it('blocks mismatched metadata before it can enter the download UI', async () => {
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.10.0' }); expect(manager.getUpdateStatus().phase).toBe('error'); return { updateInfo: { version: '0.10.0' } } })
  await manager.installSpecificVersion('0.9.0')
  await manager.downloadAvailableUpdate()
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
})
it('preserves explicitly selected history installs and validates version input', async () => {
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.7.0' }); return { updateInfo: { version: '0.7.0' } } })
  await manager.installSpecificVersion('../../unsafe')
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  await manager.installSpecificVersion('0.7.0')
  expect(mocks.policy).not.toHaveBeenCalled()
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({
    provider: 'generic',
    url: 'https://github.com/0-CHENAI/dsh-desktop/releases/download/v0.7.0/'
  })
  expect(mocks.updater.allowDowngrade).toBe(false)
})
