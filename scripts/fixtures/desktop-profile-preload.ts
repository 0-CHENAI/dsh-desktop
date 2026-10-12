import { ipcRenderer } from 'electron'
import { mountMacosWindowChrome } from '../../src/preload/macos-window-chrome'
import { markWindowsTitlebar, mountWindowsTitlebarLayout } from '../../src/preload/windows-titlebar'

// Reuse the shipped host layout adapters before the real Harness boot. This
// fixture does not expose fake business services or replace the native client.
if (process.platform === 'darwin') {
  mountMacosWindowChrome(document, listener => {
    const receive = (_event: unknown, fullscreen: boolean): void => listener(fullscreen)
    ipcRenderer.on('desktop-titlebar:fullscreen', receive)
    return () => ipcRenderer.removeListener('desktop-titlebar:fullscreen', receive)
  })
} else if (process.platform === 'win32') {
  markWindowsTitlebar(document)
  addEventListener('DOMContentLoaded', () => mountWindowsTitlebarLayout({ document, ipcRenderer }), { once: true })
}
