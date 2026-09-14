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
  it('moves header actions below a transparent drag strip instead of covering them', async () => {
    const [main, preload, index] = await Promise.all([
      readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src', 'preload', 'macos-titlebar.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8')
    ])

    expect(MACOS_DRAG_STRIP_HEIGHT).toBe(24)
    expect(MACOS_TRAFFIC_LIGHT_INSET).toBe(80)
    expect(MACOS_HEADER_PADDING_TOP).toBe(28)
    expect(MACOS_HEADER_PADDING_TOP).toBeGreaterThan(MACOS_DRAG_STRIP_HEIGHT)

    expect(index).toContain('mountMacosTitlebarLayout(document)')
    expect(main).not.toContain('dsh-desktop-drag-region')
    expect(preload).toContain("const DRAG_REGION_ID = 'dsh-desktop-drag-region'")
    expect(preload).toContain('dragRegion.id = DRAG_REGION_ID')
    expect(preload).toContain("dragRegion.style.setProperty('-webkit-app-region', 'drag')")
    expect(preload).toContain('padding-top: ${MACOS_HEADER_PADDING_TOP}px !important')
    expect(preload).toContain('-webkit-app-region: drag')
    expect(preload).toContain('-webkit-app-region: no-drag !important')
    expect(preload).toContain('${HEADER_SLOT} > header')
    expect(preload).toContain('[data-slot="conversation.session.header"]')
    expect(preload).not.toContain('[data-dsh-sidebar-root]')
    expect(preload).not.toContain("right: '220px'")
    expect(preload).not.toContain("zIndex: '18'")
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
