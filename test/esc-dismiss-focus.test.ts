import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { patchPath, projectRoot } from './patch-path'

const settingsGeneral = path.join(
  projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-settings-general',
  'lib',
  'client.js'
)

describe('Esc dismiss does not leave a focus ring', () => {
  it('stops the settings shell from focusing the trigger when the panel closes', async () => {
    const [patch, installed] = await Promise.all([
      readFile(patchPath('@deepseek-ai/dsh-client-ui-settings-general'), 'utf8'),
      readFile(settingsGeneral, 'utf8')
    ])

    expect(patch).toContain('triggerButton.current?.focus()')
    expect(installed).not.toContain('triggerButton.current?.focus()')
    expect(installed).not.toContain('const triggerButton = (0, react.useRef)(null)')
    expect(installed).toContain('"aria-haspopup": "dialog"')
    expect(installed).toContain('if (e.key === "Escape") onClose()')
  })

  it('blurs leftover focus after Escape closes any remaining dialog', async () => {
    const preload = await readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8')

    expect(preload).toContain('function overlayStillOpen()')
    expect(preload).toContain("document.querySelector('[role=\"dialog\"], [aria-modal=\"true\"]')")
    expect(preload).toContain('function blurFocusAfterEscapeDismiss()')
    expect(preload).toContain("if (event.key !== 'Escape') return")
    expect(preload).toContain('active.blur()')
    expect(preload).toContain('blurFocusAfterEscapeDismiss()')
  })
})
