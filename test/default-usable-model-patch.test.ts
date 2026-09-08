import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { patchPath, projectRoot } from './patch-path'

const sessionController = path.join(
  projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-api-session-controller',
  'lib',
  'index.js'
)

interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

interface CatalogHelpers {
  deriveProviderKeyRef: (provider: string) => string
  settingsPathValue: (root: unknown, path: readonly string[]) => unknown
  namedProviderKeyRef: (ctx: unknown, providerId: string) => string | undefined
  providerHasUsableCredential: (ctx: unknown, providerId: string) => Promise<boolean>
  pickUsableDefaultSelection: (
    ctx: unknown,
    wanted: ModelSelection,
    usableIds: string[]
  ) => Promise<ModelSelection | undefined>
  adoptUsableDefaultSelection: (ctx: unknown) => Promise<{
    selection: ModelSelection
    routableProviders: string[]
  }>
}

async function loadHelpers(): Promise<CatalogHelpers> {
  const client = await readFile(sessionController, 'utf8')
  const start = client.indexOf('function deriveProviderKeyRef(provider)')
  const end = client.indexOf('async function buildModelCatalog')

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return new Function(
    `${client.slice(start, end)}; return { deriveProviderKeyRef, settingsPathValue, namedProviderKeyRef, providerHasUsableCredential, pickUsableDefaultSelection, adoptUsableDefaultSelection };`
  )() as CatalogHelpers
}

function mockCtx(options: {
  wanted?: ModelSelection
  providers?: Array<{ id: string }>
  models?: Record<string, Array<{ id: string }>>
  configured?: Record<string, boolean>
  settings?: Record<string, unknown>
  declared?: Array<{ provider: string; settingsNs: string; settingsPath: string[] }>
  describeError?: boolean
  saveError?: boolean
}) {
  const wanted = options.wanted ?? {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash'
  }
  let saved = { ...wanted }
  const configured = options.configured ?? {}
  return {
    agentDefaultModel: {
      currentSelection: () => ({ ...saved }),
      saveSelection: async (next: ModelSelection) => {
        if (options.saveError === true) throw new Error('settings read-only')
        saved = { ...next }
      }
    },
    llm: {
      listProviders: () => options.providers ?? [],
      listConfigurableProviders: () => options.declared ?? [],
      listModels: async (providerId: string) => {
        const models = options.models?.[providerId]
        if (models === undefined) throw new Error(`no models for ${providerId}`)
        return models
      }
    },
    get: (name: string) => {
      if (name === 'credentials') {
        return {
          describe: async (ref: string) => {
            if (options.describeError === true) throw new Error('credentials unavailable')
            return { configured: configured[ref] === true }
          }
        }
      }
      if (name === 'settings' && options.settings !== undefined) {
        return {
          get: (ns: string) => options.settings?.[ns]
        }
      }
      return undefined
    },
    logger: { warn() {} }
  }
}

describe('usable default model selection', () => {
  it('derives conventional credential refs and walks settings paths', async () => {
    const helpers = await loadHelpers()

    expect(helpers.deriveProviderKeyRef('openai')).toBe('OPENAI_API_KEY')
    expect(helpers.deriveProviderKeyRef('deepseek-official')).toBe(
      'DEEPSEEK_OFFICIAL_API_KEY'
    )
    expect(
      helpers.settingsPathValue(
        { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
        ['providers', 'openai']
      )
    ).toEqual({ apiKeyEnv: 'OPENAI_API_KEY' })
    expect(helpers.settingsPathValue({ providers: {} }, ['providers', 'openai'])).toBe(
      undefined
    )
  })

  it('reads a named key from settings and falls back for official DeepSeek', async () => {
    const helpers = await loadHelpers()
    const ctx = mockCtx({
      declared: [
        {
          provider: 'openai',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'openai']
        },
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }
      ],
      settings: {
        'llm-pi-ai': { providers: { openai: { apiKeyEnv: 'MY_OPENAI_KEY' } } },
        'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY' }
      }
    })

    expect(helpers.namedProviderKeyRef(ctx, 'openai')).toBe('MY_OPENAI_KEY')
    expect(helpers.namedProviderKeyRef(ctx, 'deepseek-official')).toBe('DEEPSEEK_API_KEY')
    expect(helpers.namedProviderKeyRef(ctx, 'ollama')).toBeUndefined()
  })

  it('treats official DeepSeek without a key as unusable and remaps to a configured provider', async () => {
    const helpers = await loadHelpers()
    const ctx = mockCtx({
      providers: [{ id: 'deepseek-official' }, { id: 'openai' }],
      models: {
        'deepseek-official': [{ id: 'deepseek-v4-flash' }],
        openai: [{ id: 'gpt-5.6' }, { id: 'gpt-5.4' }]
      },
      configured: { DEEPSEEK_API_KEY: false, OPENAI_API_KEY: true },
      declared: [
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] },
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }
      ],
      settings: {
        'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY' },
        'llm-pi-ai': { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } }
      }
    })

    const adopted = await helpers.adoptUsableDefaultSelection(ctx)

    expect(adopted.routableProviders).toEqual(['openai'])
    expect(adopted.selection).toEqual({ provider: 'openai', model: 'gpt-5.6' })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({
      provider: 'openai',
      model: 'gpt-5.6'
    })
  })

  it('keeps official DeepSeek when its key is configured', async () => {
    const helpers = await loadHelpers()
    const ctx = mockCtx({
      providers: [{ id: 'deepseek-official' }, { id: 'openai' }],
      models: {
        'deepseek-official': [{ id: 'deepseek-v4-flash' }],
        openai: [{ id: 'gpt-5.6' }]
      },
      configured: { DEEPSEEK_API_KEY: true, OPENAI_API_KEY: true },
      declared: [
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }
      ],
      settings: { 'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY' } }
    })

    const adopted = await helpers.adoptUsableDefaultSelection(ctx)
    expect(adopted.selection).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash'
    })
    expect(adopted.routableProviders).toEqual(['deepseek-official', 'openai'])
  })

  it('keeps a saved usable selection and skips a provider whose catalog fails', async () => {
    const helpers = await loadHelpers()
    const saved = mockCtx({
      wanted: { provider: 'openai', model: 'gpt-5.4', reasoningEffort: 'high' },
      providers: [{ id: 'openai' }],
      models: {
        openai: [{ id: 'gpt-5.6' }, { id: 'gpt-5.4' }]
      },
      configured: { OPENAI_API_KEY: true },
      declared: [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }
      ],
      settings: {
        'llm-pi-ai': { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } }
      }
    })
    expect(await helpers.adoptUsableDefaultSelection(saved)).toEqual({
      selection: { provider: 'openai', model: 'gpt-5.4', reasoningEffort: 'high' },
      routableProviders: ['openai']
    })

    const skipped = mockCtx({
      providers: [{ id: 'broken' }, { id: 'openai' }],
      models: {
        openai: [{ id: 'gpt-5.6' }]
      },
      configured: { OPENAI_API_KEY: true },
      declared: [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }
      ],
      settings: {
        'llm-pi-ai': { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } }
      }
    })
    expect(await helpers.providerHasUsableCredential(skipped, 'broken')).toBe(true)
    expect(await helpers.adoptUsableDefaultSelection(skipped)).toEqual({
      selection: { provider: 'openai', model: 'gpt-5.6' },
      routableProviders: ['broken', 'openai']
    })
  })

  it('does not pretend official DeepSeek is routable when nothing is configured', async () => {
    const helpers = await loadHelpers()
    const ctx = mockCtx({
      providers: [{ id: 'deepseek-official' }],
      models: { 'deepseek-official': [{ id: 'deepseek-v4-flash' }] },
      configured: { DEEPSEEK_API_KEY: false },
      declared: [
        { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }
      ],
      settings: { 'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY' } }
    })

    const adopted = await helpers.adoptUsableDefaultSelection(ctx)
    expect(adopted.routableProviders).toEqual([])
    expect(adopted.selection).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash'
    })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash'
    })
  })
})

describe('usable default model patch contract', () => {
  it('is captured in the session-controller patch and installed bundle', async () => {
    const [patch, installed] = await Promise.all([
      readFile(patchPath('@deepseek-ai/dsh-api-session-controller'), 'utf8'),
      readFile(sessionController, 'utf8')
    ])

    for (const marker of [
      'function adoptUsableDefaultSelection(ctx)',
      'function providerHasUsableCredential(ctx, providerId)',
      'async resolvedAgentOptions()',
      'routableProviders: adopted.routableProviders'
    ]) {
      expect(installed).toContain(marker)
      expect(patch).toContain(marker)
    }
  })
})
