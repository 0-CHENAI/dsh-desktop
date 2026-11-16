import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MACOS_DRAG_CONTROL_GAP,
  MACOS_DRAG_STRIP_HEIGHT,
  MACOS_HEADER_PADDING_TOP,
  MACOS_TRAFFIC_LIGHT_INSET,
  macosDragRegionInsets,
  macosTitlebarMutationRelevant
} from '../src/preload/macos-titlebar'

const projectRoot = path.resolve(import.meta.dirname, '..')

function elementStub(options: {
  id?: string
  closest?: string | null
  matches?: boolean
  containsHeader?: boolean
}) {
  return {
    nodeType: 1,
    id: options.id ?? '',
    closest: (selector: string) =>
      selector === '[data-slot="conversation.session.header"]' && options.closest ? { id: 'header' } : null,
    matches: () => options.matches === true,
    querySelector: () => (options.containsHeader ? { id: 'header' } : null)
  }
}

describe('macOS titlebar drag layout', () => {
  it('uses the native macOS caption and leaves the legacy preload drag strip unmounted', async () => {
    const { desktopWindowChrome } = await import('../src/main/shell/window-chrome')
    expect(desktopWindowChrome('darwin')).toMatchObject({
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }
    })
    const preload = await readFile(path.join(projectRoot, 'src/preload/app.ts'), 'utf8')
    expect(preload).not.toContain('mountMacosWindowChrome')
    expect(preload).toContain('markDesktopPlatform(document, process.platform)')
  })

  it('keeps the drag handler clear of traffic lights and header controls', () => {
    expect(
      macosDragRegionInsets({
        viewportWidth: 1380,
        controls: []
      })
    ).toEqual({ left: 80, right: 0, height: 24 })

    expect(
      macosDragRegionInsets({
        viewportWidth: 1380,
        controls: [{ top: 4, right: 1360, bottom: 32, left: 1160 }]
      })
    ).toEqual({
      left: 80,
      right: 1380 - 1160 + MACOS_DRAG_CONTROL_GAP,
      height: 24
    })

    expect(
      macosDragRegionInsets({
        viewportWidth: 1380,
        controls: [{ top: 28, right: 1360, bottom: 56, left: 1160 }]
      })
    ).toEqual({ left: 80, right: 0, height: 24 })
  })

  it('ignores conversation body mutations so chat updates do not relayout the drag strip', () => {
    expect(
      macosTitlebarMutationRelevant({
        target: elementStub({}),
        addedNodes: [elementStub({ containsHeader: true })],
        removedNodes: []
      })
    ).toBe(true)

    expect(
      macosTitlebarMutationRelevant({
        target: elementStub({ closest: '[data-slot="conversation.session.header"]' }),
        addedNodes: [],
        removedNodes: []
      })
    ).toBe(true)

    expect(
      macosTitlebarMutationRelevant({
        target: elementStub({}),
        addedNodes: [elementStub({})],
        removedNodes: []
      })
    ).toBe(false)
  })
})
