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
 * shares the conversation header with native controls and gives the sidebar
 * a toolbar above its brand. Standalone recovery pages retain a separate drag
 * strip; dialogs release native drag areas without moving their React nodes.
 */
export function mountWindowsTitlebarLayout(options: TitlebarLayoutMountOptions): void {
  const { document, ipcRenderer } = options
  markWindowsTitlebar(document)
  if (!document.body) return

  const standalone = document.location.protocol === 'file:'
  document.body.toggleAttribute('data-dsh-standalone-titlebar', standalone)
  installLayout(document)
  if (document.location.protocol === 'file:') installDragRegion(document)
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
    body.dsh-desktop-windows-titlebar-layout {
      box-sizing: border-box !important;
      height: 100% !important;
      padding-top: 0 !important;
    }
    /* Local recovery pages do not have Harness AppFrame to reserve a caption
       row. Keep their logo/actions below both the menu and native controls. */
    body.dsh-desktop-windows-titlebar-layout[data-dsh-standalone-titlebar] {
      padding-top: var(--dsh-windows-titlebar-height) !important;
    }
    body.dsh-desktop-windows-titlebar-layout[data-dsh-standalone-titlebar] > .shell {
      height: 100% !important;
      min-height: 0 !important;
    }
    body.dsh-desktop-windows-titlebar-layout > #root {
      height: 100% !important;
      min-height: 0 !important;
    }
    /* Share the first header row with native controls instead of reserving a
       separate strip across the work area. Electron reports zoom-aware bounds. */
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame] {
      padding-top: 0;
      --dsh-frame-top-clearance: 0px;
      --dsh-frame-chrome-top: 0px;
      --dsh-windows-leading-inset: 0px;
      --dsh-windows-toolbar-height: max(40px, var(--dsh-windows-titlebar-height));
      --dsh-windows-controls-inset: max(0px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px))));
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame]::before {
      display: none;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame][data-sidebar-collapsed] {
      --dsh-frame-leading-clearance: 120px;
      --dsh-windows-leading-inset: 120px;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame]:not([data-rightbar-collapsed]) {
      --dsh-windows-controls-inset: 0px;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-sidebar] {
      position: relative;
      /* The plugin manager's sticky header paints at 2. Keep caption controls
         above it, while frame resize handles (11) and overlays (20) stay above. */
      z-index: 3;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-sidebar]::before {
      content: '';
      position: absolute;
      inset: 0 0 auto;
      height: var(--dsh-windows-toolbar-height);
      -webkit-app-region: drag;
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-root][data-dsh-sidebar-wide="true"] {
      position: relative;
      padding-top: calc(var(--dsh-windows-toolbar-height) + 8px) !important;
    }
    /* The menu and collapse control belong to the toolbar, above the brand. */
    body.dsh-desktop-windows-titlebar-layout:has([data-dsh-sidebar-root][data-dsh-sidebar-wide="true"]) [data-dsh-windows-menu]:not([data-standalone]) {
      left: 12px;
      height: max(40px, var(--dsh-windows-titlebar-height));
    }
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] [data-dsh-sidebar-toggle],
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] [data-dsh-sidebar-new-session] {
      top: max(0px, calc((var(--dsh-windows-titlebar-height) - 28px) / 2)) !important;
    }
    html[data-fullscreen][data-windows-titlebar] {
      --dsh-windows-titlebar-height: 0px !important;
    }
    html[data-fullscreen] body.dsh-desktop-windows-titlebar-layout [data-dsh-layout-frame][data-sidebar-collapsed] {
      --dsh-frame-leading-clearance: 84px;
      --dsh-windows-leading-inset: 84px;
    }
    html[data-fullscreen] [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] [data-dsh-sidebar-toggle],
    html[data-fullscreen] [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] [data-dsh-sidebar-new-session] {
      top: 10px !important;
    }
    html[data-fullscreen] [data-dsh-windows-menu] { display: none !important; }
    /* Preserve the existing React control and its state while changing its
       native-chrome seat; collapsed controls stay reachable in the header. */
    body.dsh-desktop-windows-titlebar-layout [data-dsh-sidebar-root][data-dsh-sidebar-wide="true"] [data-dsh-sidebar-toggle] {
      position: absolute !important;
      inset: calc((var(--dsh-windows-toolbar-height) - 28px) / 2) 12px auto auto !important;
      flex-shrink: 0;
      z-index: 1;
    }
    body.dsh-desktop-windows-titlebar-layout header:has([data-conversation-header-leading]) {
      --dsh-frame-leading-clearance: 0px;
      grid-template-rows: var(--dsh-windows-toolbar-height) auto;
      padding-top: 0;
      padding-bottom: 0;
      padding-left: 0;
      padding-right: calc(28px + var(--dsh-windows-controls-inset));
      -webkit-app-region: drag;
    }
    /* Collapsed controls live in a zero-width sidebar column. Their own
       no-drag boxes can be clipped out of Electron's native hit map; reserve
       a real leading box in the header that owns the overlapping drag area.
       Keep slot contributions interactive and include the original inset. */
    body.dsh-desktop-windows-titlebar-layout [data-conversation-header-leading] {
      box-sizing: border-box;
      min-width: var(--dsh-windows-leading-inset);
      min-height: var(--dsh-windows-toolbar-height);
      padding-left: 20px;
      -webkit-app-region: no-drag;
    }
    body.dsh-desktop-windows-titlebar-layout [data-plugin-panel] header[data-window-drag] {
      box-sizing: border-box;
      min-height: var(--dsh-windows-toolbar-height);
      padding-right: calc(28px + var(--dsh-windows-controls-inset));
    }
    /* The dock surface is absolutely anchored to AppFrame, so column padding
       cannot move it. Offset the real panel in both push and expanded modes. */
    body.dsh-desktop-windows-titlebar-layout [data-sidebar-right-panel] {
      top: var(--dsh-windows-titlebar-height);
    }
    /* A drag region wins over a dialog's buttons in the caption row, so both
       Harness's caption strip and Desktop's own give way while one is open. */
    html[${MODAL_OPEN_ATTRIBUTE}] :has(> [data-shell-overlay])::before,
    html[${MODAL_OPEN_ATTRIBUTE}] [data-dsh-layout-sidebar]::before,
    html[${MODAL_OPEN_ATTRIBUTE}] [data-window-drag] {
      -webkit-app-region: no-drag !important;
    }
    html[${MODAL_OPEN_ATTRIBUTE}] #${DRAG_REGION_ID} { display: none !important; }
    body.dsh-desktop-windows-titlebar-layout button,
    body.dsh-desktop-windows-titlebar-layout a,
    body.dsh-desktop-windows-titlebar-layout input,
    body.dsh-desktop-windows-titlebar-layout select,
    body.dsh-desktop-windows-titlebar-layout textarea,
    body.dsh-desktop-windows-titlebar-layout [role="button"],
    body.dsh-desktop-windows-titlebar-layout [role="tab"],
    body.dsh-desktop-windows-titlebar-layout [role="menuitem"],
    body.dsh-desktop-windows-titlebar-layout [data-dsh-no-drag] {
      -webkit-app-region: no-drag !important;
    }
    #${DRAG_REGION_ID} {
      position: fixed;
      z-index: 10;
      top: 0;
      left: 0;
      right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px)));
      height: var(--dsh-windows-titlebar-height);
      background: transparent;
      pointer-events: none;
      user-select: none;
      -webkit-app-region: drag;
    }
  `
  document.head.appendChild(style)
}

/** Desktop's local pages have no Harness caption strip, so they get their own. */
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
