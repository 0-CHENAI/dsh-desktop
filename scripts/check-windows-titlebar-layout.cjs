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
  const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron')
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
  let menuView
  let menuOpen = false
  const boundsSource = buildSync({entryPoints:['src/main/windows-menu-view.ts'],bundle:true,format:'iife',globalName:'MenuBounds',write:false}).outputFiles[0].text
  const { windowsMenuViewBounds } = new Function(`${boundsSource};return MenuBounds`)()
  function syncMenu() {
    const [width,height]=win.getContentSize()
    menuView.setBounds(windowsMenuViewBounds({width,height},menuOpen,win.isFullScreen()))
    menuView.setVisible(!win.isFullScreen())
  }
  async function setFullscreen(value) {
    if (win.isFullScreen() === value) return
    const changed = new Promise(resolve => win.once(value ? 'enter-full-screen' : 'leave-full-screen', resolve))
    win.setFullScreen(value)
    await changed
    syncMenu()
    win.focus()
    win.webContents.focus()
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  async function main() {
    await app.whenReady()
    win = new BrowserWindow({ width: 1380, height: 800, show: true,
      titleBarStyle: 'hidden', titleBarOverlay: { height: 36, color: '#ffffff' },
      webPreferences: { sandbox: true, contextIsolation: true } })
    menuView=new WebContentsView({webPreferences:{sandbox:true,preload:join(process.cwd(),'out/preload/windows-menu.cjs')}})
    win.contentView.addChildView(menuView)
    ipcMain.handle('desktop-titlebar:set-menu-open',(_event,open)=>{menuOpen=open;syncMenu()})
    ipcMain.handle('desktop-menu:get-zoom-factor',()=>1)
    syncMenu()
    await menuView.webContents.loadFile(join(process.cwd(),'build/windows-menu.html'))
    assert.equal(await menuView.webContents.executeJavaScript("getComputedStyle(document.querySelector('.bar')).getPropertyValue('-webkit-app-region')"),'drag')
    await menuView.webContents.executeJavaScript("document.getElementById('application-menu-button').click();void 0")
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(menuView.getBounds().width,304)
    menuView.webContents.send('desktop-titlebar:close-menu')
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(menuView.getBounds().x,0)
    assert.equal(menuView.getBounds().height,36)
    let count = 0
    for (const width of [900, 1380]) for (const zoom of [0.67, 1, 1.5]) for (const sidebar of [false, true]) for (const fullscreen of [false, true]) {
      win.setSize(width, 800)
      await setFullscreen(fullscreen)
      syncMenu()
      await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>
        ${css} body{margin:0} #root{display:flex} .conversation{flex:1;min-width:0}
        .wSkVaW_titleCluster{flex:1;min-width:0} button{height:28px;min-width:28px}
        aside{width:180px;flex:none} #backdrop{position:fixed;inset:0;background:#0003;display:none}
        #settings{position:absolute;inset:10px;background:white} #close{position:absolute;right:0;top:0}
        </style><div id="root"><aside id="left-sidebar">Sidebar</aside><div class="conversation"><div data-slot="conversation.session.header">
        <header class="wSkVaW_header"><div class="wSkVaW_titleRow">
        <div class="wSkVaW_titleCluster">Session title</div>
        <div class="wSkVaW_headerUtilities"><button>Folder</button><button>More</button></div>
        <div class="wSkVaW_headerCorner" data-conversation-header-corner><button id="corner">Sidebar</button></div>
        </div><div role="tablist">Chat · Activity</div></header></div></div>
        ${sidebar ? '<aside data-sidebar-right-panel data-sidebar-right-open></aside>' : ''}</div>
        <div id="backdrop"><section id="settings"><button id="close">Close</button></section></div>`))
      win.webContents.setZoomFactor(zoom)
      await win.webContents.executeJavaScript(`${source}
        window.fullscreenListener=()=>{};
        TitlebarLayout.mountWindowsTitlebarLayout({document,ipcRenderer:{invoke:async()=>${fullscreen},on:(_name,fn)=>window.fullscreenListener=fn}});
        window.inputLog=[];for(const t of ['mousemove','mousedown','mouseup','click'])document.addEventListener(t,e=>window.inputLog.push([t,e.clientX,e.clientY,e.target.id]));
        window.clicked=false;document.getElementById('corner').onclick=()=>window.clicked=true;void 0;`)
      win.focus()
      win.webContents.focus()
      await new Promise(resolve => setTimeout(resolve, 250))
      const rect = await win.webContents.executeJavaScript(`(() => {
        const b=document.getElementById('corner'),r=b.getBoundingClientRect();
        const h=document.querySelector('header').getBoundingClientRect();
        return {top:r.top,right:r.right,edge:h.right,x:r.x+r.width/2,y:r.y+r.height/2,
          hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()`)
      assert.ok(rect.top * zoom >= (fullscreen ? 0 : 36), JSON.stringify({ width, zoom, sidebar, rect }))
      const content = await win.webContents.executeJavaScript(`(() => {
        const root=document.getElementById('root').getBoundingClientRect();
        const sidebar=document.getElementById('left-sidebar').getBoundingClientRect();
        return {top:root.top,leftTop:sidebar.top,bottom:root.bottom,viewport:innerHeight};})()`)
      assert.ok(Math.abs(content.top * zoom - (fullscreen ? 0 : 36)) < 2)
      assert.equal(content.leftTop, content.top)
      assert.ok(Math.abs(content.bottom - content.viewport) < 2)
      assert.ok(rect.edge - rect.right >= 0 && rect.edge - rect.right <= 20)
      assert.equal(rect.hit, true, JSON.stringify({width,zoom,sidebar,fullscreen,rect,content}))
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom) })
      await new Promise(resolve => setTimeout(resolve, 100))
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), button: 'left', clickCount: 1 })
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(await win.webContents.executeJavaScript('window.clicked'), true, JSON.stringify({width,zoom,sidebar,fullscreen,rect,menuBounds:menuView.getBounds(),focused:win.webContents.isFocused(),log:await win.webContents.executeJavaScript('window.inputLog')}))
      const modal = await win.webContents.executeJavaScript(`(() => {
        const backdrop=document.getElementById('backdrop');backdrop.style.display='block';
        const close=document.getElementById('close');close.onclick=()=>backdrop.style.display='none';
        const b=backdrop.getBoundingClientRect(),r=close.getBoundingClientRect();
        return {top:b.top,bottom:b.bottom,x:r.x+r.width/2,y:r.y+r.height/2};})()`)
      assert.ok(Math.abs(modal.top - content.top) < 2)
      assert.ok(Math.abs(modal.bottom - content.viewport) < 2)
      for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({type,x:Math.round(modal.x*zoom),y:Math.round(modal.y*zoom),button:'left',clickCount:1})
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(await win.webContents.executeJavaScript("document.getElementById('backdrop').style.display"), 'none')
      await setFullscreen(!fullscreen)
      await win.webContents.executeJavaScript(`window.fullscreenListener(null,${!fullscreen});void 0;`)
      const toggledTop = await win.webContents.executeJavaScript("document.getElementById('root').getBoundingClientRect().top")
      assert.ok(Math.abs(toggledTop * zoom - (fullscreen ? 36 : 0)) < 2)
      await setFullscreen(fullscreen)
      await win.webContents.executeJavaScript(`window.fullscreenListener(null,${fullscreen});void 0;`)
      if (width === 1380 && zoom === 1 && !sidebar) writeFileSync(join(output, 'layout.png'), (await win.webContents.capturePage()).toPNG())
      count++
    }
    await setFullscreen(false)
    await win.webContents.executeJavaScript('window.fullscreenListener(null,false);void 0')
    const maximized = new Promise(resolve=>win.once('maximize',resolve))
    win.maximize()
    await maximized
    syncMenu()
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(menuView.getBounds().x,0)
    assert.equal(menuView.getBounds().width,win.getContentSize()[0]-140)
    const maximizedTop=await win.webContents.executeJavaScript("document.getElementById('root').getBoundingClientRect().top")
    assert.ok(Math.abs(maximizedTop*win.webContents.getZoomFactor()-36)<2)
    console.log(`Windows titlebar layout: ${count} geometry and click scenarios passed`)
  }
  main().then(() => { win?.destroy(); app.quit() }).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
}
