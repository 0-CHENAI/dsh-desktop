// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../src/shared/contracts'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, status: UpdateStatus) => void>(),
  invoke: vi.fn(async () => ({ phase: 'idle', currentVersion: '1.0.0', manual: false }))
}))
vi.mock('electron', () => ({ ipcRenderer: {
  on: (channel: string, listener: (event: unknown, status: UpdateStatus) => void) => ipc.handlers.set(channel, listener),
  removeListener: (channel: string) => ipc.handlers.delete(channel),
  invoke: ipc.invoke
} }))
afterEach(() => {
  window.dispatchEvent(new Event('unload'))
  vi.restoreAllMocks()
  document.getElementById('dsh-desktop-update-root')?.remove()
  document.getElementById('dsh-desktop-about-root')?.remove()
})

it('keeps actual update controls mounted across progress and blocks dismissal during installation', async () => {
  vi.resetModules()
  const roots = new Map<Element, ShadowRoot>()
  const original = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const shadow = original.call(this, init)
    roots.set(this, shadow)
    return shadow
  })
  const { mountDesktopUpdateUi } = await import('../src/preload/desktop-update-ui')
  mountDesktopUpdateUi()
  await Promise.resolve()
  const host = document.getElementById('dsh-desktop-update-root')
  if (!host) throw new Error('Update UI was not mounted')
  const content = roots.get(host)
  if (!content) throw new Error('Update UI shadow was not mounted')
  const apply = (status: UpdateStatus) => ipc.handlers.get('updates:status-changed')?.({}, status)
  const state: UpdateStatus = { phase: 'downloading', availableVersion: '1.1.0', currentVersion: '1.0.0', manual: false, percent: 1, locale: 'zh' }
  apply(state)
  const selectors = ['.card', '.app-icon', '.secondary']
  const nodes = selectors.map(selector => content.querySelector(selector))
  for (const node of nodes) expect(node).not.toBeNull()
  for (const percent of [12.5, 42, 72, 100]) {
    apply({ ...state, percent })
    expect(content.querySelector('.description')?.textContent).toBe('v1.1.0 · ' + Math.round(percent) + '%')
    expect(content.querySelector('.progress')?.getAttribute('aria-valuenow')).toBe(String(Math.round(percent)))
    expect(content.querySelector<HTMLElement>('.progressValue')?.style.width).toBe(percent + '%')
    selectors.forEach((selector, index) => expect(content.querySelector(selector)).toBe(nodes[index]))
  }
  apply({ ...state, availableVersion: '1.2.0' })
  expect(content.querySelector('.card')).not.toBe(nodes[0])
  content.querySelector<HTMLButtonElement>('.secondary')?.click()
  expect(host.style.display).toBe('none')
  expect(content.querySelector('.card')).toBeNull()
  apply({ ...state, phase: 'downloaded', installing: true })
  expect(content.querySelector('.title')?.textContent).toBe('正在重启…')
  expect(content.querySelector('.secondary')).toBeNull()
  expect(content.querySelector<HTMLButtonElement>('.primary')?.disabled).toBe(true)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(host.style.display).toBe('block')
})
