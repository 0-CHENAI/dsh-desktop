import { desktopLocale } from '../shared/desktop-locale'
import type { IpcRenderer } from 'electron'

interface MenuBarOptions {
  document: Document
  ipcRenderer: Pick<IpcRenderer, 'invoke'>
}

interface MenuBarMount {
  dispose(): void
}

const HOST_ATTRIBUTE = 'data-dsh-windows-menu'
const mountedMenus = new WeakMap<Document, MenuBarMount>()

/**
 * Application and Edit menus share the native caption row. A collapsed
 * sidebar keeps it in the caption, clear of the reopen/new-session buttons.
 * This is window chrome, so business UI slots do not own the native popup.
 *
 * Harness pages wait for AppFrame's shell overlay so the menubar appears with
 * the rendered application; Desktop's own pages (plugin recovery, splash) have
 * no sidebar and mount immediately at the caption's left edge.
 */
export function mountWindowsMenuBar(options: MenuBarOptions): MenuBarMount {
  const { document, ipcRenderer } = options
  const existing = mountedMenus.get(document)
  if (existing) return existing

  const host = document.createElement('div')
  host.setAttribute(HOST_ATTRIBUTE, '')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { position: fixed; top: 0; left: var(--dsh-windows-menu-start, 12px); z-index: 1100;
      height: var(--dsh-windows-titlebar-height, 40px); display: flex; align-items: center; overflow: hidden;
      font-family: var(--dsw-font-family, "Segoe UI", sans-serif); -webkit-app-region: drag; }
    :host([data-standalone]) { left: 12px; }
    button { display: flex; align-items: center; justify-content: center;
      min-width: 40px; height: min(28px, var(--dsh-windows-titlebar-height, 40px)); padding: 0 10px; border: 0; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-secondary, #5f6368);
      font: 13px var(--dsw-font-family, "Segoe UI", sans-serif); cursor: default; -webkit-app-region: no-drag; }
    button:hover, button[aria-expanded=true] {
      background: var(--dsw-alias-interactive-bg-hover, rgba(32, 33, 36, .08));
      color: var(--dsw-alias-label-primary, #202124); }
    button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -2px; }
  `
  // Opening a menu must not take focus from the composer: the edit commands
  // act on whatever editor held it.
  let restoreEditor = (): void => {}
  const rememberEditor = (event: FocusEvent): void => {
    const target = event.composedPath()[0]
    if (!(target instanceof HTMLElement) || target === host || shadow.contains(target)) return
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)
      && !target.matches('[contenteditable="true"]')) return
    const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : undefined
    const start = input?.selectionStart
    const end = input?.selectionEnd
    const selection = document.getSelection()
    const ranges = selection === null
      ? []
      : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    restoreEditor = () => {
      if (!target.isConnected) return
      target.focus({ preventScroll: true })
      if (input !== undefined && start != null && end != null) input.setSelectionRange(start, end)
      else if (selection !== null && ranges.length > 0) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      }
    }
  }
  document.addEventListener('focusout', rememberEditor, true)

  const buttons = new Map<string, HTMLButtonElement>()
  shadow.append(style)
  for (const name of ['application', 'edit']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.menu = name
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.addEventListener('pointerdown', (event) => event.preventDefault())
    button.addEventListener('mousedown', (event) => event.preventDefault())
    const open = async (): Promise<void> => {
      if (button.getAttribute('aria-expanded') === 'true') return
      const rect = button.getBoundingClientRect()
      button.setAttribute('aria-expanded', 'true')
      if (document.activeElement === host) restoreEditor()
      try {
        await ipcRenderer.invoke('desktop-titlebar:popup-menu', name, rect.left, rect.bottom)
      } catch (error) {
        console.error('[desktop-titlebar] caption menu failed', error)
      } finally {
        button.setAttribute('aria-expanded', 'false')
      }
    }
    button.addEventListener('click', () => void open())
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      void open()
    })
    shadow.append(button)
    buttons.set(name, button)
  }
  const relabel = (): void => {
    const locale = desktopLocale(document.documentElement.lang || navigator.language) ?? 'en'
    const labels: Record<string, [string, string]> = {
      zh: ['应用', '编辑'], en: ['Application', 'Edit'], ja: ['アプリ', '編集'],
      es: ['Aplicación', 'Editar'], fr: ['Application', 'Édition'], de: ['Anwendung', 'Bearbeiten'],
      ru: ['Приложение', 'Правка'], pt: ['Aplicativo', 'Editar']
    }
    const text = labels[locale] ?? ['Application', 'Edit']
    let index = 0
    for (const button of buttons.values()) {
      button.textContent = text[index++] ?? ''
      button.setAttribute('aria-label', button.textContent)
      button.title = button.textContent
    }
  }
  relabel()
  const languageObserver = new MutationObserver(relabel)
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

  const standalone = document.location.protocol === 'file:'
  if (standalone) host.dataset.standalone = ''
  const mount = (): void => {
    if (!document.body) return
    // AppFrame owns this seat on Harness pages; before it renders, the
    // caption row belongs to the loading surface.
    if (!standalone && document.querySelector('[data-shell-overlay]') === null) return
    document.body.append(host)
    mountObserver.disconnect()
  }
  const mountObserver = new MutationObserver(mount)
  mountObserver.observe(document.documentElement, { childList: true, subtree: true })
  const menu: MenuBarMount = {
    dispose: () => {
      if (mountedMenus.get(document) !== menu) return
      mountObserver.disconnect()
      languageObserver.disconnect()
      document.removeEventListener('focusout', rememberEditor, true)
      host.remove()
      mountedMenus.delete(document)
    }
  }
  mountedMenus.set(document, menu)
  mount()
  return menu
}
