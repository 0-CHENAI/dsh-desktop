// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { mountWindowFullscreen } from '../src/preload/window-fullscreen'
import type { IpcRendererEvent } from 'electron'

it('follows window events, ignores an older initial response and releases listeners', async () => {
  let listener: ((event: IpcRendererEvent, value: unknown) => void) | undefined
  let resolve: ((value: unknown) => void) | undefined
  const ipc = {
    invoke: vi.fn(() => new Promise<unknown>(done => { resolve = done })),
    on: vi.fn((_name: string, handle: (event: IpcRendererEvent, value: unknown) => void) => { listener = handle; return ipc }),
    removeListener: vi.fn(() => ipc)
  }
  const dispose = mountWindowFullscreen(document, ipc)
  // The callback never reads the event: only the boolean from the owned window.
  listener?.({} as IpcRendererEvent, true)
  expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(true)
  resolve?.(false)
  await Promise.resolve()
  expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(true)
  listener?.({} as IpcRendererEvent, 'false')
  expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(true)
  listener?.({} as IpcRendererEvent, false)
  expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false)
  dispose()
  listener?.({} as IpcRendererEvent, true)
  expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false)
  expect(ipc.removeListener).toHaveBeenCalledOnce()
})
