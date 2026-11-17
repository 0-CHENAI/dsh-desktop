// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://desktop.test/"}
import { afterEach, expect, it, vi } from 'vitest'
import { mountWindowsTitlebarLayout } from '../src/preload/windows-titlebar'

// Vitest copies window globals during environment setup, including storage.
// A file: origin makes jsdom's storage getters throw before the tests can run.
// Reconfigure the real document only after setup so the layout still exercises
// the production file: branch, and restore it before environment teardown.
declare const jsdom: { reconfigure(options: { url: string }): void }

const observers: MutationObserver[] = []

afterEach(() => {
  // Mounting installs long-lived observers; stop them before jsdom closes.
  for (const observer of observers.splice(0)) observer.disconnect()
  jsdom.reconfigure({ url: 'https://desktop.test/' })
  vi.unstubAllGlobals()
})

it('reserves the caption row on standalone recovery pages before mounting menus', () => {
  jsdom.reconfigure({ url: 'file:///desktop/plugin-recovery.html' })
  expect(document.location.protocol).toBe('file:')
  vi.stubGlobal('MutationObserver', class extends MutationObserver {
    constructor(callback: MutationCallback) {
      super(callback)
      observers.push(this)
    }
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  document.body.innerHTML = '<div class="shell"><header>DSH Desktop</header></div>'
  mountWindowsTitlebarLayout({ document, ipcRenderer: { invoke: vi.fn(async () => undefined) } })
  expect(document.body.hasAttribute('data-dsh-standalone-titlebar')).toBe(true)
  // jsdom cannot resolve Electron's env(titlebar-area-height); the native
  // window matrix checks its physical inset at three page zoom levels.
  expect(document.documentElement.style.getPropertyValue('--dsh-windows-titlebar-height')).toBe('env(titlebar-area-height, 36px)')
  expect(document.querySelector('[data-dsh-windows-menu]')).not.toBeNull()
  const shell = document.querySelector<HTMLElement>('.shell')
  if (!shell) throw new Error('standalone shell missing')
  expect(getComputedStyle(shell).height).toBe('100%')
})

it('keeps sidebar caption controls above a sticky plugin header and below overlays', () => {
  vi.stubGlobal('MutationObserver', class extends MutationObserver {
    constructor(callback: MutationCallback) {
      super(callback)
      observers.push(this)
    }
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  document.body.innerHTML = '<div data-dsh-layout-frame><aside data-dsh-layout-sidebar></aside><main><div id="sticky-header" style="position:sticky;z-index:2"><header data-window-drag></header></div></main><div data-shell-overlay style="position:absolute;z-index:20"></div></div>'
  mountWindowsTitlebarLayout({ document, ipcRenderer: { invoke: vi.fn(async () => undefined) } })
  const sidebar = document.querySelector<HTMLElement>('[data-dsh-layout-sidebar]')
  const header = document.querySelector<HTMLElement>('#sticky-header')
  const overlay = document.querySelector<HTMLElement>('[data-shell-overlay]')
  if (!sidebar || !header || !overlay) throw new Error('caption stacking fixture missing')
  expect(Number(getComputedStyle(sidebar).zIndex)).toBeGreaterThan(Number(getComputedStyle(header).zIndex))
  expect(Number(getComputedStyle(sidebar).zIndex)).toBeLessThan(Number(getComputedStyle(overlay).zIndex))
})

it('applies native caption clearance to nested plugin headers', () => {
  vi.stubGlobal('MutationObserver', class extends MutationObserver {
    constructor(callback: MutationCallback) {
      super(callback)
      observers.push(this)
    }
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  document.body.innerHTML = '<div data-dsh-layout-frame><section data-plugin-panel><div><header data-window-drag></header></div></section></div>'
  mountWindowsTitlebarLayout({ document, ipcRenderer: { invoke: vi.fn(async () => undefined) } })
  const header = document.querySelector<HTMLElement>('header[data-window-drag]')
  if (!header) throw new Error('nested plugin header missing')
  expect(getComputedStyle(header).boxSizing).toBe('border-box')
})
