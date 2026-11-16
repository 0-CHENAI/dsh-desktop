import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { validModelEndpoint } from './startup-config-recovery'

export const SAFE_MODE_PROFILE = 'desktop-safe-mode'
export const SAFE_MODE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app'
] as const

export const SAFE_MODE_PATCH = `# Managed by DSH Desktop Safe Mode.
# Third-party bundles and the normal web profile's patch layer are intentionally omitted.
- id: agent-default-model
  disabled: false
  config:
    provider: deepseek-official
    model: deepseek-flash
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
    // Resolve aliases before dropping their owner rows. Bound expansion and
    // copy data only: normal profiles cannot replace Safe Mode's core code.
    rows = doc.toJS({ maxAliasCount: 100 })
  } catch {
    return SAFE_MODE_PATCH
  }
  if (!Array.isArray(rows)) return SAFE_MODE_PATCH
  const kept: { id: string; disabled: false; config?: unknown }[] = []
  for (const item of rows as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const id = row.id
    if (typeof id !== 'string' || !SAFE_MODE_MODEL_ENTRY_IDS.has(id) ||
      (row.name !== undefined && row.name !== MODEL_PACKAGES[id]) ||
      !Object.keys(row).every(key => ['id', 'name', 'config', 'disabled'].includes(key))) continue
    const config = row.config
    if (id === 'llm-deepseek' && config && typeof config === 'object' && !Array.isArray(config)) {
      const safeConfig = { ...config } as Record<string, unknown>
      if (Object.hasOwn(safeConfig, 'baseURL') && !validModelEndpoint(safeConfig.baseURL, true)) delete safeConfig.baseURL
      kept.push({ id, disabled: false, config: safeConfig })
    } else {
      kept.push({ id, disabled: false, ...(Object.hasOwn(row, 'config') ? { config } : {}) })
    }
  }
  if (!kept.some(row => row.id === 'agent-default-model')) kept.push({
    id: 'agent-default-model', disabled: false,
    config: { provider: 'deepseek-official', model: 'deepseek-flash' }
  })
  const header = '# Managed by DSH Desktop Safe Mode.\n# Model configurations inherited from the normal profile; third-party implementations omitted.\n'
  return header + stringify(kept)
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
