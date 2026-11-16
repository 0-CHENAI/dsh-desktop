// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const source = readFileSync('node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js', 'utf8')
const functions = ['configuredReasoningEfforts', 'parseEffortList', 'reasoningEffortIds',
  'nextReasoningEfforts', 'ModelReasoningEffortsField'].map(name => {
  const found = source.match(new RegExp(`function ${name}\\([^]*?\\n\\t\\t\\}`))
  if (!found) throw new Error(`Installed model settings component is missing ${name}`)
  return found[0]
}).join('\n')
const Field = new Function('react', 'react_jsx_runtime', 'ModelsSection_module_css_default',
  `${functions}; return ModelReasoningEffortsField`)(React, jsxRuntime, {})
let root, host

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  root = undefined
})

async function edit(model, text) {
  const writes = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(React.createElement(Field,
    { model, index: 0, t: key => key, onChange: value => writes.push(value) })))
  const input = host.querySelector('input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(input.value).toBe(text)
  return writes
}

it('writes an omitted off wire value from the actual rendered model editor', async () => {
  expect(await edit({}, 'off, high, max')).toEqual([{ off: null, high: 'high', max: 'max' }])
})

it('retains an explicit provider alias while editing the rendered field', async () => {
  expect(await edit({ reasoningEfforts: { off: 'none', high: 'high' } }, 'off, high, max'))
    .toEqual([{ off: 'none', high: 'high', max: 'max' }])
})

it('clears the declaration instead of inventing a new default on empty input', async () => {
  expect(await edit({ reasoningEfforts: { off: null, high: 'high' } }, '')).toEqual([undefined])
})
