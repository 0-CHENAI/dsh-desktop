import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, utilityProcess, ipcMain } from 'electron'
import { HarnessRuntime } from '../../src/main/runtime/harness-runtime'
import { launchDisclaimedUtilityProcess } from '../../src/main/runtime/disclaimed-utility-process'
import { electronNodeExecutable } from '../../src/main/runtime/electron-node-executable'

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
app.on('window-all-closed', () => {})
let win: BrowserWindow | undefined
let runtime: HarnessRuntime | undefined

async function main(): Promise<void> {
  await app.whenReady()
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
      preload: join(app.getAppPath(), 'preload.cjs') } })
  ipcMain.handle('desktop-titlebar:is-fullscreen', () => win?.isFullScreen() ?? false)
  ipcMain.handle('desktop-titlebar:set-theme', () => {})
  ipcMain.handle('desktop-titlebar:close-menu', () => {})
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
  console.log(`Desktop profile: Electron ${process.versions.electron}, authenticated HTML/bootstrap and real client mounted; isolated ${process.platform} profile`)
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
