import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

/**
 * The plugins tab hands a third-party card no stylesheet: it lays out the flex
 * column, dispatches `settings.plugin.item`, and leaves the appearance to the
 * plugin. `@perrylink/dsh-github` 0.7.7 and 0.7.8 name these classes and ship
 * no rules at all — no stylesheet in the package, no style injection in
 * `lib/client.js` — so the card rendered with browser defaults until the
 * desktop client UI supplied the chrome. This is the contract that shim has to
 * keep: every class the plugin renders, on the host's own card geometry.
 */
const PLUGIN_CLASSES = [
  'ghc-actions',
  'ghc-badge',
  'ghc-badgeMuted',
  'ghc-badges',
  'ghc-body',
  'ghc-card',
  'ghc-cardOpen',
  'ghc-chevron',
  'ghc-chevronOpen',
  'ghc-description',
  'ghc-failed',
  'ghc-field',
  'ghc-head',
  'ghc-headText',
  'ghc-header',
  'ghc-hint',
  'ghc-input',
  'ghc-label',
  'ghc-name',
  'ghc-pending',
  'ghc-readOnly',
  'ghc-spin'
]

interface FakeStyle {
  dataset: Record<string, string>
  textContent: string
}

/** Run the desktop client UI with a document that keeps what it installs. */
async function installStyles(): Promise<{ sheets: FakeStyle[]; css: string }> {
  const source = await readFile(
    path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
    'utf8'
  )
  const sheets: FakeStyle[] = []
  const document = {
    querySelector: (selector: string): FakeStyle | null => {
      const marker = selector.match(/data-plugin-css="([^"]+)"/)?.[1]
      return sheets.find((sheet) => sheet.dataset.pluginCss === marker) ?? null
    },
    createElement: (): FakeStyle => ({ dataset: {}, textContent: '' }),
    head: { appendChild: (sheet: FakeStyle) => sheets.push(sheet) }
  }
  let definition:
    | { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } }
    | undefined
  vm.runInNewContext(source, {
    document,
    window: {
      __ModuleLoader__: {
        load: (value: typeof definition) => {
          definition = value
        }
      }
    }
  })
  const plugin = definition!.factory((id) => {
    if (id === 'react') return { createElement: () => null, useEffect: () => undefined }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { BrandWordmark: () => null, FishLogo: () => null }
    }
    throw new Error(`unexpected require: ${id}`)
  })
  plugin.apply({
    slots: { inject: () => undefined, register: () => () => undefined },
    locale: { register: () => undefined, bind: () => (key: string) => key },
    effect: (fn: () => unknown) => {
      fn()
    }
  })
  return { sheets, css: sheets[0]?.textContent ?? '' }
}

/** Selectors the sheet declares, comments removed. */
function selectorsOf(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('{'))
    .map((line) => line.slice(0, line.indexOf('{')).trim())
}

describe('plugin card chrome shim', () => {
  it('draws every class the affected plugin names', async () => {
    const { css } = await installStyles()
    expect(css.length).toBeGreaterThan(0)

    for (const className of PLUGIN_CLASSES) {
      expect(css, `no rule for .${className}`).toContain(`.${className}{`)
    }
  })

  it('uses the host PluginCard geometry, so a shimmed card is not a lookalike', async () => {
    const { css } = await installStyles()
    const card = css.match(/\.ghc-card\{([^}]*)\}/)?.[1] ?? ''
    const header = css.match(/\.ghc-header\{([^}]*)\}/)?.[1] ?? ''

    expect(card).toContain('display:flex')
    expect(card).toContain('flex-direction:column')
    expect(card).toContain('border:.5px solid var(--dsw-alias-border-l4)')
    expect(card).toContain('border-radius:16px')
    expect(header).toContain('appearance:none')
    expect(header).toContain('border:0')
    expect(header).toContain('text-align:left')
  })

  it('stays inside its own namespace', async () => {
    const { sheets, css } = await installStyles()

    // One sheet, owned by this plugin, so a host that ever learns to clean up
    // plugin-owned style tags can still find it.
    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.dataset.plugin).toBe('dsh-desktop-client-ui')
    expect(sheets[0]?.dataset.pluginCss).toBe('dsh-desktop-client-ui')

    // A shim that reached beyond the plugin's prefix would restyle the host's
    // own settings UI — the one surface it must never touch.
    const foreign = selectorsOf(css).filter(
      (selector) =>
        !selector.startsWith('.ghc-') &&
        !selector.startsWith('.dshDesktop') &&
        !selector.startsWith('@media') &&
        !selector.startsWith('@keyframes')
    )
    expect(foreign).toEqual([])
  })
})
