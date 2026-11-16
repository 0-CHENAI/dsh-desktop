// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { mountWindowsMenuBar } from '../src/preload/windows-menu-bar'

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('lang')
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const host = (): HTMLElement | null => document.querySelector('[data-dsh-windows-menu]')
const button = (name: string): HTMLButtonElement | null =>
  host()?.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-menu="${name}"]`) ?? null

it('marks the Windows caption from the shell preload before the page paints', async () => {
  const preload = await readFile(resolve(import.meta.dirname, '../src/preload/app.ts'), 'utf8')
  expect(preload).toContain('markWindowsTitlebar(document)')
  expect(preload).toContain('mountWindowsTitlebarLayout(')
})

it('waits for the Harness shell overlay before taking the caption seat', async () => {
  const invoke = vi.fn(async () => undefined)
  const menu = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  expect(host()).toBeNull()

  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  document.body.append(overlay)
  await flush()

  expect(host()).not.toBeNull()
  expect(host()?.hasAttribute('data-standalone')).toBe(false)
  menu.dispose()
  expect(host()).toBeNull()
})

it('shares one pending mount and releases it before remounting', async () => {
  const invoke = vi.fn(async () => undefined)
  const menu = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  expect(mountWindowsMenuBar({ document, ipcRenderer: { invoke } })).toBe(menu)
  document.body.innerHTML = '<div data-shell-overlay></div>'
  await flush()
  expect(document.querySelectorAll('[data-dsh-windows-menu]')).toHaveLength(1)
  button('main')?.click()
  await flush()
  expect(invoke).toHaveBeenCalledOnce()
  menu.dispose()
  const next = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  expect(next).not.toBe(menu)
  menu.dispose()
  expect(mountWindowsMenuBar({ document, ipcRenderer: { invoke } })).toBe(next)
  expect(document.querySelectorAll('[data-dsh-windows-menu]')).toHaveLength(1)
  next.dispose()
})

it('opens the native popup under the pressed button and labels it in the page language', async () => {
  document.documentElement.lang = 'zh-CN'
  document.body.append(document.createElement('div'))
  document.body.lastElementChild?.setAttribute('data-shell-overlay', '')
  const invoke = vi.fn(async () => undefined)
  const menu = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })

  expect(host()?.shadowRoot?.querySelectorAll('button')).toHaveLength(1)
  expect(button('main')?.getAttribute('aria-label')).toBe('应用菜单')
  expect(button('main')?.textContent).toBe('')
  expect(button('main')?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

  const main = button('main')
  if (!main) throw new Error('main menu button was not mounted')
  main.getBoundingClientRect = () => DOMRect.fromRect({ x: 12, y: 48, width: 28, height: 28 })
  main.click()
  expect(main.getAttribute('aria-expanded')).toBe('true')
  await flush()
  expect(invoke).toHaveBeenCalledWith('desktop-titlebar:popup-menu', 'main', 12, 76)
  expect(main.getAttribute('aria-expanded')).toBe('false')

  document.documentElement.lang = 'en'
  await flush()
  expect(button('main')?.title).toBe('Application menu')
  menu.dispose()
})

it('restores the editor selection for keyboard opening and prevents duplicate popups', async () => {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  const editor = document.createElement('textarea')
  editor.value = 'selected text'
  document.body.append(overlay, editor)
  let closePopup = (): void => {}
  const invoke = vi.fn(() => new Promise<void>(resolve => { closePopup = resolve }))
  const menu = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  editor.focus()
  editor.setSelectionRange(0, 8)
  const main = button('main')
  if (!main) throw new Error('main menu button was not mounted')
  main.focus()
  main.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
  main.click()
  expect(invoke).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(editor)
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 8])
  closePopup()
  await flush()
  expect(main.getAttribute('aria-expanded')).toBe('false')
  menu.dispose()
})

it('allows opening again after a native popup failure', async () => {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-shell-overlay', '')
  document.body.append(overlay)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const invoke = vi.fn().mockRejectedValueOnce(new Error('popup failed')).mockResolvedValue(undefined)
  const menu = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  button('main')?.click()
  await flush()
  expect(button('main')?.getAttribute('aria-expanded')).toBe('false')
  button('main')?.click()
  await flush()
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(error).toHaveBeenCalledOnce()
  menu.dispose()
  error.mockRestore()
})

it('updates Windows caption labels across all eight UI languages', async () => {
  document.body.innerHTML = '<div data-shell-overlay></div>'
  const menu = mountWindowsMenuBar({ document, ipcRenderer: { invoke: vi.fn(async () => undefined) } })
  for (const [locale, label] of [
    ['zh', '应用菜单'], ['en', 'Application menu'], ['ja', 'アプリケーションメニュー'],
    ['es', 'Menú de aplicación'], ['fr', 'Menu de l’application'], ['de', 'Anwendungsmenü'],
    ['ru', 'Меню приложения'], ['pt', 'Menu do aplicativo']
  ]) {
    document.documentElement.lang = locale ?? ''
    await flush()
    expect(button('main')?.getAttribute('aria-label')).toBe(label)
    expect(button('main')?.title).toBe(label)
  }
  menu.dispose()
})

it('mounts only once per document', () => {
  document.body.append(document.createElement('div'))
  document.body.lastElementChild?.setAttribute('data-shell-overlay', '')
  const invoke = vi.fn(async () => undefined)
  const first = mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  mountWindowsMenuBar({ document, ipcRenderer: { invoke } })
  expect(document.querySelectorAll('[data-dsh-windows-menu]')).toHaveLength(1)
  first.dispose()
})

it('marks <html> as soon as the parser creates it when preload runs first', async () => {
  const { markWindowsTitlebar } = await import('../src/preload/windows-titlebar')
  const doc = document.implementation.createDocument(null, null)
  markWindowsTitlebar(doc)
  const html = doc.createElementNS('http://www.w3.org/1999/xhtml', 'html') as HTMLElement
  doc.append(html)
  await flush()
  expect(html.hasAttribute('data-windows-titlebar')).toBe(true)
  expect(html.style.getPropertyValue('--dsh-windows-titlebar-height')).toBe('env(titlebar-area-height, 36px)')
})

it('keeps app chrome integrated without adding a standalone caption strip in repair sessions', async () => {
  const { mountWindowsTitlebarLayout } = await import('../src/preload/windows-titlebar')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  document.body.innerHTML = '<div id="root"><div data-shell-overlay></div></div>'
  mountWindowsTitlebarLayout({ document, ipcRenderer: { invoke: vi.fn(async () => undefined) } })
  expect(document.body.hasAttribute('data-dsh-standalone-titlebar')).toBe(false)
  expect(getComputedStyle(document.body).paddingTop).toBe('0px')
  expect(host()).not.toBeNull()
  expect(document.getElementById('dsh-desktop-windows-drag-region')).toBeNull()
  vi.unstubAllGlobals()
})
