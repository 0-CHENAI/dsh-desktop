// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'
import { expect, it, vi } from 'vitest'

it('portals the installed model tooltip out of clipped rows and cleans it on scroll and unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const source = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js', 'utf8')
    .replace('exports.apply = apply;', 'exports.toggle = ModelImageInputToggle; exports.apply = apply;')
  let Toggle
  const vendors = { react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': jsxRuntime,
    '@deepseek-ai/dsh-client-ui-primitives': {}, '@deepseek-ai/dsh-client-store': {} }
  const previousLoader = window.__ModuleLoader__
  window.__ModuleLoader__ = { load({ factory }) {
    Toggle = factory(name => vendors[name]).toggle
  } }
  try { new Function('window', source)(window) }
  finally { window.__ModuleLoader__ = previousLoader }
  const row = document.createElement('div')
  row.style.overflow = 'hidden'
  document.body.append(row)
  const root = createRoot(row)
  try {
    await React.act(async () => { root.render(React.createElement(Toggle, { compact: true, index: 0,
      field: 'input', model: { input: ['text'] }, t: key => key, onChange() {} })) })
    await React.act(async () => { row.querySelector('label').dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })
    expect(document.querySelector('[role=tooltip]')?.parentElement).toBe(document.body)
    expect(row.querySelector('[role=tooltip]')).toBeNull()
    expect(row.querySelector('input').getAttribute('aria-describedby')).toBe(document.querySelector('[role=tooltip]').id)
    await React.act(async () => { window.dispatchEvent(new Event('scroll')) })
    expect(document.querySelector('[role=tooltip]')).toBeNull()
  } finally {
    await React.act(async () => { root.unmount() })
    row.remove()
    vi.unstubAllGlobals()
  }
  expect(document.querySelector('[role=tooltip]')).toBeNull()
})
