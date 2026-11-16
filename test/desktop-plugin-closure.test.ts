import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { projectRoot } from './patch-path'
import { buildDesktopProductPatch } from '../src/main/shell/product-patch'

const profileConfigTags = [
  {
    tag: 'tag:yaml.org,2002:js',
    resolve: (value: string) => value
  }
]

async function readProfilePatch(): Promise<{ name?: string; insert?: { name?: string }[] }[]> {
  return parseYaml(
    buildDesktopProductPatch(),
    { customTags: profileConfigTags }
  ) as { name?: string; insert?: { name?: string }[] }[]
}

/**
 * Every desktop plugin the composed profile mounts has to be reachable from
 * the profile directory, and the profile does not resolve through the app's
 * own node_modules.
 *
 * Harness mirrors the dependency closure of `@deepseek-ai/dsh` into
 * `$DSH_HOME/profiles/node_modules`, anchored at that package's manifest — not
 * at ours. A desktop plugin therefore reaches the profile only by being
 * injected into that manifest's dependencies, which is what the `dsh` patch
 * does. Adding a row to the profile patch without that injection boots to
 * `Cannot find package ... imported from .../profiles/web/`, which fails the
 * whole plugin tree rather than just that row.
 */
describe('desktop plugin closure', () => {
  it('injects every profile-mounted package into the dsh dependency closure', async () => {
    const profilePatch = await readProfilePatch()

    const mounted = profilePatch
      .flatMap((row) => row.insert ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === 'string')

    expect(mounted.length).toBeGreaterThan(0)

    const closure = new Map<string, string>()
    const pending = ['@deepseek-ai/dsh']
    while (pending.length > 0) {
      const name = pending.pop()!
      if (closure.has(name)) continue
      const manifest = JSON.parse(await readFile(path.join(projectRoot, 'node_modules', name, 'package.json'), 'utf8'))
      closure.set(name, manifest.version)
      pending.push(...Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).filter(dependency =>
        (dependency.startsWith('@deepseek-ai/') || mounted.includes(dependency)) &&
        (dependency in (manifest.dependencies ?? {}) || existsSync(path.join(projectRoot, 'node_modules', dependency, 'package.json')))))
    }
    for (const name of mounted) {
      expect(closure.has(name), name).toBe(true)
    }
  })

  it('declares every profile-mounted package as a local production dependency', async () => {
    const profilePatch = await readProfilePatch()

    const manifest = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }

    for (const row of profilePatch.flatMap((entry) => entry.insert ?? [])) {
      if (typeof row.name !== 'string') continue
      expect(manifest.dependencies[row.name]).toMatch(/^file:packages\//u)
    }
  })
})
