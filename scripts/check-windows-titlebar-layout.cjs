const { join } = require('node:path')
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  if (process.platform !== 'win32') process.exit(0)
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    stdio: 'inherit', timeout: 120_000, env: process.env
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} else {
  const { app, BrowserWindow } = require('electron')
  const { buildSync } = require('esbuild')
  const source = buildSync({
    entryPoints: ['src/preload/windows-titlebar.ts'], bundle: true,
    format: 'iife', globalName: 'TitlebarLayout', write: false
  }).outputFiles[0].text
  // Exercise the shipped Harness header CSS, not an approximation of its layout.
  const harness = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', 'utf8')
  const css = JSON.parse(harness.match(/const css\$4 = ("[^\n]+");/)[1])
  const output = join(process.cwd(), 'artifacts', 'windows-titlebar')
  mkdirSync(output, { recursive: true })
  app.setPath('userData', join(output, 'profile'))
  app.on('window-all-closed', () => {})
  let win
  async function main() {
    await app.whenReady()
    win = new BrowserWindow({ width: 1380, height: 800, show: true,
      titleBarStyle: 'hidden', titleBarOverlay: { height: 36, color: '#ffffff' },
      webPreferences: { sandbox: true, contextIsolation: true } })
    let count = 0
    for (const width of [900, 1380]) for (const zoom of [0.67, 1, 1.5]) for (const sidebar of [false, true]) {
      win.setSize(width, 800)
      await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>
        ${css} body{margin:0} #root{display:flex} .conversation{flex:1;min-width:0}
        .wSkVaW_titleCluster{flex:1;min-width:0} button{height:28px;min-width:28px}
        aside{width:240px;flex:none}
        </style><div id="root"><div class="conversation"><div data-slot="conversation.session.header">
        <header class="wSkVaW_header"><div class="wSkVaW_titleRow">
        <div class="wSkVaW_titleCluster">Session title</div>
        <div class="wSkVaW_headerUtilities"><button>Folder</button><button>More</button></div>
        <div class="wSkVaW_headerCorner" data-conversation-header-corner><button id="corner">Sidebar</button></div>
        </div><div role="tablist">Chat · Activity</div></header></div></div>
        ${sidebar ? '<aside data-sidebar-right-panel data-sidebar-right-open></aside>' : ''}</div>`))
      win.webContents.setZoomFactor(zoom)
      await win.webContents.executeJavaScript(`${source}
        TitlebarLayout.mountWindowsTitlebarLayout({document,ipcRenderer:{invoke:async()=>{}}});
        window.clicked=false;document.getElementById('corner').onclick=()=>window.clicked=true;void 0;`)
      await new Promise(resolve => setTimeout(resolve, 100))
      const rect = await win.webContents.executeJavaScript(`(() => {
        const b=document.getElementById('corner'),r=b.getBoundingClientRect();
        const h=document.querySelector('header').getBoundingClientRect();
        return {top:r.top,right:r.right,edge:h.right,x:r.x+r.width/2,y:r.y+r.height/2,
          hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()`)
      assert.ok(rect.top * zoom >= 36, JSON.stringify({ width, zoom, sidebar, rect }))
      assert.ok(rect.edge - rect.right >= 0 && rect.edge - rect.right <= 20)
      assert.equal(rect.hit, true)
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), button: 'left', clickCount: 1 })
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(await win.webContents.executeJavaScript('window.clicked'), true)
      if (width === 1380 && zoom === 1 && !sidebar) writeFileSync(join(output, 'layout.png'), (await win.webContents.capturePage()).toPNG())
      count++
    }
    console.log(`Windows titlebar layout: ${count} geometry and click scenarios passed`)
  }
  main().then(() => { win?.destroy(); app.quit() }).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
}
