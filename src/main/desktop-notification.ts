import { app, BrowserWindow, ipcMain, Notification, type IpcMainEvent } from 'electron'
import { existsSync } from 'node:fs'

let disposeActiveBridge: (() => void) | undefined

export interface DesktopNotificationPayload {
  id: number
  title: string
  options?: {
    body?: string
    icon?: string
    tag?: string
    silent?: boolean
  }
}

export function registerDesktopNotificationBridge(
  getMainWindow: () => BrowserWindow | undefined,
  getIconPath: () => string
): () => void {
  disposeActiveBridge?.()
  const activeNotifications = new Map<number, Notification>()
  let owner: IpcMainEvent['sender'] | undefined
  let disposed = false

  const trusted = (event: IpcMainEvent): boolean => {
    const window = getMainWindow()
    return !disposed && Boolean(window && !window.isDestroyed() &&
      event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame)
  }
  const clearNotifications = (): void => {
    const notifications = [...activeNotifications.values()]
    activeNotifications.clear()
    for (const notification of notifications) notification.close()
  }
  const navigationStarted = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
    if (mainFrame && !inPlace) clearNotifications()
  }
  const unbindOwner = (): void => {
    owner?.removeListener('destroyed', clearNotifications)
    owner?.removeListener('did-start-navigation', navigationStarted)
    owner = undefined
  }

  const handleShow = (event: IpcMainEvent, payload: unknown): void => {
    if (!trusted(event)) return
    if (!payload || typeof payload !== 'object') return
    const { id, title, options } = payload as Partial<DesktopNotificationPayload>
    if (!Number.isSafeInteger(id) || typeof id !== 'number' || id < 1 ||
      typeof title !== 'string' || title.length > 256) return

    const opts = options && typeof options === 'object' ? options : {}
    const body = typeof opts.body === 'string' ? opts.body.slice(0, 4096) : undefined
    const silent = typeof opts.silent === 'boolean' ? opts.silent : false

    if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) {
      event.sender.send('dsh:notification-error', id)
      return
    }

    if (owner !== event.sender) {
      clearNotifications()
      unbindOwner()
      owner = event.sender
      owner.on('destroyed', clearNotifications)
      owner.on('did-start-navigation', navigationStarted)
    }
    const frame = event.senderFrame
    const reply = (channel: string): void => {
      if (trusted(event) && event.sender.mainFrame === frame && !event.sender.isDestroyed()) {
        event.sender.send(channel, id)
      }
    }
    const previous = activeNotifications.get(id)
    activeNotifications.delete(id)
    previous?.close()

    const iconPath = getIconPath()
    let notification: Notification
    try {
      notification = new Notification({
        title,
        body,
        silent,
        icon: iconPath && existsSync(iconPath) ? iconPath : undefined
      })
    } catch (error) {
      console.warn('[desktop-notification] creation failed', error instanceof Error ? error.name : 'Unknown error')
      reply('dsh:notification-error')
      return
    }

    activeNotifications.set(id, notification)
    notification.on('show', () => {
      if (activeNotifications.get(id) === notification) reply('dsh:notification-shown')
    })

    notification.on('click', () => {
      if (activeNotifications.get(id) !== notification || !trusted(event)) return
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
      if (process.platform === 'darwin') {
        app.focus({ steal: true })
      }
      reply('dsh:notification-clicked')
    })

    notification.on('close', () => {
      if (activeNotifications.get(id) !== notification) return
      activeNotifications.delete(id)
      reply('dsh:notification-closed')
    })
    notification.on('failed', () => {
      if (activeNotifications.get(id) !== notification) return
      activeNotifications.delete(id)
      reply('dsh:notification-error')
    })

    try {
      notification.show()
    } catch (error) {
      activeNotifications.delete(id)
      notification.close()
      console.warn('[desktop-notification] show failed', error instanceof Error ? error.name : 'Unknown error')
      reply('dsh:notification-error')
    }
  }

  const handleClose = (event: IpcMainEvent, id: unknown): void => {
    if (!trusted(event)) return
    if (typeof id !== 'number') return
    const notification = activeNotifications.get(id)
    if (notification) {
      notification.close()
    }
  }

  ipcMain.on('dsh:notification-show', handleShow)
  ipcMain.on('dsh:notification-close', handleClose)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    ipcMain.removeListener('dsh:notification-show', handleShow)
    ipcMain.removeListener('dsh:notification-close', handleClose)
    clearNotifications()
    unbindOwner()
    if (disposeActiveBridge === dispose) disposeActiveBridge = undefined
  }
  disposeActiveBridge = dispose
  return dispose
}
