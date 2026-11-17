import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('centers both startup surfaces in the real Electron renderer', async () => {
  const electron: unknown = createRequire(import.meta.url)('electron')
  if (typeof electron !== 'string') throw new Error('Electron executable is required')
  const root = await mkdtemp(join(tmpdir(), 'dsh-splash-layout-'))
  try {
    await build({ entryPoints: [resolve('test/shell/splash-layout-electron-fixture.ts')],
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      outfile: join(root, 'fixture.cjs'), logLevel: 'silent' })
    await build({ stdin: { contents: `
      import { mountBootCover } from './src/preload/boot-cover'
      mountBootCover('http://127.0.0.1:43129/', { document, locale: 'en' })
    `, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'browser',
    format: 'iife', outfile: join(root, 'cover.js'), logLevel: 'silent' })
    const env: NodeJS.ProcessEnv = { ...process.env, DSH_SPLASH_FIXTURE_ROOT: root, DSH_SPLASH_BUILD: resolve('build') }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(electron, [join(root, 'fixture.cjs')], {
      env, encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000
    })
    const evidence = `${result.stdout}\n${result.stderr}`
    expect(result.error, evidence).toBeUndefined()
    expect(result.status, evidence).toBe(0)
    expect(result.stdout).toContain('PASS centered splash and boot cover')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 40_000)
