import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DesktopService } from '../../src/main/desktop-service/service'
import { attachDiagnostics } from '../../src/main/desktop-service/diagnostics'

// This process owns an isolated profile and one hidden window. Never send
// shutdown messages to any other window, or invoke Windows shutdown/logoff.
const [stateDir, mode] = process.argv.slice(2)
if (!stateDir || !mode) throw new Error('Missing test arguments')
app.setPath('userData', stateDir)
app.disableHardwareAcceleration()
const observation = { beforeQuit: false, willQuit: false, sessionEnd: false, marker: true, reports: [] as string[], requests: 0, error: '' }
const marker = join(stateDir, 'session.json')
const record = () => {
  observation.marker = existsSync(marker)
  writeFileSync(join(stateDir, 'observed.json'), JSON.stringify(observation))
}
process.on('uncaughtException', error => {
  observation.error = error.message
  record()
  app.exit(1)
})
const service = new DesktopService({
  stateDir, logPath: join(stateDir, 'missing.log'), version: '0.2.15', platform: 'win32', arch: 'x64',
  request: async () => { observation.requests++; throw new Error('No network allowed') },
  confirmUpload: async body => { observation.reports.push(JSON.parse(body).kind); return false }
})

async function send(window: BrowserWindow, message: number): Promise<void> {
  const handle = window.getNativeWindowHandle().readBigUInt64LE()
  const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DshTestMessage { [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr Send(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam); }'; [DshTestMessage]::Send([IntPtr]::new(${handle}), ${message}, [UIntPtr]::new(${message === 0x16 ? 1 : 0}), [IntPtr]::Zero) | Out-Null`
  await new Promise<void>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 8_000 }, error => error ? reject(error) : resolve())
  })
}

void app.whenReady().then(async () => {
  if (mode === 'check') {
    service.beginSession()
    await service.flush()
    service.markCleanExit()
    record()
    app.exit(0)
    return
  }
  attachDiagnostics(app, service)
  app.on('before-quit', () => { observation.beforeQuit = true })
  app.on('will-quit', () => { observation.willQuit = true; record() })
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  window.once('session-end', () => {
    observation.sessionEnd = true
    record()
  })
  if (mode === 'clean-quit') {
    app.quit()
  } else if (mode === 'tray-close') {
    window.once('close', event => {
      event.preventDefault()
      window.hide()
      record()
      app.exit(0)
    })
    window.close()
  } else if (mode === 'query-only') {
    window.once('query-session-end', event => event.preventDefault())
    await send(window, 0x11) // WM_QUERYENDSESSION: cancelled, not committed.
    record()
    app.exit(0)
  } else if (mode === 'system-end' || mode === 'system-end-with-crash') {
    if (mode === 'system-end-with-crash') service.captureFatal(new Error('Test crash'))
    await send(window, 0x16) // WM_ENDSESSION for this test window only.
    if (!observation.sessionEnd) throw new Error('Windows did not deliver session-end')
    // Exit outside the native callback, without the app quit events.
    app.exit(0)
  } else if (mode === 'crash') {
    service.captureFatal(new Error('Test crash'))
    record()
    app.exit(0)
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }
}).catch(error => {
  observation.error = error.message
  record()
  app.exit(1)
})
