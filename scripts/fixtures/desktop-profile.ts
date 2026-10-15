import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, utilityProcess, ipcMain } from 'electron'
import { HarnessRuntime } from '../../src/main/runtime/harness-runtime'
import { launchDisclaimedUtilityProcess } from '../../src/main/runtime/disclaimed-utility-process'
import { electronNodeExecutable } from '../../src/main/runtime/electron-node-executable'
import { SafeModeFrame } from '../../src/main/safe-mode-frame'
import { buildSafeModeViewModel } from '../../src/main/safe-mode'
import { desktopResourceUrl, installDesktopProtocol, registerDesktopScheme, SAFE_MODE_PAGE } from '../../src/main/desktop-protocol'

const [appRoot, resourcesArg, executableArg, output] = process.argv.slice(2)
if (!appRoot || !output) throw new Error('Missing application root or output directory')
const runtimeRoot = appRoot
const outputDirectory = output
// The parent owns this whole temporary app directory and removes it after
// Electron exits; Chromium still holds its userData SQLite files until then.
const home = mkdtempSync(join(app.getAppPath(), 'profile-'))
const resources = resourcesArg || join(appRoot, 'build')
app.setPath('userData', join(home, 'electron'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
registerDesktopScheme()
app.on('window-all-closed', () => {})
let win: BrowserWindow | undefined
let runtime: HarnessRuntime | undefined

async function main(): Promise<void> {
  await app.whenReady()
  installDesktopProtocol(name => join(resources, name))
  runtime = new HarnessRuntime({
    dshEntryPath: join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    nodeEntryPath: join(resources, 'harness-node-entry.mjs'),
    nodeExecutablePath: executableArg || electronNodeExecutable(process.execPath),
    dshPatchPath: join(resources, 'dsh-desktop.patch.yml'),
    dshSafePatchPath: join(resources, 'dsh-desktop-safe.patch.yml'),
    dshMarketPatchPath: join(resources, 'dsh-desktop-market.patch.yml'),
    dshHome: join(home, 'harness'), logPath: join(home, 'harness.log'),
    preferredPort: 0, startupTimeoutMs: 60_000,
    launchProcess: (executable, args, options) => process.platform === 'darwin'
      ? launchDisclaimedUtilityProcess(utilityProcess, args, options, { disclaim: false })
      : spawn(executable, args, options),
    onChanged() {}
  })
  await runtime.start(home)
  const state = runtime.snapshot()
  assert.equal(state.phase, 'ready', `Harness startup failed: ${state.failureReason || state.message}`)
  assert.ok(state.url && state.authToken)
  // Assert real unauthenticated rejection before using the process-local token.
  assert.equal((await fetch(new URL('/api/session/list', state.url), { method: 'POST' })).status, 401)
  win = new BrowserWindow({ width: 1380, height: 900, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true,
      backgroundThrottling: false,
      preload: join(app.getAppPath(), 'preload.cjs') } })
  ipcMain.handle('desktop-titlebar:is-fullscreen', () => win?.isFullScreen() ?? false)
  ipcMain.handle('desktop-titlebar:set-theme', () => {})
  ipcMain.handle('desktop-titlebar:close-menu', () => {})
  ipcMain.on('dsh:storage-load-sync', event => { event.returnValue = {} })
  ipcMain.on('dsh:storage-sync', () => {})
  ipcMain.handle('updates:status', () => ({ phase: 'idle', currentVersion: '0.0.0', manual: false }))
  ipcMain.handle('mobile:status', () => ({ connected: false }))
  ipcMain.handle('safe-mode:status', () => ({ active: false }))
  ipcMain.handle('harness:renderer-healthy', () => ({ ok: true }))
  let pageErrors = 0
  win.webContents.on('console-message', details => { if (details.level === 'error') pageErrors++ })
  const url = new URL(state.url)
  url.searchParams.set('token', state.authToken)
  await win.loadURL(url.href)
  const deadline = Date.now() + 30_000
  let mounted = false
  while (Date.now() < deadline) {
    mounted = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-dsh-sidebar-root]') && document.querySelector('#root')?.childElementCount && !Array.from(document.querySelectorAll('[role="status"]')).some(el => /Loading local workbenches|正在读取本地工作台/.test(el.textContent || '')))`)
    if (mounted) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(mounted, 'Authenticated HTML did not activate the real Harness client/sidebar')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(pageErrors, 0, 'Harness client emitted console errors during activation')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'client.png'), (await win.webContents.capturePage()).toPNG())
  if (process.platform === 'win32') await verifySidebarToggle(win)
  await verifySafeModeFrame(win)
  assert.equal(pageErrors, 0, 'Safe Mode emitted console errors on the real Harness host')
  console.log(`Desktop profile: Electron ${process.versions.electron}, authenticated HTML/bootstrap and real client mounted; isolated ${process.platform} profile`)
}

async function verifySidebarToggle(window: BrowserWindow): Promise<void> {
  for (const zoom of [0.67, 1, 1.5]) {
    window.webContents.setZoomFactor(zoom)
    await new Promise(resolve => setTimeout(resolve, 200))
    const read = async () => window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('[data-dsh-sidebar-root]');
      const toggle = root?.querySelector('[data-dsh-sidebar-toggle]');
      const brand = root?.querySelector('[data-dsh-sidebar-brand-identity]');
      if (!root || !toggle) throw new Error('Sidebar toggle marker missing');
      const r = toggle.getBoundingClientRect();
      const b = brand?.getBoundingClientRect();
      return { wide: root.dataset.dshSidebarWide, count: document.querySelectorAll('[data-dsh-sidebar-toggle]').length,
        x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right,
        edge: root.getBoundingClientRect().right, brandY: b && b.y + b.height / 2,
        hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-dsh-sidebar-toggle]') === toggle,
        position: getComputedStyle(toggle).position };
    })()`)
    const click = async (point: { x: number; y: number }) => {
      const x = Math.round(point.x * zoom), y = Math.round(point.y * zoom)
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 })
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 })
      await new Promise(resolve => setTimeout(resolve, 350))
    }
    const initial = await read()
    if (initial.wide === 'false') await click(initial)
    const wide = await read()
    assert.equal(wide.wide, 'true')
    assert.equal(wide.count, 1)
    assert.equal(wide.position, 'static')
    assert.ok(Math.abs(wide.y - wide.brandY) < 3, 'Toggle must align with the brand row')
    assert.ok(wide.edge - wide.right >= 0 && wide.edge - wide.right < 24)
    assert.equal(wide.hit, true)
    await click(wide)
    const collapsed = await read()
    assert.equal(collapsed.wide, 'false')
    assert.equal(collapsed.count, 1)
    assert.equal(collapsed.position, 'fixed', 'Keep the collapsed reopen entry reachable')
    assert.equal(collapsed.hit, true)
    await click(collapsed)
    assert.equal((await read()).wide, 'true')
  }
  window.webContents.setZoomFactor(1)
  await writeFile(join(outputDirectory, 'sidebar-toggle.png'), (await window.webContents.capturePage()).toPNG())
  console.log('Windows sidebar toggle: brand-row alignment and native collapse/reopen at three zoom levels passed')
}

async function verifySafeModeFrame(window: BrowserWindow): Promise<void> {
  let closed = 0
  const manager = new SafeModeFrame(window, () => { closed++ })
  const model = buildSafeModeViewModel({ locale: 'en', plugins: ['native-smoke-plugin'] })
  const frameUrl = desktopResourceUrl(SAFE_MODE_PAGE, {
    state: JSON.stringify(model), theme: 'light', icon: resourcesArg ? 'icon.png' : 'app-icon.png', seq: 'native-smoke'
  })
  manager.show(frameUrl)
  const waitForFrame = async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const frame = window.webContents.mainFrame.framesInSubtree.find(value => value.url === frameUrl)
      const mounted = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-dsh-sidebar-root]'))`)
      if (mounted && frame && await frame.executeJavaScript(`document.readyState === 'complete' && Boolean(document.querySelector('#items li'))`)) return frame
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Safe Mode did not mount through the actual desktop preload and protocol')
  }
  let frame = await waitForFrame()
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'Framed Safe Mode must not create a native overlay window')
  const position = await window.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('#dsh-desktop-safe-mode-frame');
    const sidebar = document.querySelector('[data-dsh-sidebar-root]');
    return { left: host.getBoundingClientRect().left, sidebarRight: sidebar.getBoundingClientRect().right };
  })()`)
  assert.ok(Math.abs(position.left - position.sidebarRight) <= 1, 'Safe Mode must leave the actual sidebar usable')
  await frame.executeJavaScript(`document.body.dataset.nativeSmoke = 'same-document'`)
  const updatedModel = buildSafeModeViewModel({ locale: 'en', plugins: ['native-smoke-plugin'],
    healthReports: [{ packageName: 'native-smoke-plugin', installedVersion: '1.0.0',
      latestVersion: '2.0.0', healthStatus: 'upgrade-available', healthLabel: 'Native smoke updated',
      upgradeReady: true, upgradeVersion: '2.0.0' }] })
  manager.applyUpdate({ seq: 'native-smoke', model: updatedModel })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await frame.executeJavaScript(`document.body.textContent.includes('Native smoke updated') && document.body.dataset.nativeSmoke === 'same-document'`), true)
  manager.applyUpdate({ seq: 'stale-smoke', model: {
    ...updatedModel, pluginItems: updatedModel.pluginItems.map(item => ({ ...item, statusLabel: 'Stale smoke must not apply' }))
  } })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await frame.executeJavaScript(`document.body.textContent.includes('Stale smoke must not apply')`), false)
  const actions: string[] = []
  ipcMain.handle('safe-mode:action', (_event, action: string) => { actions.push(action); return { ok: true } })
  assert.deepEqual(await frame.executeJavaScript(`window.dshSafeMode.action('upgrade', { plugins: ['native-smoke-plugin'] })`), { ok: true })
  assert.deepEqual(actions, ['upgrade'])
  await window.webContents.executeJavaScript(`window.postMessage({ type: 'dsh-safe-mode:action', id: 999, action: 'uninstall' }, '*')`)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(actions, ['upgrade'], 'Only the trusted Safe Mode frame may relay actions')
  await writeFile(join(outputDirectory, 'safe-mode.png'), (await window.webContents.capturePage()).toPNG())
  // The real host reload must reattach the frame without replacing its manager.
  const loaded = once(window.webContents, 'did-finish-load', { signal: AbortSignal.timeout(15_000) })
  window.webContents.reload()
  await loaded
  frame = await waitForFrame()
  assert.equal(await frame.executeJavaScript(`Boolean(document.querySelector('#items li'))`), true)
  manager.close()
  manager.close()
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(closed, 1)
  assert.equal(await window.webContents.executeJavaScript(`Boolean(document.querySelector('#dsh-desktop-safe-mode-frame'))`), false)
  const next = new SafeModeFrame(window, () => { closed++ })
  window.destroy()
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(next.isDestroyed(), true)
  assert.equal(closed, 2)
  console.log('Safe Mode frame: real Harness sidebar, in-place model update, stale update rejection, host reload and idempotent lifecycle passed')
}

// No raw runtime log, cookies or launch tokens are copied to test output.
void main().then(async () => {
  win?.destroy()
  await runtime?.stop()
  app.quit()
}).catch(async error => {
  console.error(error)
  win?.destroy()
  await runtime?.stop()
  app.exit(1)
})
