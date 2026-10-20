import { build } from 'esbuild'
import path from 'node:path'
import { expect, it } from 'vitest'

it('bundles the actual native recovery and client smoke gates after host migrations', async () => {
  for (const entry of [
    'scripts/recovery-ui-smoke.ts',
    'scripts/fixtures/desktop-profile.ts',
    'scripts/fixtures/desktop-profile-preload.ts'
  ]) {
    const result = await build({
      absWorkingDir: path.resolve(import.meta.dirname, '..'),
      entryPoints: [entry], bundle: true, write: false,
      platform: 'node', format: 'cjs', loader: { '.svg': 'text' }, external: ['electron']
    })
    expect(result.outputFiles?.length, entry).toBe(1)
  }
})
