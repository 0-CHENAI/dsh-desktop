const LAYOUT_STYLE_ID = 'dsh-desktop-macos-titlebar-layout-style'
const DRAG_REGION_ID = 'dsh-desktop-drag-region'
const HEADER_SLOT = '[data-slot="conversation.session.header"]'
const NO_DRAG_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  'summary',
  '[contenteditable="true"]',
  '[data-dsh-no-drag]'
].join(',')

export const MACOS_DRAG_STRIP_HEIGHT = 24
export const MACOS_TRAFFIC_LIGHT_INSET = 80
export const MACOS_HEADER_PADDING_TOP = 28
export const MACOS_DRAG_CONTROL_GAP = 8

export interface MacosDragRegionRect {
  top: number
  right: number
  bottom: number
  left: number
}

export function macosDragRegionInsets(options: {
  viewportWidth: number
  controls: readonly MacosDragRegionRect[]
}): { left: number; right: number; height: number } {
  const left = MACOS_TRAFFIC_LIGHT_INSET
  let right = 0
  for (const control of options.controls) {
    if (control.bottom <= 0 || control.top >= MACOS_DRAG_STRIP_HEIGHT) continue
    if (control.right <= left || control.left >= options.viewportWidth) continue
    right = Math.max(right, options.viewportWidth - control.left + MACOS_DRAG_CONTROL_GAP)
  }
  return {
    left,
    right: Math.min(right, Math.max(0, options.viewportWidth - left)),
    height: MACOS_DRAG_STRIP_HEIGHT
  }
}

interface MacosTitlebarMutationNode {
  nodeType: number
  id?: string
  closest?: (selector: string) => unknown
  matches?: (selector: string) => boolean
  querySelector?: (selector: string) => unknown
}

export function macosTitlebarMutationRelevant(mutation: {
  target: MacosTitlebarMutationNode
  addedNodes: ArrayLike<MacosTitlebarMutationNode>
  removedNodes: ArrayLike<MacosTitlebarMutationNode>
}): boolean {
  if (elementTouchesHeader(mutation.target)) return true
  for (let index = 0; index < mutation.addedNodes.length; index += 1) {
    if (elementTouchesHeader(mutation.addedNodes[index])) return true
  }
  for (let index = 0; index < mutation.removedNodes.length; index += 1) {
    if (elementTouchesHeader(mutation.removedNodes[index])) return true
  }
  return false
}

export function mountMacosTitlebarLayout(document: Document): void {
  if (!document.body) return

  installLayout(document)
  installDragRegion(document)
}

function elementTouchesHeader(node: MacosTitlebarMutationNode | null | undefined): boolean {
  if (!node || node.nodeType !== 1 || node.id === DRAG_REGION_ID) return false
  return Boolean(
    node.closest?.(HEADER_SLOT) ||
      node.matches?.(HEADER_SLOT) ||
      node.querySelector?.(HEADER_SLOT)
  )
}

function installLayout(document: Document): void {
  document.body.classList.add('dsh-desktop-macos-titlebar-layout')
  if (document.getElementById(LAYOUT_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = LAYOUT_STYLE_ID
  style.textContent = `
    body.dsh-desktop-macos-titlebar-layout header${HEADER_SLOT},
    body.dsh-desktop-macos-titlebar-layout ${HEADER_SLOT} > header {
      box-sizing: border-box !important;
      padding-top: ${MACOS_HEADER_PADDING_TOP}px !important;
      -webkit-app-region: drag;
    }
    body.dsh-desktop-macos-titlebar-layout button,
    body.dsh-desktop-macos-titlebar-layout a,
    body.dsh-desktop-macos-titlebar-layout input,
    body.dsh-desktop-macos-titlebar-layout select,
    body.dsh-desktop-macos-titlebar-layout textarea,
    body.dsh-desktop-macos-titlebar-layout [role="button"],
    body.dsh-desktop-macos-titlebar-layout [role="tab"],
    body.dsh-desktop-macos-titlebar-layout summary,
    body.dsh-desktop-macos-titlebar-layout [contenteditable="true"],
    body.dsh-desktop-macos-titlebar-layout [data-dsh-no-drag] {
      -webkit-app-region: no-drag !important;
    }
  `
  document.head.appendChild(style)
}

function installDragRegion(document: Document): void {
  const view = document.defaultView
  if (!view) return

  let dragRegion = document.getElementById(DRAG_REGION_ID)
  if (!dragRegion) {
    dragRegion = document.createElement('div')
    dragRegion.id = DRAG_REGION_ID
    dragRegion.setAttribute('aria-hidden', 'true')
    document.body.appendChild(dragRegion)
  }
  if (!(dragRegion instanceof HTMLElement)) return
  if (dragRegion.dataset.dshDesktopDragMounted === 'true') {
    applyDragRegionBounds(document, dragRegion)
    return
  }

  Object.assign(dragRegion.style, {
    position: 'fixed',
    zIndex: '8',
    top: '0',
    height: `${MACOS_DRAG_STRIP_HEIGHT}px`,
    background: 'transparent',
    pointerEvents: 'auto',
    userSelect: 'none'
  })
  dragRegion.style.setProperty('-webkit-app-region', 'drag')
  dragRegion.dataset.dshDesktopDragMounted = 'true'

  const region = dragRegion
  let frame = 0
  const schedule = (): void => {
    if (frame !== 0) return
    frame = view.requestAnimationFrame(() => {
      frame = 0
      if (!region.isConnected) return
      applyDragRegionBounds(document, region)
    })
  }

  applyDragRegionBounds(document, region)
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => macosTitlebarMutationRelevant(mutation))) return
    schedule()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  view.addEventListener('resize', schedule)
}

function applyDragRegionBounds(document: Document, dragRegion: HTMLElement): void {
  const view = document.defaultView
  if (!view) return

  const controls: MacosDragRegionRect[] = []
  const header = document.querySelector(HEADER_SLOT)
  const scope = header ?? document
  for (const node of scope.querySelectorAll(NO_DRAG_SELECTOR)) {
    if (!(node instanceof HTMLElement) || dragRegion.contains(node)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || rect.top >= MACOS_DRAG_STRIP_HEIGHT) continue
    controls.push({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    })
  }

  const insets = macosDragRegionInsets({
    viewportWidth: view.innerWidth,
    controls
  })
  dragRegion.style.left = `${insets.left}px`
  dragRegion.style.right = `${insets.right}px`
}
