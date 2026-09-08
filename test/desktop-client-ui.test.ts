import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('DSH Desktop client slot occupants', () => {
  it('registers one occupant per brand seat and keeps the official name mark-free', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    vm.runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): { type: unknown; props: Record<string, unknown> } => ({
      type,
      props: { ...props, children }
    })
    const BrandWordmark = vi.fn()
    const FishLogo = vi.fn()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { BrandWordmark, FishLogo }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    plugin.apply({
      slots,
      locale: {
        register: () => undefined,
        bind: () => (key: string) => key
      },
      effect: (fn: () => unknown) => {
        fn()
      }
    })

    expect(plugin.inject).toEqual(['slots', 'locale'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'settings.section'
    ])
    expect(registrations.at(-1)?.config).toMatchObject({
      id: 'version',
      order: 50
    })

    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({}) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarName.type).toBe(BrandWordmark)
    expect(sidebarName.props.includeMark).toBe(false)

    expect(
      registrations.find(({ config }) => config.name === 'sidebar.brand.mark')!.component
    ).toBe(FishLogo)
    expect(
      registrations.find(({ config }) => config.name === 'conversation.hero.brand.mark')!
        .component
    ).toBe(FishLogo)
  })

  it('exposes version notes through the desktop bridge and settings section', async () => {
    const [client, manifest, preload, main] = await Promise.all([
      readFile(path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'), 'utf8'),
      readFile(
        path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'package.json'),
        'utf8'
      ),
      readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')
    ])

    expect(client).toContain("id: 'version'")
    expect(client).toContain('order: 50')
    expect(client).toContain("nav: '版本'")
    expect(client).toContain("changelog: '更新说明'")
    expect(client).toContain('bridge.getVersionPage')
    expect(manifest).toContain('@deepseek-ai/dsh-client-ui-settings-general')
    expect(manifest).toContain('@deepseek-ai/dsh-client-locale')
    expect(preload).toContain('getVersionPage: (): Promise<VersionPageInfo>')
    expect(preload).toContain("ipcRenderer.invoke('desktop:version-page')")
    expect(main).toContain("ipcMain.handle('desktop:version-page'")
    expect(main).toContain('fetchDesktopReleaseNotes()')
  })
})
