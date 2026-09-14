const { join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  if (process.platform !== 'darwin') process.exit(0)
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    stdio: 'inherit', timeout: 120_000, env: process.env
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} else {
  const { app, BrowserWindow } = require('electron')
  const { buildSync } = require('esbuild')
  const source = buildSync({
    entryPoints: ['src/preload/macos-titlebar.ts'], bundle: true,
    format: 'iife', globalName: 'TitlebarLayout', write: false
  }).outputFiles[0].text
  const output = join(process.cwd(), 'artifacts', 'macos-titlebar')
  mkdirSync(output, { recursive: true })
  app.setPath('userData', join(output, 'profile'))
  app.on('window-all-closed', () => {})
  let win
  async function main() {
    await app.whenReady()
    win = new BrowserWindow({
      width: 1380,
      height: 800,
      show: true,
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    let count = 0
    for (const width of [900, 1380]) for (const zoom of [0.67, 1, 1.5]) for (const wide of [false, true]) {
      win.setSize(width, 800)
      await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>
        body{margin:0} #root{display:flex;height:100vh}
        [data-dsh-sidebar-root]{flex:none;width:${wide ? 280 : 80}px}
        .conversation{flex:1;min-width:0}
        header{box-sizing:border-box;min-height:76px;padding:10px 28px 0 20px}
        .titleRow{display:flex;align-items:center;min-height:30px}
        .titleCluster{flex:1;min-width:0}
        button{height:28px;min-width:28px}
        #session{margin-top:48px;height:28px;cursor:pointer}
        </style><div id="root"><aside data-dsh-sidebar-root data-dsh-sidebar-wide="${wide}">
        <div id="session">Session</div></aside>
        <div class="conversation"><div data-slot="conversation.session.header">
        <header><div class="titleRow">
        <div class="titleCluster">Session title</div>
        <div><button>Folder</button><button>More</button></div>
        <div data-conversation-header-corner><button id="corner">Sidebar</button></div>
        </div></header></div></div></div>`))
      win.webContents.setZoomFactor(zoom)
      await win.webContents.executeJavaScript(`${source}
        TitlebarLayout.mountMacosTitlebarLayout(document);
        window.clicked=false;window.sessionClicked=false;
        document.getElementById('corner').onclick=()=>window.clicked=true;
        document.getElementById('session').onclick=()=>window.sessionClicked=true;void 0;`)
      await new Promise(resolve => setTimeout(resolve, 80))
      const rect = await win.webContents.executeJavaScript(`(() => {
        const button=document.getElementById('corner');
        const session=document.getElementById('session');
        const sidebar=document.querySelector('[data-dsh-sidebar-root]');
        const drag=document.getElementById('dsh-desktop-drag-region');
        const header=document.querySelector('header');
        const br=button.getBoundingClientRect();
        const sr=session.getBoundingClientRect();
        const dr=drag.getBoundingClientRect();
        const headerPad=parseFloat(getComputedStyle(header).paddingTop);
        return {
          buttonTop: br.top,
          buttonX: br.x + br.width / 2,
          buttonY: br.y + br.height / 2,
          sessionX: sr.x + sr.width / 2,
          sessionY: sr.y + sr.height / 2,
          sessionHit: document.elementFromPoint(sr.x + sr.width / 2, sr.y + sr.height / 2) === session,
          hit: document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2) === button,
          headerPad,
          dragLeft: dr.left,
          dragRight: dr.right,
          dragBottom: dr.bottom,
          dragHeight: dr.height,
          dragRegion: drag ? drag.style.webkitAppRegion : '',
          buttonRegion: getComputedStyle(button).webkitAppRegion,
          sidebarRegion: getComputedStyle(sidebar).webkitAppRegion
        };
      })()`)
      assert.equal(rect.headerPad, 28, JSON.stringify({ width, zoom, wide, rect }))
      assert.ok(rect.buttonTop >= 28, JSON.stringify({ width, zoom, wide, rect }))
      assert.ok(Math.abs(rect.dragHeight - 24) < 1, JSON.stringify(rect))
      assert.ok(rect.dragBottom <= rect.buttonTop + 0.5, JSON.stringify({ width, zoom, wide, rect }))
      assert.ok(Math.abs(rect.dragLeft - 80) < 1, JSON.stringify(rect))
      assert.ok(rect.dragRight - rect.dragLeft > 40, JSON.stringify(rect))
      assert.equal(rect.dragRegion, 'drag')
      assert.equal(rect.buttonRegion, 'no-drag')
      assert.notEqual(rect.sidebarRegion, 'drag')
      assert.equal(rect.hit, true)
      assert.equal(rect.sessionHit, true)
      for (const point of [
        { x: rect.buttonX, y: rect.buttonY },
        { x: rect.sessionX, y: rect.sessionY }
      ]) {
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          x: Math.round(point.x * zoom),
          y: Math.round(point.y * zoom),
          button: 'left',
          clickCount: 1
        })
        win.webContents.sendInputEvent({
          type: 'mouseUp',
          x: Math.round(point.x * zoom),
          y: Math.round(point.y * zoom),
          button: 'left',
          clickCount: 1
        })
      }
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(await win.webContents.executeJavaScript('window.clicked'), true)
      assert.equal(await win.webContents.executeJavaScript('window.sessionClicked'), true)
      if (width === 1380 && zoom === 1 && wide) {
        writeFileSync(join(output, 'layout.png'), (await win.webContents.capturePage()).toPNG())
      }
      count++
    }
    console.log(`macOS titlebar layout: ${count} geometry and click scenarios passed`)
  }
  main().then(() => { win?.destroy(); app.quit() }).catch(error => {
    console.error(error)
    win?.destroy()
    app.exit(1)
  })
}
