import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPackagedWindows } from '../scripts/check-packaged-windows.mjs'

describe('packaged Windows native probe process contract', () => {
  const appRoot = resolve('fixture app/resources/app.asar')
  const executable = resolve('fixture app/Desktop.exe')

  it('waits for the native process and preserves space-containing arguments without a shell', () => {
    let observed
    checkPackagedWindows(appRoot, executable, (...args) => {
      observed = args
      return { status: 0 }
    })
    expect(observed[0]).toBe(executable)
    expect(observed[1][0]).toBe('-e')
    expect(observed[1][1]).toContain("requireHost('koffi')")
    expect(observed[1][1]).toContain('GetCurrentProcessId')
    expect(observed[1][2]).toBe(appRoot)
    expect(observed[2]).toMatchObject({ windowsHide: true, timeout: 30_000, encoding: 'utf8' })
    expect(observed[2].env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(observed[2].shell).toBeUndefined()
  })

  it('rejects an unknown or unsuccessful exit instead of accepting GUI launcher success', () => {
    for (const status of [null, undefined, 1]) {
      expect(() => checkPackagedWindows(appRoot, executable, () => ({ status, stderr: 'probe failed' })))
        .toThrow('Packaged native binding failed')
    }
  })

  it('preserves launch and timeout failures', () => {
    const failure = new Error('native launch timed out')
    try {
      checkPackagedWindows(appRoot, executable, () => ({ status: null, error: failure }))
      throw new Error('Expected launch failure')
    } catch (error) {
      expect(error.cause).toBe(failure)
    }
  })
})
