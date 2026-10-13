/** A GUI executable must be waited on explicitly, not via PowerShell's stale LASTEXITCODE. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const nativeProbe = `
const requireHost = require('node:module').createRequire(require('node:path').join(process.argv[1], 'package.json'));
const koffi = requireHost('koffi');
const pid = koffi.load('kernel32.dll').func('GetCurrentProcessId', 'uint32', []);
if (pid() !== process.pid) throw new Error('Packaged koffi failed');
`

export function checkPackagedWindows(appRoot, executable, spawnProcess = spawnSync) {
  const result = spawnProcess(resolve(executable), ['-e', nativeProbe, resolve(appRoot)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8', windowsHide: true, timeout: 30_000
  })
  if (result.error) throw new Error('Packaged native probe could not complete', { cause: result.error })
  if (result.status !== 0) {
    // This probe reads only the package and kernel32; never a Profile or token.
    throw new Error(`Packaged native binding failed (exit ${result.status}): ${result.stderr || 'no stderr'}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32') throw new Error('This native probe requires Windows')
  const [appRoot, executable] = process.argv.slice(2)
  if (!appRoot || !executable) throw new Error('Usage: check-packaged-windows.mjs <app.asar> <app.exe>')
  checkPackagedWindows(appRoot, executable)
  console.log('Packaged Windows native binding: real kernel32 PID verified in Electron Node mode')
}
