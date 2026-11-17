// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mountEscapeDismissFocus } from '../src/preload/escape-dismiss-focus'

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren() })

it('clears leftover focus only when the Escape request really dismissed the dialog', () => {
  vi.useFakeTimers()
  const button = document.createElement('button')
  const dialog = document.createElement('section')
  dialog.setAttribute('role', 'dialog')
  document.body.append(button, dialog)
  button.focus()
  const dispose = mountEscapeDismissFocus(document, () => false)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  vi.runAllTimers()
  expect(document.activeElement).toBe(button)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  dialog.remove()
  vi.runAllTimers()
  expect(document.activeElement).toBe(document.body)
  dispose()
})

it('does not clear composer focus without a dialog and releases pending work on disposal', () => {
  vi.useFakeTimers()
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()
  let open = false
  const dispose = mountEscapeDismissFocus(document, () => open)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  vi.runAllTimers()
  expect(document.activeElement).toBe(input)
  open = true
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  open = false
  dispose()
  vi.runAllTimers()
  expect(document.activeElement).toBe(input)
})
