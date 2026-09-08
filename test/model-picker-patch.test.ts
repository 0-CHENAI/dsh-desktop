import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasPatch, patchPath, projectRoot } from './patch-path'

const settingsModelsClient = path.join(
  projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-settings-models',
  'lib',
  'client.js'
)

/**
 * Harness took the select-all toggle upstream in 0.1.0-rc.8, so the desktop
 * patch no longer carries it. Assert against the composed package instead: the
 * behavior still has to be there, and the patch still has to stay out of it.
 */
describe('DSH Desktop available-model picker', () => {
  it('ships one state-driven select-all toggle', async () => {
    const client = await readFile(settingsModelsClient, 'utf8')

    expect(client).toContain('const allVisibleCandidatesPicked =')
    expect(client).toContain('visibleCandidates.every((candidate) => picked.has(candidate.id))')
    expect(client).toContain(
      'children: t(allVisibleCandidatesPicked ? "fetchDeselectAll" : "fetchSelectAll")'
    )
    expect(client).toContain('const toggleVisibleCandidates =')
  })

  it('includes English and Chinese copy for both toggle states', async () => {
    const client = await readFile(settingsModelsClient, 'utf8')

    expect(client).toContain('fetchSelectAll: "Select all"')
    expect(client).toContain('fetchDeselectAll: "Deselect all"')
    expect(client).toContain('fetchSelectAll: "全选"')
    expect(client).toContain('fetchDeselectAll: "取消全选"')
  })

  it('leaves the toggle to Harness rather than re-patching it', async () => {
    expect(hasPatch('@deepseek-ai/dsh-client-ui-settings-models')).toBe(true)
    const patch = await readFile(
      patchPath('@deepseek-ai/dsh-client-ui-settings-models'),
      'utf8'
    )

    expect(patch).not.toContain('const allCandidatesPicked =')
    expect(patch).not.toContain('fetchSelectAll: "Select all"')
  })
})

describe('DSH Desktop model image-input declarations', () => {
  it('renders one shared per-model control for both adapter field names', async () => {
    const client = await readFile(settingsModelsClient, 'utf8')

    expect(client).toContain('function ModelImageInputToggle(props)')
    expect(client).toContain('field: "inputModalities"')
    expect(client).toContain('field: "input"')
    expect(client.match(/compact: true/g)).toHaveLength(2)
    expect(client).toContain('dshModelModalityToggleCompact')
    expect(client).toContain('className: "dshModelModalityTip"')
    expect(client).toContain('function placeCompactImageInputTip(node, tip)')
    expect(client).toContain('hoverRef.current = true')
    expect(client).toContain('hoverRef.current = false')
    expect(client).toContain('if (hoverRef.current !== true) hideTip()')
    expect(client).toContain('event.target.matches(":focus-visible")')
    expect(client).toContain('if (props.disabled === true) setTipBox(void 0)')
    expect(client).toContain('(0, react.useLayoutEffect)')
    expect(client).toContain('"aria-describedby": props.compact === true && tipBox !== void 0 ? tipId : void 0')
    expect(client).toContain('.qy-_KG_modelEntry,.qy-_KG_modelRow{overflow:visible}')
    expect(client).toContain(
      '.dshModelModalityTip{position:fixed;z-index:80;pointer-events:none;'
    )
    expect(client).toContain('background:var(--dsw-alias-bg-layer-1)')
    expect(client).not.toContain('data-tooltip')
    expect(client).not.toContain('.dshModelModalityToggleCompact:hover:after')
    expect(client).not.toContain('.dshModelModalityToggleCompact:focus-within:after')
    expect(client).not.toContain('content:attr(data-tooltip)')
    expect(client).toContain(
      'children: props.t(props.compact ? "modelImageInputShort" : "modelImageInput")'
    )
    expect(client).toContain('return enabled ? ["text", "image"] : ["text"]')
  })

  it('places the compact tip on the device-pixel grid and dismisses on pointer leave', async () => {
    const client = await readFile(settingsModelsClient, 'utf8')
    const source = client.match(
      /function placeCompactImageInputTip\(node, tip\) \{[\s\S]*?\n\t\t\}/
    )?.[0]

    expect(source).toBeDefined()
    expect(client).toContain('window.addEventListener("scroll", hide, true)')
    expect(client).toContain('window.addEventListener("resize", hide)')

    type Anchor = { getBoundingClientRect: () => Pick<DOMRect, 'right' | 'bottom' | 'top'> }
    type Tip = { getBoundingClientRect: () => Pick<DOMRect, 'height'> }
    type Box = { left: string; top: string; width: string }

    const placeWith = (viewport: {
      innerWidth: number
      innerHeight: number
      devicePixelRatio: number
    }) =>
      new Function('window', `${source}; return placeCompactImageInputTip;`)(
        viewport
      ) as (node: Anchor, tip?: Tip) => Box

    const snapped = (value: string, dpr: number) => {
      const px = Number.parseFloat(value)
      expect(px * dpr).toBeCloseTo(Math.round(px * dpr), 8)
      return px
    }

    const place = placeWith({
      innerWidth: 1280,
      innerHeight: 800,
      devicePixelRatio: 1.25
    })

    const below = place({
      getBoundingClientRect: () => ({ right: 900.4, bottom: 200.2, top: 172.2 })
    })
    expect(snapped(below.width, 1.25)).toBe(280)
    expect(snapped(below.left, 1.25)).toBe(620.8)
    expect(snapped(below.top, 1.25)).toBe(208)

    const flipped = place({
      getBoundingClientRect: () => ({ right: 900, bottom: 760, top: 732 })
    })
    expect(snapped(flipped.top, 1.25)).toBeLessThan(732)

    const measured = place(
      { getBoundingClientRect: () => ({ right: 900, bottom: 760, top: 732 }) },
      { getBoundingClientRect: () => ({ height: 140 }) }
    )
    expect(snapped(measured.top, 1.25)).toBe(584)

    const clamped = place({
      getBoundingClientRect: () => ({ right: 80, bottom: 200, top: 172 })
    })
    expect(snapped(clamped.left, 1.25)).toBe(12)

    const narrow = placeWith({
      innerWidth: 180,
      innerHeight: 800,
      devicePixelRatio: 1
    })({
      getBoundingClientRect: () => ({ right: 80, bottom: 200, top: 172 })
    })
    expect(Number.parseFloat(narrow.width)).toBe(156)
    expect(Number.parseFloat(narrow.left)).toBe(12)
  })

  it('ships localized capability copy and an endpoint warning', async () => {
    const client = await readFile(settingsModelsClient, 'utf8')

    expect(client).toContain('modelImageInput: "Image input"')
    expect(client).toContain('modelImageInputShort: "Vision"')
    expect(client).toContain('the endpoint must support them')
    expect(client).toContain('modelImageInput: "支持图片输入"')
    expect(client).toContain('modelImageInputShort: "视觉"')
    expect(client).toContain('请确认接口实际支持')
  })

  it('captures the image-input control in the reproducible dependency patch', async () => {
    const patch = await readFile(
      patchPath('@deepseek-ai/dsh-client-ui-settings-models'),
      'utf8'
    )

    expect(patch).toContain('ModelImageInputToggle')
    expect(patch).toContain('field: "inputModalities"')
    expect(patch).toContain('field: "input"')
    expect(patch).toContain('dshModelModalityTip')
    expect(patch).toContain('onPointerLeave')
    expect(patch).toContain('function placeCompactImageInputTip(node, tip)')
    expect(patch).toContain('if (hoverRef.current !== true) hideTip()')
    expect(patch).not.toContain('data-tooltip')
    expect(patch).not.toContain(':focus-within:after')
  })
})
