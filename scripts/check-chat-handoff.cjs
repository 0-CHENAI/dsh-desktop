const { join } = require('node:path')
const { mkdirSync, readFileSync, writeFileSync, readdirSync } = require('node:fs')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    stdio: 'inherit', timeout: 120000, env: process.env
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} else {
  const { app, BrowserWindow } = require('electron')
  const { buildSync } = require('esbuild')
  process.on('uncaughtException', error => { console.error(error); app.exit(1) })
  const output = join(process.cwd(), 'artifacts', 'chat-handoff')
  mkdirSync(output, { recursive: true })
  app.setPath('userData', join(output, 'profile'))
  const assets = join(process.cwd(), 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  const index = readdirSync(assets).find(name => /^index-.*\.js$/.test(name))
  const frontend = readFileSync(join(assets, index), 'utf8')
  const registry = frontend.match(/function ([\w$]+)\(\)\{return\{react:/)
  const boot = [...frontend.matchAll(/const [\w$]+=document\.getElementById\("root"\)/g)].at(-1)
  assert.ok(registry && boot, 'Pinned frontend vendor registry/boot boundary changed')
  // Reuse shipped React/Markdown/store, but NEVER execute the application boot/network code.
  const vendor = buildSync({ stdin: { contents: frontend.slice(0, boot.index) + `;window.__dshVendors=${registry[1]}();`,
    resolveDir: assets }, bundle: true, format: 'iife', write: false,
    define: { 'import.meta.url': JSON.stringify(require('node:url').pathToFileURL(join(assets, index)).href) } }).outputFiles[0].text
  const bundle = buildSync({ entryPoints: ['scripts/fixtures/chat-handoff-browser.tsx'], bundle: true,
    format: 'iife', write: false, outfile: join(output, 'fixture.js'), loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' } })
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
  const css = readdirSync(assets).filter(name => name.endsWith('.css')).map(name => readFileSync(join(assets, name), 'utf8')).join('\n')
  const chat = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', 'utf8').replace('exports.EMPTY_CHAT_SNAPSHOT =',
    'exports.__test = {ChatSnapshotBuilder, assistantDefinition, initialState, updateChunk, settleMessage, projectAssistant, ChatNodeSeat, AssistantNodeView, TurnProcessNodeView, zh}; exports.EMPTY_CHAT_SNAPSHOT =')
  let win
  app.on('window-all-closed', () => {})
  async function main() {
    await app.whenReady()
    win = new BrowserWindow({ width: 1000, height: 760, show: false, webPreferences: { sandbox: true, offscreen: true } })
    const pageErrors = []
    win.webContents.on('console-message', details => { if (details.level === 'error') pageErrors.push(details.message) })
    let cases = 0
    for (const zoom of [0.8, 1, 1.5]) for (const mode of ['compact', 'normal']) for (const expanded of [false, true]) {
      const html = join(output, 'fixture.html')
      writeFileSync(html, `<!doctype html><meta charset="utf-8"><base href="${require('node:url').pathToFileURL(assets + require('node:path').sep).href}"><style>${css}body{margin:20px;background:white;color:#222;font:14px sans-serif;overflow:auto}#root{max-width:850px;height:auto}[role=status]{color:#735000;padding:8px 0}[hidden]{display:none!important}</style><div id="root"></div>`)
      await win.loadFile(html)
      win.webContents.setZoomFactor(zoom)
      await win.webContents.executeJavaScript('addEventListener("unhandledrejection", e => console.error(e.reason?.stack ?? String(e.reason)))')
      await win.webContents.executeJavaScript('Object.defineProperty(navigator, "clipboard", {value:{writeText:async text=>{window.copiedText=text}}})')
      await win.webContents.executeJavaScript(vendor)
      await win.webContents.executeJavaScript(js)
      await win.webContents.executeJavaScript(chat)
      await win.webContents.executeJavaScript(`runHandoff(${JSON.stringify(mode)},${expanded})`)
      let readingScroll = 0
      let readingTop = 0
      for (let stage = 0; stage <= 5; stage++) {
        const result = await win.webContents.executeJavaScript(`handoffStage(${stage})`)
        assert.ok(result.text.trim().length > 0, `empty body at ${stage}`)
        if (stage === 0) {
          readingScroll = await win.webContents.executeJavaScript('scrollTo(0,80);scrollY')
          readingTop = await win.webContents.executeJavaScript('document.querySelector("[data-answer-body]").getBoundingClientRect().top')
        }
        if (stage === 1 || stage === 2) {
          assert.ok(result.text.includes('原正文'))
          assert.ok(result.status.length > 0)
          if (readingScroll === 80) assert.ok(Math.abs(await win.webContents.executeJavaScript('document.querySelector("[data-answer-body]").getBoundingClientRect().top') - readingTop) < 2, 'reading anchor jumped')
        }
        if (stage === 1) {
          await win.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>/copy|复制/i.test(b.textContent)).click()')
          assert.equal(await win.webContents.executeJavaScript('window.copiedText'), 'const answer = 42')
        }
        if (stage === 3) assert.ok(result.text.includes('重试后的新正文'))
        if (stage >= 4) assert.ok(result.text.includes('最终正文'))
        if (stage === 5) {
          assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("[data-answer-phase=final]").length'), 1)
          assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("img[alt=测试附件]").length'), 1)
        }
        if (zoom === 1 && !expanded) writeFileSync(join(output, `${mode}-${stage}.png`), (await win.webContents.capturePage()).toPNG())
      }
      if (mode === 'compact' && !expanded) {
        await win.webContents.executeJavaScript('document.querySelector("[data-turn-process]").click()')
        await new Promise(resolve => setTimeout(resolve, 30))
        // The global process disclosure restores the draft; local disclosure can then toggle it.
        await win.webContents.executeJavaScript('document.querySelector("[data-answer-replaced] > button").click()')
        await new Promise(resolve => setTimeout(resolve, 30))
        assert.equal(await win.webContents.executeJavaScript('document.querySelector("[data-answer-replaced] [data-answer-body]").hidden'), true)
      }
      const result = await win.webContents.executeJavaScript('finishHandoff()')
      assert.ok(result.frames.length > 0)
      assert.ok(result.frames.every(frame => frame.trim().length > 0), 'empty intermediate animation frame')
      cases++
    }
    assert.deepEqual(pageErrors, [])
    console.log(`Chat handoff: ${cases} React scenarios / 72 stages passed; screenshots: ${output}`)
  }
  main().then(() => { win?.destroy(); app.quit() }).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
}
