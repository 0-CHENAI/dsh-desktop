import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DesktopHostProcess } from '../../src/main/shell/backend/host-process'
import { ensureSafeModeProfile, SAFE_MODE_PROFILE } from '../../src/main/recovery/safe-mode-profile'
import { writeDesktopProductPatch } from '../../src/main/shell/product-patch'
import { ensureHostBundle, hostBundle } from '../host/host-bundle-helper'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const electron = require('electron') as string

/** Real installed Harness and Host bundle; all state is owned by this fixture. */
export async function temporaryDesktopHost(safeMode = false, environment: NodeJS.ProcessEnv = {}) {
  await ensureHostBundle()
  const home = await mkdtemp(join(tmpdir(), 'dsh-v014-host-'))
  try {
    const profile = safeMode ? await ensureSafeModeProfile(home, 'desktop') : join(home, 'profiles', 'desktop')
    if (!safeMode) {
      await mkdir(profile, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', private: true,
        dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
      await writeFile(join(profile, 'cordis.yml'), '[]\n')
      await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
    }
    const host = new DesktopHostProcess({ node: electron, entry: hostBundle, runtimeDir: root,
      projectDir: profile, dshHome: home, launchRoot: join(home, 'launch-root'),
      profile: safeMode ? SAFE_MODE_PROFILE : 'desktop',
      environment: { ...environment, DSH_DESKTOP_PATCH_FILE: await writeDesktopProductPatch(home, safeMode ? 'safe' : undefined, { skipBlockingHmr: process.platform === 'win32' }) },
      primaryRuntime: join(root, '.build/office-runtime/primary-runtime') })
    return { home, profile, host, async close() {
      try { await host.stop() } finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    } }
  } catch (error) {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    throw error
  }
}
