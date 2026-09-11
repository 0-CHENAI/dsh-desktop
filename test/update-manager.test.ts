import { EventEmitter } from 'node:events'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updater: null as any,
  handlers: new Map<string, (...args: any[]) => any>(),
  send: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true, getPath: () => '/tmp', isReady: () => true },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }] },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../src/main/update/update-policy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/update/update-policy')>(),
  supportsAutoUpdates: () => true
}))
vi.mock('electron-updater', () => ({ default: { get autoUpdater() { return mocks.updater } } }))
vi.mock('../src/main/update/skipped-version', () => ({
  readSkippedVersion: () => undefined, writeSkippedVersion: vi.fn(),
  skippedVersionPath: () => '/tmp/update-skip.json',
  shouldOfferUpdate: () => true
}))
let manager: typeof import('../src/main/update/update-manager')
let finish: () => void
let prepare = vi.fn(async () => {})
beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear()
  mocks.send.mockClear()
  mocks.updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(async () => { mocks.updater.emit('update-available', { version: '1.1.0' }) }),
    downloadUpdate: vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  })
  manager = await import('../src/main/update/update-manager')
  prepare = vi.fn(async () => {})
  manager.registerUpdateHandlers()
  manager.startUpdateManager({ prepareToInstall: prepare })
})
afterEach(() => manager.stopUpdateManager())

async function accept() {
  mocks.updater.emit('update-available', { version: '1.1.0' })
  const download = mocks.handlers.get('updates:download')!()
  expect(manager.getUpdateStatus().phase).toBe('downloading')
  return { download }
}
function complete() {
  mocks.updater.emit('update-downloaded', { version: '1.1.0' })
  finish()
}
it('installs an accepted update once, after preparation, including a cached download without progress', async () => {
  let ready!: () => void
  prepare.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve }))
  const { download } = await accept()
  complete()
  expect(manager.getUpdateStatus().installing).toBe(true)
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  mocks.updater.emit('update-downloaded', { version: '1.1.0' })
  await manager.installDownloadedUpdate()
  expect(prepare).toHaveBeenCalledTimes(1)
  ready()
  await download
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
})
it.each(['updates:dismiss', 'updates:skip'])('revokes automatic installation on %s', async (channel) => {
  const { download } = await accept()
  mocks.handlers.get(channel)!(null, '1.1.0')
  mocks.updater.emit('download-progress', { percent: 80 })
  complete()
  await download
  expect(prepare).not.toHaveBeenCalled()
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  expect(manager.getUpdateStatus().phase).toBe(channel === 'updates:skip' ? 'idle' : 'downloaded')
})
it('keeps a historical version download awaiting explicit installation', async () => {
  const download = manager.installSpecificVersion('1.1.0')
  await vi.waitFor(() => expect(mocks.updater.downloadUpdate).toHaveBeenCalled())
  complete()
  await download
  expect(manager.getUpdateStatus().phase).toBe('downloaded')
  expect(prepare).not.toHaveBeenCalled()
  await manager.installDownloadedUpdate()
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce()
})
it('reports preparation failure instead of quitting', async () => {
  prepare.mockRejectedValue(new Error('stop failed'))
  const { download } = await accept()
  complete()
  await download
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'error', message: 'stop failed' })
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
})

it('does not install a completion event without acceptance or for another version', async () => {
  mocks.updater.emit('update-available', { version: '1.1.0' })
  mocks.updater.emit('update-downloaded', { version: '1.1.0' })
  expect(manager.getUpdateStatus().phase).toBe('available')
  const { download } = await accept()
  mocks.updater.emit('update-downloaded', { version: '1.2.0' })
  expect(prepare).not.toHaveBeenCalled()
  complete()
  await download
  expect(prepare).toHaveBeenCalledOnce()
})
it('clears consent after download failure before a later manual download', async () => {
  mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error('network failed'))
  const { download } = await accept()
  await download
  expect(manager.getUpdateStatus().phase).toBe('error')
  mocks.updater.emit('update-available', { version: '1.1.0' })
  const retry = manager.downloadAvailableUpdate()
  complete()
  await retry
  expect(prepare).not.toHaveBeenCalled()
})

it('shows download errors after the user accepts a background offer', async () => {
  mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error('network failed'))
  const { download } = await accept()
  await download
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'error', manual: true })
})
it('ignores a skip from an obsolete version card', async () => {
  const { download } = await accept()
  manager.skipUpdate('0.9.0')
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'downloading', availableVersion: '1.1.0' })
  complete()
  await download
  expect(prepare).toHaveBeenCalledOnce()
})
it('unlocks the manager when the installer emits an asynchronous error', async () => {
  const { download } = await accept()
  complete()
  await download
  mocks.updater.emit('error', new Error('installer failed'))
  expect(manager.getUpdateStatus()).toMatchObject({ phase: 'error', manual: true })
  await manager.checkForUpdates(true)
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
})
it('does not quit or allow another update when an error interrupts preparation', async () => {
  let ready!: () => void
  prepare.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve }))
  const { download } = await accept()
  complete()
  mocks.updater.emit('error', new Error('installer failed'))
  await manager.checkForUpdates(true)
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  ready()
  await download
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  await manager.checkForUpdates(true)
  expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
})
