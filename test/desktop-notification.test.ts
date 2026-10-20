import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDesktopNotificationBridge } from '../src/main/desktop-notification'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value: unknown) => void>(),
  notifications: [] as Array<{
    options: { title: string; body?: string; silent?: boolean; icon?: string }
    show: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    emit: (name: string) => void
  }>,
  supported: vi.fn(() => true)
}))
vi.mock('electron', () => ({
  app: { focus: vi.fn() },
  ipcMain: {
    on: vi.fn((channel: string, listener: (event: unknown, value: unknown) => void) => mocks.handlers.set(channel, listener)),
    removeListener: vi.fn((channel: string) => mocks.handlers.delete(channel))
  },
  Notification: class {
    static isSupported = mocks.supported
    listeners = new Map<string, () => void>()
    show = vi.fn()
    close = vi.fn(() => this.emit('close'))
    constructor(public options: { title: string; body?: string; silent?: boolean; icon?: string }) {
      mocks.notifications.push(this)
    }
    on(name: string, listener: () => void): this { this.listeners.set(name, listener); return this }
    emit(name: string): void { this.listeners.get(name)?.() }
  }
}))

function fixture() {
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: vi.fn(() => false), send: vi.fn() })
  const window = { webContents: sender, isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true),
    restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  const event = { sender, senderFrame: sender.mainFrame }
  // This is the test's Electron boundary; native objects are exercised by the runtime smoke.
  const dispose = registerDesktopNotificationBridge(() => window as unknown as BrowserWindow, () => '')
  const show = (id = 1) => mocks.handlers.get('dsh:notification-show')?.(event,
    { id, title: 'Agent finished', options: { body: 'Done', silent: true } })
  return { sender, window, event, dispose, show }
}
let cleanup: (() => void) | undefined
beforeEach(() => { mocks.handlers.clear(); mocks.notifications.length = 0; mocks.supported.mockReturnValue(true) })
afterEach(() => { cleanup?.(); cleanup = undefined })

describe('desktop notification ownership', () => {
  it('shows a notification and focuses its host only after a click', () => {
    const f = fixture(); cleanup = f.dispose
    f.show()
    expect(mocks.notifications[0]?.options).toMatchObject({ title: 'Agent finished', body: 'Done', silent: true })
    expect(mocks.notifications[0]?.show).toHaveBeenCalledOnce()
    expect(f.window.focus).not.toHaveBeenCalled()
    mocks.notifications[0]?.emit('show')
    expect(f.sender.send).toHaveBeenCalledWith('dsh:notification-shown', 1)
    mocks.notifications[0]?.emit('click')
    expect(f.window.restore).toHaveBeenCalledOnce()
    expect(f.window.focus).toHaveBeenCalledOnce()
    expect(f.sender.send).toHaveBeenCalledWith('dsh:notification-clicked', 1)
  })
  it('rejects another renderer and a subframe for both show and close', () => {
    const f = fixture(); cleanup = f.dispose
    const show = mocks.handlers.get('dsh:notification-show')
    show?.({ ...f.event, sender: {} }, { id: 1, title: 'Untrusted' })
    show?.({ ...f.event, senderFrame: {} }, { id: 1, title: 'Subframe' })
    expect(mocks.notifications).toHaveLength(0)
    f.show()
    mocks.handlers.get('dsh:notification-close')?.({ ...f.event, senderFrame: {} }, 1)
    expect(mocks.notifications[0]?.close).not.toHaveBeenCalled()
    mocks.handlers.get('dsh:notification-close')?.(f.event, 1)
    expect(f.sender.send).toHaveBeenCalledWith('dsh:notification-closed', 1)
  })
  it('rejects malformed notification identities', () => {
    const f = fixture(); cleanup = f.dispose
    for (const id of [NaN, Infinity, -1, 0, 1.5, '1']) {
      mocks.handlers.get('dsh:notification-show')?.(f.event, { id, title: 'Invalid' })
    }
    expect(mocks.notifications).toHaveLength(0)
  })
  it('replaces reused identities without letting old callbacks close the replacement', () => {
    const f = fixture(); cleanup = f.dispose
    f.show(); f.show()
    expect(mocks.notifications[0]?.close).toHaveBeenCalledOnce()
    mocks.notifications[0]?.emit('click')
    mocks.notifications[0]?.emit('close')
    expect(f.sender.send).not.toHaveBeenCalled()
    mocks.notifications[1]?.emit('click')
    expect(f.sender.send).toHaveBeenCalledWith('dsh:notification-clicked', 1)
  })
  it('clears notifications on main-frame navigation and ignores callbacks from the old document', () => {
    const f = fixture(); cleanup = f.dispose
    f.show()
    f.sender.emit('did-start-navigation', {}, 'http://localhost', false, true)
    expect(mocks.notifications[0]?.close).toHaveBeenCalledOnce()
    mocks.notifications[0]?.emit('click')
    expect(f.window.focus).not.toHaveBeenCalled()
    expect(f.sender.send).not.toHaveBeenCalled()
  })
  it('cleans up when the renderer is destroyed and disposes idempotently', () => {
    const f = fixture(); cleanup = f.dispose
    f.show(); f.sender.emit('destroyed'); f.dispose(); f.dispose()
    expect(mocks.notifications[0]?.close).toHaveBeenCalledOnce()
    expect(mocks.handlers.size).toBe(0)
    expect(f.sender.listenerCount('did-start-navigation')).toBe(0)
  })
  it('keeps notifications during same-document session navigation', () => {
    const f = fixture(); cleanup = f.dispose
    f.show()
    f.sender.emit('did-start-navigation', {}, 'http://localhost/#session', true, true)
    expect(mocks.notifications[0]?.close).not.toHaveBeenCalled()
    mocks.notifications[0]?.emit('click')
    expect(f.window.focus).toHaveBeenCalledOnce()
  })
  it('reports native delivery failure and releases the notification', () => {
    const f = fixture(); cleanup = f.dispose
    f.show(); mocks.notifications[0]?.emit('failed')
    expect(f.sender.send).toHaveBeenCalledWith('dsh:notification-error', 1)
    mocks.notifications[0]?.emit('click')
    expect(f.window.focus).not.toHaveBeenCalled()
    mocks.supported.mockReturnValue(false)
    f.show(2)
    expect(f.sender.send).toHaveBeenCalledWith('dsh:notification-error', 2)
    expect(mocks.notifications).toHaveLength(1)
  })
  it('re-registering the bridge disposes the old owner', () => {
    const first = fixture()
    first.show()
    const second = fixture(); cleanup = second.dispose
    expect(mocks.notifications[0]?.close).toHaveBeenCalledOnce()
    second.show()
    first.dispose()
    expect(mocks.handlers.size).toBe(2)
  })
})
