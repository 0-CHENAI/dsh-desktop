// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../src/shared/contracts'
import { isUpdateDismissed, shouldShowUpdate, updateHeadline } from '../src/preload/update-view'

it('keeps the spinner, badge and buttons mounted across progress updates', () => {
  const source = readFileSync('src/preload/index.ts', 'utf8')
  const functions = source.slice(source.indexOf('function applyStatus('), source.indexOf('\n/**', source.indexOf('function render():')))
  const host = document.createElement('div')
  const content = document.createElement('div')
  host.append(content)
  const element = (tag: string, className: string) => {
    const node = document.createElement(tag)
    node.className = className
    return node
  }
  const context = {
    host, content, currentStatus: undefined, locale: 'zh',
    dismissedVersion: null as string | null, dismissedTransientPhase: null, installing: false,
    accepting: false, installingVersion: null,
    isUpdateDismissed, shouldShowUpdate, updateHeadline,
    isBusy: () => true, element, button: (text: string, cls: string) => {
      const node = element('button', cls)
      node.textContent = text
      return node
    },
    skipButton: () => element('button', 'secondary'),
    dismissCurrent: vi.fn(), updateIcon: '', ipcRenderer: { invoke: vi.fn() },
    apply: undefined as ((status: UpdateStatus) => void) | undefined
  }
  runInNewContext(ts.transpile(functions) + '\nthis.apply = applyStatus', context)
  const apply = context.apply!
  const state: UpdateStatus = { phase: 'downloading', availableVersion: '1.1.0', currentVersion: '1.0.0', manual: false, percent: 1 }
  apply(state)
  const selectors = ['.card', '.badge', '.spinner', '.secondary', '.close']
  const nodes = selectors.map(s => content.querySelector(s))
  for (const percent of [12.5, 42, 72, 100]) {
    apply({ ...state, percent })
    expect(content.querySelector('.description')?.textContent).toBe('v1.1.0 · ' + Math.round(percent) + '%')
    expect(content.querySelector('.progress')?.getAttribute('aria-valuenow')).toBe(String(Math.round(percent)))
    expect((content.querySelector('.progressValue') as HTMLElement).style.width).toBe(percent + '%')
    selectors.forEach((s, i) => expect(content.querySelector(s)).toBe(nodes[i]))
  }
  apply({ ...state, availableVersion: '1.2.0' })
  expect(content.querySelector('.card')).not.toBe(nodes[0])
  expect(content.querySelector('.description')?.textContent).toBe('v1.2.0 · 1%')
  context.dismissedVersion = '1.2.0'
  apply({ ...state, availableVersion: '1.2.0', percent: 40 })
  expect(host.style.display).toBe('none')
  expect(content.childElementCount).toBe(0)
  context.dismissedVersion = null
  apply({ ...state, phase: 'downloaded', installing: true })
  expect(content.querySelector('.title')?.textContent).toBe('正在重启…')
  expect(content.querySelector('.secondary')).toBeNull()
  expect((content.querySelector('.close') as HTMLButtonElement).disabled).toBe(true)
})
