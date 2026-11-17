// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => {
  document.body.replaceChildren()
  delete window.dshDesktop
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  vi.restoreAllMocks()
})

it('uses Harness locale for every desktop client action and keeps registrations disposable', async () => {
  const source = await readFile(resolve('packages/dsh-desktop-client-ui/client.js'), 'utf8')
  let definition
  let active = 'ja'
  const dictionaries = new Map()
  const registrations = []
  const effects = []
  const confirm = vi.fn(() => false)
  vm.runInNewContext(source, {
    document: { getElementById: () => true, querySelector: () => true, documentElement: { get lang() { throw new Error('DOM language must not be read') } } },
    window: { __ModuleLoader__: { load: (value) => { definition = value } }, dshDesktop: { openInFinder: vi.fn() }, confirm }
  })
  const plugin = definition.factory((id) => {
    if (id === 'react') return {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => [initial, vi.fn()]
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton: 'menu-item' }
    throw new Error(id)
  })
  plugin.apply({
    effect: (setup) => { const dispose = setup(); if (dispose) effects.push(dispose) },
    locale: {
      register: (ns, messages) => { dictionaries.set(ns, messages); return () => dictionaries.delete(ns) },
      bind: (ns) => (key, params = {}) => {
        const messages = dictionaries.get(ns)
        const value = messages?.[active]?.[key] ?? messages?.en?.[key]
        if (!value) throw new Error(`Missing ${ns}:${active}:${key}`)
        return value.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
      }
    },
    slots: {
      inject: (_name, callback) => { const result = callback(); if (result?.[Symbol.iterator]) for (const _entry of result) void _entry; return result },
      register: (config, component) => { registrations.push({ config, component }); return () => {} }
    }
  })
  for (const messages of dictionaries.values()) {
    expect(Object.keys(messages).sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
    for (const entries of Object.values(messages)) {
      expect(Object.keys(entries).sort()).toEqual(Object.keys(messages.en ?? {}).sort())
      for (const [key, value] of Object.entries(entries)) {
        expect(value.trim()).not.toBe('')
        expect(value.match(/\{\w+\}/g) ?? []).toEqual(messages.en?.[key]?.match(/\{\w+\}/g) ?? [])
      }
    }
  }
  const deletion = registrations.find(item => item.config.id === 'desktop-delete-session')
  const injected = deletion.config.inject()
  const sessionProps = { ...injected, sessionId: 'session', displayTitle: '<My session>', useMenuOpenState: () => [true, vi.fn()] }
  const japanese = deletion.component(sessionProps)
  expect(japanese.children).toContain('セッションを完全に削除')
  japanese.props.onSelect()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('<My session>'))
  expect(confirm).toHaveBeenCalledWith(expect.not.stringContaining('{title}'))
  active = 'fr'
  expect(deletion.component(sessionProps).children).toContain('Supprimer définitivement la session')
  const unread = registrations.find(item => item.config.id === 'desktop-unread-session')
  expect(unread.component({ ...unread.config.inject(), unread: false, useMenuOpenState: () => [true, vi.fn()] }).children).toContain('Marquer comme non lu')
  for (const dispose of effects) dispose()
  expect(dictionaries.size).toBe(0)
})
