import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'

const root = process.env.DSH_SPLASH_FIXTURE_ROOT
const buildDirectory = process.env.DSH_SPLASH_BUILD
if (!root || !buildDirectory) throw new Error('Missing splash fixture paths')
app.setPath('userData', join(root, 'profile'))
app.on('window-all-closed', () => {})

void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1280, height: 760, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
  try {
    const coverScript = await readFile(join(root, 'cover.js'), 'utf8')
    for (const theme of ['light', 'dark'] as const) {
      nativeTheme.themeSource = theme
      for (const width of [360, 1280, 1920]) {
        window.setContentSize(width, 760)
        await window.loadFile(join(buildDirectory, 'splash.html'))
        const splash = await window.webContents.executeJavaScript(`(async () => {
          const image = document.querySelector('.mark');
          await image.decode();
          const rect = image.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
            width: rect.width, viewportWidth: innerWidth, viewportHeight: innerHeight, source: image.currentSrc };
        })()`)
        assert.ok(Math.abs(splash.x - splash.viewportWidth / 2) < 1, JSON.stringify({ theme, width, splash }))
        assert.ok(Math.abs(splash.y - splash.viewportHeight / 2) < 1, JSON.stringify({ theme, width, splash }))
        assert.ok(splash.width <= Math.min(420, splash.viewportWidth - 64) + 1)
        assert.ok(splash.source.endsWith(theme === 'dark' ? 'dsh-loader-dark.gif' : 'dsh-loader.gif'))

        await window.loadURL('data:text/html,<html><body></body></html>')
        await window.webContents.executeJavaScript(coverScript)
        const cover = await window.webContents.executeJavaScript(`(() => {
          const root = document.getElementById('dsh-desktop-boot-cover');
          root.setAttribute('data-stalled', '');
          const image = root.shadowRoot.querySelector('.mark').getBoundingClientRect();
          const copy = root.shadowRoot.querySelector('.startupCopy').getBoundingClientRect();
          return { x: image.x + image.width / 2, y: image.y + image.height / 2,
            width: image.width, bottom: image.bottom, copyTop: copy.top,
            viewportWidth: innerWidth, viewportHeight: innerHeight };
        })()`)
        assert.ok(Math.abs(cover.x - cover.viewportWidth / 2) < 1, JSON.stringify({ theme, width, cover }))
        assert.ok(Math.abs(cover.y - cover.viewportHeight / 2) < 1, JSON.stringify({ theme, width, cover }))
        assert.ok(Math.abs(cover.width - splash.width) < 1, JSON.stringify({ theme, width, cover, splash }))
        assert.ok(cover.copyTop > cover.bottom, JSON.stringify({ theme, width, cover }))
      }
    }
    console.log('PASS centered splash and boot cover: two themes, three window widths')
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    window.destroy()
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
