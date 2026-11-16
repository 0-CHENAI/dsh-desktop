import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron'
import { DesktopHostProcess } from '../../src/main/shell/backend/host-process'
import { electronNodeExecutable } from '../../src/main/shell/backend/electron-node-executable'
import { writeDesktopProductPatch } from '../../src/main/shell/product-patch'
import { DESKTOP_IPC, SCHEME } from '../../src/main/shell/window/ipc'
import { authenticateWebHost, dispatchAppDocument } from '../../src/main/shell/window/web-document'
import { SafeModeFrame } from '../../src/main/safe-mode-frame'
import { buildSafeModeViewModel } from '../../src/main/safe-mode'
import { desktopResourceUrl, installDesktopProtocol, SAFE_MODE_PAGE, DESKTOP_SCHEME } from '../../src/main/desktop-protocol'
import { WINDOWS_TITLEBAR_HEIGHT } from '../../src/shared/desktop-menu'

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
protocol.registerSchemesAsPrivileged([SCHEME, DESKTOP_SCHEME].map(scheme => ({ scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } })))
app.on('window-all-closed', () => {})
let win: BrowserWindow | undefined
let runtime: DesktopHostProcess | undefined
let nativeMenuRequests = 0

async function main(): Promise<void> {
  await app.whenReady()
  installDesktopProtocol(name => join(resources, name))
  const dshHome = join(home, 'harness')
  const profile = join(dshHome, 'profiles', 'desktop')
  await mkdir(profile, { recursive: true })
  // A physical plugin outside the installation must retain its private
  // dependency while resolving its missing Harness peer from this app only.
  const linkedSource = join(home, 'linked-source')
  const ordinary = join(linkedSource, 'node_modules', 'sample-ordinary')
  const marker = join(home, 'linked-plugin.json')
  await mkdir(ordinary, { recursive: true })
  await writeFile(join(ordinary, 'package.json'), JSON.stringify({ name: 'sample-ordinary', version: '1.0.0', type: 'module', exports: './index.js' }))
  await writeFile(join(ordinary, 'index.js'), "export const marker = 'plugin-private-dependency'\n")
  await writeFile(join(linkedSource, 'package.json'), JSON.stringify({ name: 'desktop-smoke-local', version: '1.0.0', type: 'module', exports: './index.js' }))
  await writeFile(join(linkedSource, 'index.js'), `import { writeFileSync } from 'node:fs';
import { deepFreeze } from '@deepseek-ai/dsh-util-values';
import { marker } from 'sample-ordinary';
export function apply() { writeFileSync(process.env.DSH_SMOKE_LOCAL_MARKER, JSON.stringify(deepFreeze({ ordinary: marker, peer: import.meta.resolve('@deepseek-ai/dsh-util-values') }))) }
`)
  const profileModules = join(dshHome, 'profiles', 'node_modules')
  await mkdir(profileModules, { recursive: true })
  await symlink(linkedSource, join(profileModules, 'desktop-smoke-local'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', private: true,
    dependencies: { 'desktop-smoke-local': `file:${linkedSource}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  const primaryRuntime = resourcesArg ? join(resources, 'office-runtime/primary-runtime') : join(runtimeRoot, '.build/office-runtime/primary-runtime')
  const productPatch = await writeDesktopProductPatch(dshHome, 'desktop', { skipBlockingHmr: process.platform === 'win32' })
  await writeFile(productPatch, `${await readFile(productPatch, 'utf8')}- insert:\n    - id: desktop-smoke-local\n      name: desktop-smoke-local\n`)
  runtime = new DesktopHostProcess({
    node: executableArg || electronNodeExecutable(process.execPath),
    entry: join(runtimeRoot, 'out/main/host.js'), runtimeDir: runtimeRoot, projectDir: profile,
    dshHome, launchRoot: join(home, 'launch-root'), profile: 'desktop', primaryRuntime,
    environment: { ...process.env, DSH_DESKTOP_PATCH_FILE: productPatch, DSH_SMOKE_LOCAL_MARKER: marker,
      DSH_DESKTOP_OFFICE_RESOURCES: join(primaryRuntime, '..'),
      DSH_DESKTOP_OFFICE_CLI: resourcesArg ? join(resources, 'office-cli.mjs') : join(runtimeRoot, 'build/office-cli.mjs') }
  })
  const state = await runtime.start()
  const linked = JSON.parse(await readFile(marker, 'utf8')) as { ordinary: string; peer: string }
  assert.equal(linked.ordinary, 'plugin-private-dependency')
  assert.ok(linked.peer.startsWith(`${pathToFileURL(join(runtimeRoot, 'node_modules')).href}/`), 'Linked plugin did not use the current installation peer')
  console.log('Desktop smoke: physical local plugin retained its own dependency and loaded the current installation Harness peer')
  console.log('Desktop smoke: isolated Host ready')
  const launchToken = new URL(state.url).searchParams.get('token') ?? ''
  // Assert real unauthenticated rejection before using the process-local token.
  assert.equal((await fetch(new URL('/api/session/list', state.url), { method: 'POST' })).status, 401)
  const cookie = await authenticateWebHost(state.url)
  console.log('Desktop smoke: Host authenticated')
  protocol.handle(SCHEME, request => dispatchAppDocument(request, {
    frontendRoot: join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-web-frontend/dist'), hostUrl: state.url, cookie
  }))
  ipcMain.handle(DESKTOP_IPC.boot, () => ({ injections: state.injections, streamBaseUrl: new URL(state.url).origin }))
  ipcMain.handle(DESKTOP_IPC.bootFailed, (_event, message: string) => { throw new Error(message) })
  ipcMain.handle(DESKTOP_IPC.localeBootstrap, () => ({ languages: ['en'], preference: 'en' }))
  ipcMain.handle(DESKTOP_IPC.shortcutsGet, () => ({ revision: 0, bindings: [] }))
  ipcMain.handle(DESKTOP_IPC.mobileStatus, () => ({ connected: false }))
  ipcMain.handle(DESKTOP_IPC.repairDraftGet, () => ({}))
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    const target = new URL(state.url)
    if (new URL(details.url).host !== target.host || details.webContentsId !== win?.webContents.id) return callback({ cancel: true })
    callback({ requestHeaders: { ...details.requestHeaders, Origin: target.origin, Cookie: cookie } })
  })
  win = new BrowserWindow({ width: 1380, height: 900, show: false,
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: '#ffffff' } } : {}),
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true,
      backgroundThrottling: false,
      preload: resourcesArg ? join(runtimeRoot, 'out/preload/app.cjs') : join(app.getAppPath(), 'preload.cjs') } })
  ipcMain.handle(DESKTOP_IPC.windowFullscreen, () => win?.isFullScreen() ?? false)
  win.on('enter-full-screen', () => win?.webContents.send(DESKTOP_IPC.windowFullscreen, true))
  win.on('leave-full-screen', () => win?.webContents.send(DESKTOP_IPC.windowFullscreen, false))
  ipcMain.handle('desktop-titlebar:popup-menu', (_event, name: unknown) => {
    assert.equal(name, 'main')
    nativeMenuRequests++
  })
  ipcMain.handle('desktop-titlebar:set-theme', () => {})
  ipcMain.handle('desktop-titlebar:close-menu', () => {})
  ipcMain.on('dsh:storage-load-sync', event => { event.returnValue = {} })
  ipcMain.on('dsh:storage-sync', () => {})
  ipcMain.handle('updates:status', () => ({ phase: 'idle', currentVersion: '0.0.0', manual: false }))
  ipcMain.handle('updates:dismiss', () => {})
  ipcMain.handle('mobile:status', () => ({ connected: false }))
  ipcMain.handle('safe-mode:status', () => ({ active: false }))
  ipcMain.handle('harness:renderer-healthy', () => ({ ok: true }))
  let pageErrors = 0
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_event, method, params: { type?: string; args?: { objectId?: string }[] }) => {
    if (method !== 'Runtime.consoleAPICalled' || params.type !== 'error') return
    for (const arg of params.args ?? []) if (arg.objectId) {
      void win?.webContents.debugger.sendCommand('Runtime.callFunctionOn', {
        objectId: arg.objectId, returnByValue: true,
        functionDeclaration: 'function(){return String(this.stack || this) + (Array.isArray(this.errors) ? "\\nCauses: " + this.errors.map(e=>String(e.stack || e)).join("\\n") : "")}'
      }).then(value => { if (value.result?.value) console.error(String(value.result.value).replaceAll(launchToken || '__no_token__', '[redacted]').slice(0, 6000)) })
        .catch(() => { /* The renderer may leave before diagnostic evaluation finishes. */ })
    }
  })
  void win.webContents.debugger.sendCommand('Runtime.enable').catch(error => console.error('Desktop smoke debugger:', error.message))
  win.webContents.on('console-message', details => {
    if (details.level !== 'error') return
    pageErrors++
    // This Profile is synthetic; still redact its generated launch token and
    // bound diagnostics so a failed executeJavaScript has useful, safe context.
    console.error(`Harness client renderer error: ${(launchToken ? details.message.replaceAll(launchToken, '[redacted]') : details.message).slice(0, 1000)}`)
  })
  win.webContents.on('preload-error', (_event, _path, error) => { console.error('Desktop smoke preload:', error.message) })
  console.log('Desktop smoke: opening application document')
  await win.loadURL('dsh-app://app/')
  console.log('Desktop smoke: application document loaded')
  const deadline = Date.now() + 30_000
  let mounted = false
  while (Date.now() < deadline) {
    // The fresh Profile asynchronously binds its initial blank session. The
    // sessionless hero is a different slot owner and is intentionally unmounted
    // at that boundary; do not start a session-scoped preview on its old DOM.
    mounted = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-dsh-sidebar-root]') && document.querySelector('[data-conversation-session]')?.dataset.conversationSession && document.querySelector('#root')?.childElementCount && !Array.from(document.querySelectorAll('[role="status"]')).some(el => /Loading local workbenches|正在读取本地工作台/.test(el.textContent || '')))`)
    if (mounted) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!mounted) console.error('Desktop smoke state:', await win.webContents.executeJavaScript(`({ text: document.body.innerText.slice(0, 1000), root: document.querySelector('#root')?.childElementCount, boot: Boolean(window.__DSH_BOOT__), sidebar: Boolean(document.querySelector('[data-dsh-sidebar-root]')) })`))
  assert.ok(mounted, 'Authenticated HTML did not activate the real Harness client/sidebar')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(pageErrors, 0, 'Harness client emitted console errors during activation')
  const desktopUtilities = await win.webContents.executeJavaScript(`({
    phone: document.querySelectorAll('[data-dsh-mobile-entry]').length,
    repair: document.querySelectorAll('[data-dsh-repair-entry]').length
  })`)
  assert.equal(desktopUtilities.phone, 0, 'Desktop sidebar must not offer phone pairing')
  assert.equal(desktopUtilities.repair, 1, 'Desktop sidebar must retain the repair action')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'client.png'), (await win.webContents.capturePage()).toPNG())
  if (process.platform === 'win32') {
    await verifyWindowsContentInset(win)
    if (process.env.DSH_SMOKE_TITLEBAR_MATRIX === '1') await verifyWindowsTitlebarMatrix(win)
  }
  await verifyOfficeTemplateUi(win)
  if (process.platform === 'win32') await verifySidebarToggle(win)
  await verifyDesktopUpdateUi(win)
  await verifySafeModeFrame(win)
  assert.equal(pageErrors, 0, 'Safe Mode emitted console errors on the real Harness host')
  console.log(`Desktop profile: Electron ${process.versions.electron}, authenticated HTML/bootstrap and real client mounted; isolated ${process.platform} profile`)
}

async function verifyWindowsContentInset(window: BrowserWindow): Promise<void> {
  for (const zoom of [0.67, 1, 1.5]) {
    window.webContents.setZoomFactor(zoom)
    await new Promise(resolve => setTimeout(resolve, 200))
    const geometry = await window.webContents.executeJavaScript(`(() => {
      const sidebar = document.querySelector('[data-dsh-sidebar-root]');
      const header = document.querySelector('header[data-window-drag]');
      const frame = document.querySelector('[data-dsh-layout-frame]');
      if (!sidebar || !header || !frame) throw new Error('Windows content markers missing');
      const probe = document.createElement('div');
      probe.style.height = 'env(titlebar-area-height, 0px)'; document.body.append(probe);
      const nativeHeight = probe.getBoundingClientRect().height; probe.remove();
      return { nativeHeight, bodyTop: document.body.getBoundingClientRect().top,
        sidebarTop: sidebar.getBoundingClientRect().top,
        sidebarBottom: sidebar.getBoundingClientRect().bottom, viewportHeight: innerHeight,
        headerTop: header.getBoundingClientRect().top,
        framePadding: getComputedStyle(frame).paddingTop,
        frameBefore: getComputedStyle(frame, '::before').display };
    })()`)
    // 0.2.2 AppFrame owns the caption inset; body must not reserve it again.
    assert.equal(geometry.bodyTop, 0, JSON.stringify({ zoom, geometry }))
    assert.ok(Math.abs(geometry.sidebarTop) < 2,
      `Windows sidebar must extend to the top of the window: ${JSON.stringify({ zoom, geometry })}`)
    assert.ok(Math.abs(geometry.sidebarBottom - geometry.viewportHeight) < 2,
      `Windows sidebar must keep its footer at the bottom: ${JSON.stringify({ zoom, geometry })}`)
    assert.ok(Math.abs(geometry.headerTop) < 2,
      `Windows conversation header must share the native caption row: ${JSON.stringify({ zoom, geometry })}`)
    assert.equal(parseFloat(geometry.framePadding), 0)
    assert.ok(Math.abs(geometry.nativeHeight * zoom - WINDOWS_TITLEBAR_HEIGHT) < 2)
    assert.equal(geometry.frameBefore, 'none')
  }
  window.webContents.setZoomFactor(1)
  console.log('Windows content inset: sidebar and conversation header start at the window top without a second caption row at three zoom levels')
}

/** Real frame geometry plus native clicks over sidebar, rightbar and fullscreen transitions. */
async function verifyWindowsTitlebarMatrix(window: BrowserWindow): Promise<void> {
  const pause = () => new Promise(resolve => setTimeout(resolve, 260))
  async function click(selector: string): Promise<void> {
    const point = await window.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing native click target: ' + ${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      if (document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)}) !== el)
        throw new Error('Covered native click target: ' + ${JSON.stringify(selector)});
      return { x:r.x+r.width/2, y:r.y+r.height/2 };
    })()`)
    const zoom = window.webContents.getZoomFactor()
    const x = Math.round(point.x * zoom), y = Math.round(point.y * zoom)
    window.webContents.sendInputEvent({ type:'mouseDown',button:'left',x,y,clickCount:1 })
    window.webContents.sendInputEvent({ type:'mouseUp',button:'left',x,y,clickCount:1 })
    await pause()
  }
  // A global page has a different main-slot owner from ConversationHeader.
  // Its content must not clip or cover the collapsed sidebar controls.
  await pause()
  if (!await window.webContents.executeJavaScript("document.querySelector('[data-dsh-sidebar-root]').dataset.dshSidebarWide === 'true'")) await click('[data-dsh-sidebar-toggle]')
  await window.webContents.executeJavaScript(`(() => {
    const buttons=Array.from(document.querySelectorAll('[data-dsh-sidebar-root] button'));
    const button=buttons.find(el=>el.getBoundingClientRect().width>0 && /plugins|插件/i.test((el.getAttribute('aria-label')||'')+' '+el.textContent));
    if (!button) throw new Error('Plugins navigation missing: '+JSON.stringify(buttons.map(el=>({label:el.getAttribute('aria-label'),text:el.textContent}))).slice(0,2000));
    button.setAttribute('data-smoke-plugins','');
  })()`)
  await click('[data-smoke-plugins]')
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[data-global-panel]'))"), true)
  await click('[data-dsh-sidebar-toggle]')
  const globalControls = await window.webContents.executeJavaScript(`(() => {
    const column=document.querySelector('[data-dsh-layout-sidebar]');
    return { overflow:getComputedStyle(column).overflow, controls:['data-dsh-sidebar-toggle','data-dsh-sidebar-new-session'].map(marker=>{
      const el=document.querySelector('['+marker+']'), r=el.getBoundingClientRect();
      return {marker,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('['+marker+']')===el};
    })};
  })()`)
  for (const control of globalControls.controls) assert.equal(control.hit, true, JSON.stringify(globalControls))
  await click('[data-dsh-sidebar-new-session]')
  const returnDeadline=Date.now()+10_000
  while (await window.webContents.executeJavaScript("Boolean(document.querySelector('[data-global-panel]'))")) {
    assert.ok(Date.now()<returnDeadline, 'New-session control did not return from Plugins to Conversation')
    await pause()
  }
  await click('[data-dsh-sidebar-toggle]')
  console.log('Windows global page: collapsed reopen/new-session controls remain visible and navigate back to Conversation')
  let count = 0
  for (const width of [900, 1380]) for (const zoom of [0.67, 1, 1.5]) {
    window.setSize(width, 900)
    window.webContents.setZoomFactor(zoom)
    for (const fullscreen of [false, true]) {
      if (window.isFullScreen() !== fullscreen) {
        const changed = once(window, fullscreen ? 'enter-full-screen' : 'leave-full-screen')
        window.setFullScreen(fullscreen)
        await changed
      }
      await pause()
      for (const wide of [true, false]) {
        const isWide = () => window.webContents.executeJavaScript("document.querySelector('[data-dsh-sidebar-root]').dataset.dshSidebarWide === 'true'")
        if (await isWide() !== wide) await click('[data-dsh-sidebar-toggle]')
        assert.equal(await isWide(), wide)
        const read = () => window.webContents.executeJavaScript(`(() => {
          const root=document.documentElement, frame=document.querySelector('[data-dsh-layout-frame]');
          const header=document.querySelector('header[data-window-drag]'), corner=document.querySelector('[data-conversation-header-corner]');
          const r=header.getBoundingClientRect(), c=corner.getBoundingClientRect();
          const probe=document.createElement('div');probe.style.height='env(titlebar-area-height,0px)';document.body.append(probe);
          const nativeHeight=probe.getBoundingClientRect().height;probe.remove();
          const area=document.createElement('div');area.style.cssText='position:fixed;left:env(titlebar-area-x,0px);width:env(titlebar-area-width,calc(100vw - 140px))';document.body.append(area);
          const controlsLeft=area.getBoundingClientRect().right;area.remove();
          const panel=document.querySelector('[data-sidebar-right-open="true"]');
          const leading=document.querySelector('[data-conversation-header-leading]');
          const l=leading.getBoundingClientRect(), toggle=document.querySelector('[data-dsh-sidebar-toggle]').getBoundingClientRect();
          return { fullscreen:root.hasAttribute('data-fullscreen'), top:r.top, nativeHeight,
            leading:{left:l.left,right:l.right,top:l.top,bottom:l.bottom,region:getComputedStyle(leading).getPropertyValue('-webkit-app-region')},
            toggle:{left:toggle.left,right:toggle.right,top:toggle.top,bottom:toggle.bottom},
            panelTop:panel?.getBoundingClientRect().top,
            panelButtons:panel ? Array.from(panel.querySelectorAll('[data-sidebar-right-toggle], [data-sidebar-right-mode]')).map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})) : [],
            rightbar:Boolean(document.querySelector('[data-sidebar-right-open="true"]')), cornerBottom:c.bottom, cornerRight:c.right, controlsLeft,
            buttons:Array.from(corner.querySelectorAll('button')).map(el => ({ label:el.getAttribute('aria-label'),width:el.getBoundingClientRect().width })) };
        })()`)
        const before = await read()
        assert.equal(before.fullscreen, fullscreen)
        assert.ok(Math.abs(before.top) < 2, JSON.stringify({width,zoom,wide,fullscreen,before}))
        assert.ok(before.cornerBottom > before.top)
        if (!wide) {
          const context=JSON.stringify({width,zoom,fullscreen,before})
          assert.equal(before.leading.region, 'no-drag', context)
          assert.ok(before.leading.left <= before.toggle.left && before.leading.right >= before.toggle.right, context)
          assert.ok(before.leading.top <= before.toggle.top && before.leading.bottom >= before.toggle.bottom, context)
        }
        if (!fullscreen && !before.rightbar) assert.ok(before.cornerRight <= before.controlsLeft - 4, JSON.stringify({width,zoom,wide,before}))
        const menu = await window.webContents.executeJavaScript(`(() => {
          const host=document.querySelector('[data-dsh-windows-menu]');
          const button=host?.shadowRoot?.querySelector('button');
          if (!host || !button) throw new Error('Native application menu is missing');
          const r=button.getBoundingClientRect(), brand=document.querySelector('[data-dsh-sidebar-brand-identity]')?.getBoundingClientRect();
          const toggle=document.querySelector('[data-dsh-sidebar-toggle]').getBoundingClientRect();
          const newSession=document.querySelector('[data-dsh-sidebar-new-session]').getBoundingClientRect();
          return { visible:getComputedStyle(host).display!=='none', count:host.shadowRoot.querySelectorAll('button').length,
            top:r.top, right:r.right, left:r.left, centerY:r.y+r.height/2,
            brand:brand && { left:brand.left, right:brand.right, top:brand.top },
            toggleLeft:toggle.left, toggleCenterY:toggle.y+toggle.height/2, newSessionRight:newSession.right };
        })()`)
        assert.equal(menu.count, 1)
        assert.equal(menu.visible, !fullscreen)
        if (!fullscreen) {
          const context = JSON.stringify({ width, zoom, wide, menu })
          if (wide) {
            assert.ok(menu.brand && menu.centerY < menu.brand.top, context)
            assert.ok(Math.abs(menu.centerY - menu.toggleCenterY) < 3, context)
            assert.ok(menu.top >= 0 && menu.top < before.nativeHeight, context)
          } else {
            assert.ok(menu.left >= menu.newSessionRight + 4, context)
            assert.ok(menu.top >= 0 && menu.top < before.nativeHeight, context)
          }
          const previousRequests = nativeMenuRequests
          await click('[data-dsh-windows-menu]')
          assert.equal(nativeMenuRequests, previousRequests + 1, context)
        }
        await click('[data-conversation-header-corner] button')
        const opened = await read()
        assert.notEqual(opened.rightbar, before.rightbar, JSON.stringify({before,opened}))
        if (!fullscreen) {
          const context=JSON.stringify({width,zoom,wide,opened})
          assert.ok(opened.panelTop >= opened.nativeHeight - 1, context)
          assert.equal(opened.panelButtons.length, 2, context)
          for (const button of opened.panelButtons) assert.ok(button.top >= opened.nativeHeight - 1, context)
        }
        await click('[data-sidebar-right-toggle]')
        assert.equal((await read()).rightbar, before.rightbar)
        count++
      }
    }
  }
  if (window.isFullScreen()) { const changed=once(window,'leave-full-screen');window.setFullScreen(false);await changed }
  window.webContents.setZoomFactor(1)
  window.setSize(1380,900)
  await pause()
  // The theme stylesheet keys its tokens from this existing body marker.
  // Exercise both palettes without changing any Profile or OS preference.
  for (const dark of [true, false]) {
    await window.webContents.executeJavaScript(`document.body.toggleAttribute('data-ds-dark-theme', ${dark})`)
    await pause()
    if (!await window.webContents.executeJavaScript("document.querySelector('[data-dsh-sidebar-root]').dataset.dshSidebarWide === 'true'")) {
      await click('[data-dsh-sidebar-toggle]')
    }
    const colors = await window.webContents.executeJavaScript(`(() => {
      const sidebar=document.querySelector('[data-dsh-layout-sidebar]'), root=document.querySelector('[data-dsh-sidebar-root]');
      const menu=document.querySelector('[data-dsh-windows-menu]');
      return { top:root.getBoundingClientRect().top, bottom:root.getBoundingClientRect().bottom,
        height:innerHeight, background:getComputedStyle(sidebar).backgroundColor,
        foreground:getComputedStyle(menu.shadowRoot.querySelector('button')).color };
    })()`)
    assert.ok(Math.abs(colors.top) < 2 && Math.abs(colors.bottom - colors.height) < 2)
    assert.notEqual(colors.foreground, colors.background)
    const previousRequests = nativeMenuRequests
    await click('[data-dsh-windows-menu]')
    assert.equal(nativeMenuRequests, previousRequests + 1)
    await writeFile(join(outputDirectory,`sidebar-top-${dark ? 'dark' : 'light'}.png`),(await window.webContents.capturePage()).toPNG())
  }
  await window.webContents.executeJavaScript("document.body.removeAttribute('data-ds-dark-theme')")
  await writeFile(join(outputDirectory,'titlebar-matrix.png'),(await window.webContents.capturePage()).toPNG())
  console.log(`Windows titlebar matrix: ${count} real client layouts, native rightbar clicks, fullscreen and both sidebar palettes passed`)
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
        edge: root.getBoundingClientRect().right, brandTop: b?.top,
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
    assert.equal(wide.position, 'absolute')
    assert.ok(wide.y < wide.brandTop, 'Toggle must stay in the toolbar above the brand')
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
  console.log('Windows sidebar toggle: separate toolbar and native collapse/reopen at three zoom levels passed')
}

async function verifyOfficeTemplateUi(window: BrowserWindow): Promise<void> {
  for (const [mode, expected] of [['word', 4], ['excel', 3]] as const) {
    // Sidebar activation does not mean the Office catalog request has settled.
    // macOS skips the Windows zoom exercise and can reach this before load()
    // enables the mode buttons; clicking a disabled button is intentionally ignored.
    const actionDeadline = Date.now() + 15_000
    let enabled = false
    while (Date.now() < actionDeadline) {
      enabled = await window.webContents.executeJavaScript(`(() => {
        const action = document.querySelector('[data-office-mode="${mode}"]')
        if (!action || action.disabled) return false
        action.click()
        return true
      })()`)
      if (enabled) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(enabled, `${mode} mode action did not become enabled`)
    const deadline = Date.now() + 15_000
    let ready = false
    while (Date.now() < deadline) {
      ready = await window.webContents.executeJavaScript(`document.querySelectorAll('[data-office-dock="${mode}"] [data-office-template]').length === ${expected} && Array.from(document.querySelectorAll('[data-office-template] img')).every(image => image.complete && image.naturalWidth > 0)`)
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) {
      const state = await window.webContents.executeJavaScript(`({ pressed: document.querySelector('[data-office-mode="${mode}"]')?.getAttribute('aria-pressed'), disabled: document.querySelector('[data-office-mode="${mode}"]')?.disabled, cards: document.querySelectorAll('[data-office-template]').length, images: Array.from(document.querySelectorAll('[data-office-template] img')).map(image => ({ complete: image.complete, width: image.naturalWidth })) })`)
      throw new Error(`${mode} templates did not load: ${JSON.stringify(state)}`)
    }
    const openDeadline = Date.now() + 15_000
    let opened = false
    while (Date.now() < openDeadline) {
      opened = await window.webContents.executeJavaScript(`(() => {
        const action = document.querySelector('[data-office-dock="${mode}"] [data-office-template] .dso-card-preview')
        if (!action || action.disabled || document.querySelector('dialog.dso-modal[open]')) return false
        action.click()
        return true
      })()`)
      if (opened) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(opened, `${mode} preview action did not become interactive`)
    const previewDeadline = Date.now() + 15_000
    let preview = false
    while (Date.now() < previewDeadline) {
      preview = await window.webContents.executeJavaScript(`Boolean(document.querySelector('dialog.dso-modal[open] .dso-page img')?.naturalWidth)`)
      if (preview) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!preview) {
      const state = await window.webContents.executeJavaScript(`({ dialogs: Array.from(document.querySelectorAll('dialog.dso-modal')).map(dialog => ({ open: dialog.open, width: dialog.clientWidth, height: dialog.clientHeight })), images: Array.from(document.querySelectorAll('dialog.dso-modal .dso-page img')).map(image => ({ complete: image.complete, width: image.naturalWidth, bytes: image.src.length })), errors: Array.from(document.querySelectorAll('dialog.dso-modal [role="alert"]')).map(node => node.textContent.slice(0, 200)) })`)
      await writeFile(join(outputDirectory, `office-${mode}-failed.png`), (await window.webContents.capturePage()).toPNG())
      throw new Error(`${mode} native template preview did not render: ${JSON.stringify(state)}`)
    }
    await writeFile(join(outputDirectory, `office-${mode}.png`), (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('dialog.dso-modal[open] .dso-close').click()`)
    const closeDeadline = Date.now() + 5_000
    while (await window.webContents.executeJavaScript(`Boolean(document.querySelector('dialog.dso-modal[open]'))`)) {
      assert.ok(Date.now() < closeDeadline, `${mode} preview did not close`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  console.log('Office UI: real Word/Excel catalogs, authenticated previews and modal close passed')
}

async function verifyDesktopUpdateUi(window: BrowserWindow): Promise<void> {
  window.webContents.send('updates:status-changed', { phase: 'available', currentVersion: '0.0.0', availableVersion: '0.0.1', manual: false, source: 'startup', locale: 'en' })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('dsh-desktop-update-root')?.style.right`), '20px')
  window.webContents.send('updates:status-changed', { phase: 'available', currentVersion: '0.0.0', availableVersion: '0.0.1', manual: true, presentationId: 1, locale: 'zh', canInstall: false, manualUpdateReason: 'unsigned-macos' })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('dsh-desktop-update-root')?.style.left`), '50%')
  await writeFile(join(outputDirectory, 'update-manual.png'), (await window.webContents.capturePage()).toPNG())
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('dsh-desktop-update-root')?.style.display`), 'none')
  window.webContents.send('updates:status-changed', { phase: 'idle', currentVersion: '0.0.0', manual: false, locale: 'en' })
  console.log('Update UI: real preload/IPCs, automatic corner offer, manual dialog and Escape dismissal passed')
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
  assert.equal(position.left, 0, 'Safe Mode covers the entire app, including the sidebar')
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
  ipcMain.handle(DESKTOP_IPC.safeModeAction, (_event, action: string) => { actions.push(action); return { ok: true } })
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
