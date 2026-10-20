// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { setupDesktopNotificationBridge } from '../src/preload/desktop-notification'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, id: number) => void>(),
  send: vi.fn()
}))
vi.mock('electron', () => ({ ipcRenderer: {
  on: (channel: string, listener: (event: unknown, id: number) => void) => ipc.handlers.set(channel, listener),
  send: ipc.send
} }))
const originalNotification = window.Notification
afterEach(() => {
  window.Notification = originalNotification
  Reflect.deleteProperty(window, '__DSH_DESKTOP_NOTIFICATION_INSTALLED__')
  vi.restoreAllMocks()
})

it('reports native show/close/failure through the real injected Notification adapter', async () => {
  // JSDOM does not execute appended scripts by default. Execute the exact
  // injected source as the page would, while keeping the IPC boundary observable.
  const append = document.documentElement.appendChild
  vi.spyOn(document.documentElement, 'appendChild').mockImplementation(function <T extends Node>(node: T): T {
    const result = append.call(document.documentElement, node) as T
    if (node instanceof HTMLScriptElement) window.eval(node.textContent || '')
    return result
  })
  setupDesktopNotificationBridge()
  const notification = new window.Notification('Task completed')
  const shown = vi.fn(), closed = vi.fn()
  notification.onshow = shown
  notification.onclose = closed
  await Promise.resolve()
  expect(shown).not.toHaveBeenCalled()
  ipc.handlers.get('dsh:notification-shown')?.({}, 1)
  expect(shown).toHaveBeenCalledOnce()
  notification.close()
  expect(ipc.send).toHaveBeenCalledWith('dsh:notification-close', 1)
  ipc.handlers.get('dsh:notification-closed')?.({}, 1)
  expect(closed).toHaveBeenCalledOnce()
  ipc.handlers.get('dsh:notification-closed')?.({}, 1)
  expect(closed).toHaveBeenCalledOnce()
  const failed = new window.Notification('Unavailable')
  const error = vi.fn()
  failed.onerror = error
  ipc.handlers.get('dsh:notification-error')?.({}, 2)
  expect(error).toHaveBeenCalledOnce()
})
