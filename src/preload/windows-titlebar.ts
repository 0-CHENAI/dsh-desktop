import type { IpcRenderer } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from '../shared/desktop-menu'
import { mountWindowsMenuBar } from './windows-menu-bar'

const LAYOUT_STYLE_ID = 'dsh-desktop-windows-titlebar-layout-style'
const DRAG_REGION_ID = 'dsh-desktop-windows-drag-region'
const MODAL_OPEN_ATTRIBUTE = 'data-dsh-modal-open'

interface TitlebarLayoutMountOptions {
  document: Document
  ipcRenderer: Pick<IpcRenderer, 'invoke'>
}

/** Harness reads this marker while creating its first layout frame.
 * Its Windows-named seam is also used for the Linux overlay; data-platform stays Linux.
 */
export function markWindowsTitlebar(document: Document): void {
  const apply = (root: HTMLElement): void => {
    root.dataset.windowsTitlebar = ''
    // Electron exposes this in CSS pixels, including the current page zoom.
    root.style.setProperty('--dsh-windows-titlebar-height', `env(titlebar-area-height, ${WINDOWS_TITLEBAR_HEIGHT}px)`)
  }
  const root = document.documentElement as HTMLElement | null
  if (root) {
    apply(root)
    return
  }
  // Preload can run before the parser creates <html>. Mark it the moment it
  // exists so every Harness script, including its first layout, sees it.
  const observer = new MutationObserver(() => {
    const created = document.documentElement as HTMLElement | null
    if (!created) return
    observer.disconnect()
    apply(created)
  })
  observer.observe(document, { childList: true })
}

/**
 * Windows/Linux chrome: AppFrame supplies the layout markers, while Desktop
 * reserves a dedicated caption row above the application content. Standalone recovery pages retain a separate drag
 * strip; dialogs release native drag areas without moving their React nodes.
 */
export function mountWindowsTitlebarLayout(options: TitlebarLayoutMountOptions): void {
  const { document, ipcRenderer } = options
  markWindowsTitlebar(document)
  if (!document.body) return

  const standalone = document.location.protocol === 'file:'
  document.body.toggleAttribute('data-dsh-standalone-titlebar', standalone)
  installLayout(document)
  installDragRegion(document)
  trackModals(document)
  mountWindowsMenuBar({ document, ipcRenderer })

  syncTheme(document, ipcRenderer)
  const themeObserver = new MutationObserver(() => syncTheme(document, ipcRenderer))
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-ds-dark-theme', 'class', 'style']
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncTheme(document, ipcRenderer)
  })
}

function installLayout(document: Document): void {
  document.body.classList.add('dsh-desktop-windows-titlebar-layout')
  if (document.getElementById(LAYOUT_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = LAYOUT_STYLE_ID
  style.textContent = `
    html, body { height: 100% !important; }
    body.dsh-desktop-windows-titlebar-layout:has(> #root) {
      --dsh-caption-height: env(titlebar-area-height, ${WINDOWS_TITLEBAR_HEIGHT}px);
      --dsh-frame-top-clearance: 0px;
      --dsh-frame-chrome-top: 0px;
      --dsh-frame-leading-clearance: 0px;
      --dsh-frame-overlay-top: calc(var(--dsh-caption-height) + 20px);
      box-sizing: border-box !important;
      margin: 0 !important;
      padding-top: var(--dsh-caption-height) !important;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-resize-handle] { top: 0 !important; }
    /* One dedicated caption row. Its drag region never overlaps page headers. */
    body.dsh-desktop-windows-titlebar-layout:has(> #root)::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--dsh-caption-height);
      background: var(--dsw-specific-sidebar-fill, #f8f9fa);
    }
    body.dsh-desktop-windows-titlebar-layout > #root { height: 100% !important; min-height: 0 !important; }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame] {
      padding-top: 0 !important;
      --dsh-frame-leading-clearance: 0px;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame]::before { content: none !important; display:none !important; }
    body.dsh-desktop-windows-titlebar-layout [data-window-drag] { -webkit-app-region: no-drag; }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-toggle] {
      position: fixed !important;
      top: calc((var(--dsh-windows-titlebar-height) - 28px) / 2) !important;
      left: 12px !important;
      margin: 0 !important;
      z-index: 1101;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-toggle] svg { width: 16px; height: 16px; }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-wide="false"] [data-dsh-sidebar-new-session] { z-index:1101 !important; }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-root][data-dsh-sidebar-wide="true"] { padding-top: 8px !important; }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-windows-menu] { --dsh-windows-menu-start: 48px; }
    body.dsh-desktop-windows-titlebar-layout:has([data-dsh-sidebar-wide="false"]) [data-dsh-windows-menu] { --dsh-windows-menu-start: 84px; }
    body.dsh-desktop-windows-titlebar-layout header[data-window-drag] { padding-top: 14px !important; }
    body.dsh-desktop-windows-titlebar-layout button,
    body.dsh-desktop-windows-titlebar-layout a,
    body.dsh-desktop-windows-titlebar-layout input,
    body.dsh-desktop-windows-titlebar-layout [role="button"] { -webkit-app-region: no-drag !important; }
    body.dsh-desktop-windows-titlebar-layout[data-dsh-standalone-titlebar] { padding-top: var(--dsh-windows-titlebar-height); }
    body.dsh-desktop-windows-titlebar-layout[data-dsh-standalone-titlebar] > .shell { height:100%; min-height:0; }
    html[${MODAL_OPEN_ATTRIBUTE}] body.dsh-desktop-windows-titlebar-layout::before { -webkit-app-region:no-drag !important; }
    html[data-fullscreen] [data-dsh-windows-menu] { display:none !important; }
    #${DRAG_REGION_ID} { position:fixed; top:0; left:0; right:0; height:var(--dsh-windows-titlebar-height); z-index:1000; -webkit-app-region:drag; }
    html[${MODAL_OPEN_ATTRIBUTE}] #${DRAG_REGION_ID} { display:none; }
  `
  document.head.appendChild(style)
}

/** Keep the caption above page no-drag regions; actual controls sit above this layer. */
function installDragRegion(document: Document): void {
  if (document.getElementById(DRAG_REGION_ID)) return
  const dragRegion = document.createElement('div')
  dragRegion.id = DRAG_REGION_ID
  dragRegion.setAttribute('aria-hidden', 'true')
  document.body.appendChild(dragRegion)
}

function trackModals(document: Document): void {
  // Only semantic dialog markers count: class-name guesses match permanent
  // elements and would release the drag area for good.
  const modalSelector = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  const update = (): void => {
    const hasModal = Array.from(document.querySelectorAll<HTMLElement>(modalSelector)).some((el) => {
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return false
      const style = window.getComputedStyle(el)
      return style.visibility !== 'hidden' && style.opacity !== '0'
    })
    document.documentElement.toggleAttribute(MODAL_OPEN_ATTRIBUTE, hasModal)
  }

  // Streaming output mutates the DOM continuously; check at most once a frame.
  let scheduled = false
  const scheduleUpdate = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      update()
    })
  }
  const observer = new MutationObserver(scheduleUpdate)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'style', 'class', 'hidden', 'aria-hidden', 'aria-modal', 'role']
  })
  update()
}

function syncTheme(document: Document, ipcRenderer: Pick<IpcRenderer, 'invoke'>): void {
  const isDark = documentIsDark(document)
  void ipcRenderer.invoke('desktop-titlebar:set-theme', isDark).catch((error: unknown) => {
    console.warn('[desktop-titlebar] unable to synchronize native theme', error)
  })
}

export function documentIsDark(document: Document): boolean {
  if (document.body.hasAttribute('data-ds-dark-theme')) return true
  const color = document.defaultView?.getComputedStyle(document.body).backgroundColor ?? ''
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    return document.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches ?? false
  }
  const [red = 255, green = 255, blue = 255] = channels
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 128
}
