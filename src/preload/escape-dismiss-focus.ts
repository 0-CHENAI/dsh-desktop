/** Clear only focus left behind by an Escape dismissal; keep active dialogs usable. */
export function mountEscapeDismissFocus(document: Document, desktopOverlayOpen: () => boolean): () => void {
  const view = document.defaultView
  if (view === null) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const overlayOpen = (): boolean => desktopOverlayOpen() || document.querySelector('[role="dialog"], [aria-modal="true"]') !== null
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !overlayOpen()) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (overlayOpen()) return
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) active.blur()
    }, 0)
  }
  const dispose = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    view.removeEventListener('keydown', keydown, true)
    view.removeEventListener('unload', dispose)
  }
  view.addEventListener('keydown', keydown, true)
  view.addEventListener('unload', dispose, { once: true })
  return dispose
}
