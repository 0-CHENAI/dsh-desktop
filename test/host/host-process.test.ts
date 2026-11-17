import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { electronNodeExecutable } from '../../src/main/shell/backend/electron-node-executable'
import { DesktopHostFatalError, DesktopHostProcess, redactHostOutput } from '../../src/main/shell/backend/host-process'

const require = createRequire(import.meta.url)
const electron = require('electron') as string
const fixture = join(import.meta.dirname, 'fixtures', 'host-child.mjs')
const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop host process', () => {
  it('sets DSH_HOME and returns the ready URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shell-host-'))
    temporary.push(directory)
    const report = join(directory, 'report.json')
    const host = new DesktopHostProcess({
      node: electron,
      entry: fixture,
      runtimeDir: directory,
      projectDir: directory,
      dshHome: join(directory, 'harness'),
      profile: 'desktop',
      environment: { FIXTURE_REPORT: report }
    })
    try {
      const started = host.start()
      expect(host.start()).toBe(started)
      await expect(started).resolves.toEqual({ url: 'http://127.0.0.1:9/', injections: ['boot'] })
      const observed: unknown = JSON.parse(await readFile(report, 'utf8'))
      if (!observed || typeof observed !== 'object' || !('cwd' in observed) || typeof observed.cwd !== 'string') {
        throw new Error('Host report did not contain a cwd string')
      }
      // Normalize both sides: Windows can keep an 8.3 cwd, while macOS
      // expands /var to /private/var in the child process.
      expect({ ...observed, cwd: await realpath(observed.cwd) }).toEqual({
        home: join(directory, 'harness'),
        profile: 'desktop',
        execPath: electron,
        cwd: await realpath(join(directory, 'harness', 'launch-root'))
      })
    } finally {
      await host.stop()
    }
  })

  it('keeps the macOS Helper as its own executable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shell-host-'))
    temporary.push(directory)
    const report = join(directory, 'report.json')
    const node = electronNodeExecutable(electron)
    const host = new DesktopHostProcess({
      node,
      entry: fixture,
      runtimeDir: directory,
      projectDir: directory,
      dshHome: directory,
      environment: { FIXTURE_REPORT: report }
    })
    await host.start()
    expect(JSON.parse(await readFile(report, 'utf8')).execPath).toBe(node)
    await host.stop()
  })

  it('rejects a fatal host message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shell-host-'))
    temporary.push(directory)
    const host = new DesktopHostProcess({
      node: electron,
      entry: fixture,
      runtimeDir: directory,
      projectDir: directory,
      dshHome: directory,
      environment: { FIXTURE_MODE: 'fatal' }
    })
    await expect(host.start()).rejects.toBeInstanceOf(DesktopHostFatalError)
    await host.stop()
  })
})

describe('shell boundaries', () => {
  it('removes the credential from host output', () => {
    expect(redactHostOutput('dsh web: http://127.0.0.1:9/?token=secret&x=1')).toBe('dsh web: http://127.0.0.1:9/?token=[redacted]&x=1')
  })

  it('keeps Electron out of the host entry', async () => {
    const source = await readFile(join(import.meta.dirname, '../../src/host/index.ts'), 'utf8')
    expect(source.includes("from 'electron'")).toBe(false)
  })

  it('uses the product updater without the old entry or the official fatal dialog', async () => {
    const source = await readFile(join(import.meta.dirname, '../../src/main/shell/app.ts'), 'utf8')
    expect(source.includes('../update/update-manager')).toBe(true)
    expect(source.includes('mandatory-update')).toBe(false)
    expect(source.includes('../index')).toBe(false)
    expect(source.includes('DesktopFatalRecovery')).toBe(false)
    expect(source.includes('../recovery/fatal-entry')).toBe(true)
    expect(source.includes('node: electronNodeExecutable(process.execPath)')).toBe(true)
  })
})
