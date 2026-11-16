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

    expect(patch).toContain('diff --git')
    expect(installed).not.toContain('triggerButton.current?.focus()')
    expect(installed).not.toContain('const triggerButton = (0, react.useRef)(null)')
    expect(installed).toContain('"aria-haspopup": "dialog"')
    expect(installed).toContain('useModalLayer)(panel, true, onClose)')
  })

  it('mounts the shared Escape handler in the current shipped preload', async () => {
    const preload = await readFile(path.join(projectRoot, 'src/preload/app.ts'), 'utf8')
    expect(preload).toContain('mountEscapeDismissFocus(document, desktopUpdateOverlayOpen)')
    const handler = await readFile(path.join(projectRoot, 'src/preload/escape-dismiss-focus.ts'), 'utf8')
    expect(handler).toContain('active.blur()')
    expect(handler).toContain("event.key !== 'Escape'")
  })
})
