import type { IpcRendererEvent } from 'electron'
import { DESKTOP_IPC } from '../main/shell/window/ipc'

/** Keep Harness's existing fullscreen seam in sync without exposing an IPC bridge. */
export function mountWindowFullscreen(document: Document, ipc: {
  invoke(channel: string): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, value: unknown) => void): unknown
  removeListener(channel: string, listener: (event: IpcRendererEvent, value: unknown) => void): unknown
}): () => void {
  let disposed = false
  let received = false
  let fullscreen = false
  const render = (): void => { document.documentElement?.toggleAttribute('data-fullscreen', fullscreen) }
  const update = (_event: IpcRendererEvent, value: unknown): void => {
    if (typeof value !== 'boolean' || disposed) return
    received = true
    fullscreen = value
    render()
  }
  ipc.on(DESKTOP_IPC.windowFullscreen, update)
  document.addEventListener('DOMContentLoaded', render, { once: true })
  void ipc.invoke(DESKTOP_IPC.windowFullscreen).then((value: unknown) => {
    // A fullscreen event can arrive before the initial request completes.
    if (!received && !disposed && typeof value === 'boolean') { fullscreen = value; render() }
  }).catch((error: unknown) => { if (!disposed) console.warn('[desktop-window] unable to read fullscreen state', error) })
  const dispose = (): void => {
    disposed = true
    ipc.removeListener(DESKTOP_IPC.windowFullscreen, update)
    document.removeEventListener('DOMContentLoaded', render)
    document.defaultView?.removeEventListener('unload', dispose)
  }
  document.defaultView?.addEventListener('unload', dispose, { once: true })
  return dispose
}
