import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'

export const SAFE_MODE_PROFILE = 'desktop-safe-mode'
export const SAFE_MODE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app'
] as const

export const SAFE_MODE_PATCH = `# Managed by DSH Desktop Safe Mode.
# Third-party bundles and the normal web profile's patch layer are intentionally omitted.
[]
`

const SAFE_MODE_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

const MODEL_PACKAGES: Readonly<Record<string, string>> = {
  'llm-pi-ai': '@deepseek-ai/dsh-llm-pi-ai',
  'agent-default-model': '@deepseek-ai/dsh-agent-default-model',
  'llm-deepseek': '@deepseek-ai/dsh-llm-deepseek-api-key',
  'llm-deepseek-account': '@deepseek-ai/dsh-llm-deepseek-account',
  llm: '@deepseek-ai/dsh-llm',
  'llm-retry': '@deepseek-ai/dsh-llm-retry',
  'deepseek-llm-api-extensions': '@deepseek-ai/dsh-deepseek-llm-api-extensions'
}
export const SAFE_MODE_MODEL_ENTRY_IDS: ReadonlySet<string> = new Set(Object.keys(MODEL_PACKAGES))

export function extractSafeModePatch(sourcePatchText: string): string {
  let rows: unknown
  try {
    const doc = parseDocument(sourcePatchText)
    if (doc.errors.length) return SAFE_MODE_PATCH
    // Resolve aliases before selecting rows, including anchors owned by a row
    // that will be dropped. The bounded conversion rejects alias expansion bombs.
    rows = doc.toJS({ maxAliasCount: 100 })
  } catch {
    return SAFE_MODE_PATCH
  }
  if (!Array.isArray(rows)) return SAFE_MODE_PATCH

  const kept = []
  for (const item of rows as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const id = row.id
    // A model override may configure the bundled entry, never substitute its
    // implementation or insert third-party code into the recovery profile.
    if (typeof id === 'string' && SAFE_MODE_MODEL_ENTRY_IDS.has(id) &&
      (row.name === undefined || row.name === MODEL_PACKAGES[id]) &&
      Object.keys(row).every(key => ['id', 'name', 'config', 'disabled'].includes(key))) {
      kept.push(row)
    }
  }

  if (kept.length === 0) {
    return SAFE_MODE_PATCH
  }

  const header = `# Managed by DSH Desktop Safe Mode.\n# Third-party bundles and non-model web profile patches are intentionally omitted.\n# Model configurations inherited from the normal profile are included below.\n`
  return `${header}${stringify(kept)}`
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, 'utf8') === content) return
  } catch {
    // Missing or unreadable managed files are recreated below.
  }
  await writeFile(path, content, 'utf8')
}

/**
 * Materialize an isolated profile that resolves only installation-owned core
 * bundles. It shares DSH_HOME settings, credentials, sessions, and workspaces
 * with the normal profile. It inherits model configurations (e.g. custom endpoints
 * and providers) from the normal profile, but intentionally omits third-party bundles
 * and non-model user patches.
 */
export async function ensureSafeModeProfile(dshHome: string, sourceProfile = 'web'): Promise<string> {
  const directory = join(dshHome, 'profiles', SAFE_MODE_PROFILE)
  await mkdir(directory, { recursive: true })
  const manifest = `${JSON.stringify({
    name: 'dsh-profile-desktop-safe-mode',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...SAFE_MODE_BUNDLES] } }
  }, null, 2)}\n`

  let patchContent = SAFE_MODE_PATCH
  try {
    const sourcePatchText = await readFile(join(dshHome, 'profiles', sourceProfile, 'cordis.patch.yml'), 'utf8')
    patchContent = extractSafeModePatch(sourcePatchText)
  } catch {
    // If the source profile cordis.patch.yml is unreadable or does not exist, use default patch.
  }

  await Promise.all([
    writeIfChanged(join(directory, 'package.json'), manifest),
    writeIfChanged(join(directory, 'cordis.patch.yml'), patchContent),
    writeIfChanged(join(directory, 'pnpm-workspace.yaml'), SAFE_MODE_WORKSPACE)
  ])
  return directory
}
