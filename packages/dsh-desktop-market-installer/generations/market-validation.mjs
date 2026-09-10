import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveEnabledGenerations } from './registry.mjs'

// A read-only view of the next composition. Never retarget a running plugin's
// junction just to let the market inspect the newly installed bytes.
export async function createMarketValidationProfile(home) {
  const profile = join(home, 'profiles', 'web')
  const directory = await mkdtemp(join(home, 'profiles', '.market-validation-'))
  try {
    const modules = join(directory, 'node_modules')
    await mkdir(modules)
    const targets = new Map()
    for (const entry of await readdir(join(profile, 'node_modules'), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.name.startsWith('@')) {
        for (const child of await readdir(join(profile, 'node_modules', entry.name))) {
          targets.set(`${entry.name}/${child}`, join(profile, 'node_modules', entry.name, child))
        }
      } else {
        targets.set(entry.name, join(profile, 'node_modules', entry.name))
      }
    }
    const enabled = await resolveEnabledGenerations(home)
    for (const [name, generation] of enabled) {
      targets.set(name, join(generation.directory, 'node_modules', name))
    }
    for (const [name, target] of targets) {
      if (name.startsWith('@')) await mkdir(join(modules, name.split('/')[0]), { recursive: true })
      await symlink(target, join(modules, name), process.platform === 'win32' ? 'junction' : 'dir')
    }
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    manifest.dsh ??= {}
    manifest.dsh.profile ??= {}
    manifest.dsh.profile.bundles = [...new Set([
      ...(manifest.dsh.profile.bundles ?? []), ...enabled.keys()
    ])]
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
    await cp(join(profile, 'cordis.patch.yml'), join(directory, 'cordis.patch.yml')).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
