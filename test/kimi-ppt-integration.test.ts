import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

const artifacts = {
  core: {
    file: 'dsh-kimi-ppt-0.1.1-rc.2-desktop-templates-20260906.tgz',
    sha256: 'bd07c7dfd72f4cb3b41b3927215724c39d988fe91e1e36033ee89f8f3589e6a6'
  },
  adapter: {
    file: 'deepseek-ai-dsh-experimental-kimi-ppt-standard-adapter-0.1.1-rc.2-desktop-kimi-20260904.tgz',
    sha256: '97adcb338ced61cbbfaf9b453bf26a3c01265bd96b25778bd00061e092d10aa3'
  }
} as const

async function artifact(name: keyof typeof artifacts): Promise<Buffer> {
  return readFile(path.join(projectRoot, 'packages', 'kimi-ppt', artifacts[name].file))
}

function tarEntries(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive)
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '')
    if (name.length === 0) break
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/u, '')
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/u, '').trim()
    const size = Number.parseInt(sizeText || '0', 8)
    const contentOffset = offset + 512
    const fullName = prefix.length === 0 ? name : `${prefix}/${name}`
    entries.set(fullName, tar.subarray(contentOffset, contentOffset + size))
    offset = contentOffset + Math.ceil(size / 512) * 512
  }
  return entries
}

describe('Kimi PPT built-in plugin', () => {
  it('pins the reviewed plugin artifacts byte-for-byte', async () => {
    const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity?: string }>
    }
    const packagePaths = {
      core: 'node_modules/dsh-kimi-ppt',
      adapter: 'node_modules/@deepseek-ai/dsh-experimental-kimi-ppt-standard-adapter'
    } as const

    for (const name of Object.keys(artifacts) as (keyof typeof artifacts)[]) {
      const archive = await artifact(name)
      expect(createHash('sha256').update(archive).digest('hex')).toBe(artifacts[name].sha256)
      expect(lock.packages[packagePaths[name]]?.integrity).toBe(
        `sha512-${createHash('sha512').update(archive).digest('base64')}`
      )
    }
  })

  it('ships one Kimi composer surface and excludes the Tencent route', async () => {
    const core = gunzipSync(await artifact('core')).toString('utf8')
    const adapter = gunzipSync(await artifact('adapter')).toString('utf8')
    const excluded = /\b(?:tencent|slidep|editor_sdk)\b|workbuddy[- ]runtime|\bppt_(?:create|render|write_page)\b/iu

    expect(core).toContain('experimental-kimi-ppt')
    expect(core).toContain('pptd_render')
    expect(core).toContain('ppt_get_template_reference')
    expect(core).not.toMatch(excluded)
    expect(adapter).toContain('conversation.hero.modeActions')
    expect(adapter).toContain('kimi-ppt')
    expect(adapter).not.toMatch(excluded)
  })

  it('ships every JavaScript chunk imported by the Host entry', async () => {
    const archive = gunzipSync(await artifact('core')).toString('utf8')
    const chunk = /from "\.\/(pptd-[A-Za-z0-9_-]+\.js)"/u.exec(archive)?.[1]

    expect(chunk).toBeDefined()
    expect(archive).toContain(`package/lib/${chunk}`)
  })

  it('exposes geometry-derived text capacity to the Kimi authoring workflow', async () => {
    const entries = tarEntries(await artifact('core'))
    const protocol = entries.get('package/lib/types/protocol.d.ts')?.toString('utf8') ?? ''
    const host = entries.get('package/lib/index.js')?.toString('utf8') ?? ''
    const skill = entries.get('package/skills/kimi-ppt/SKILL.md')?.toString('utf8') ?? ''

    expect(protocol).toContain('readonly textCapacity?: number')
    expect(host).toContain('textCapacity: zone.textCapacity ?? geometricTextCapacity(zone, fontSize)')
    expect(skill).toContain('每个文本区的 `textCapacity` 是该区域的最大建议字符数')
  })

  it('blocks overflowing text before rendering and preserves the authored font size', async () => {
    const entries = tarEntries(await artifact('core'))
    const chunkName = [...entries.keys()].find(name => /^package\/lib\/pptd-[A-Za-z0-9_-]+\.js$/u.test(name))
    const renderer = chunkName === undefined ? '' : entries.get(chunkName)?.toString('utf8') ?? ''
    const renderTextStart = renderer.indexOf('function renderText(')
    const renderTextEnd = renderer.indexOf('function solidFill(', renderTextStart)
    const renderText = renderer.slice(renderTextStart, renderTextEnd)

    expect(renderer).toContain('code: "text-overflow"')
    expect(renderer).toContain('severity: "error"')
    expect(renderer).toContain('请缩短文案、增大文本框或拆分页面')
    expect(renderTextStart).toBeGreaterThan(-1)
    expect(renderTextEnd).toBeGreaterThan(renderTextStart)
    expect(renderText).not.toContain('fit: "shrink"')
  })

  it('ships the reviewed 26-template catalog and only the four approved additions', async () => {
    const entries = tarEntries(await artifact('core'))
    const designs = [...entries.keys()]
      .filter(name => /^package\/skills\/kimi-ppt\/references\/[^/]+\/[^/]+\/design\.md$/u.test(name))
    const categories = designs.reduce<Record<string, number>>((counts, name) => {
      const category = name.split('/')[4]!
      counts[category] = (counts[category] ?? 0) + 1
      return counts
    }, {})

    expect(designs).toHaveLength(26)
    expect(categories).toEqual({
      academic: 3,
      business: 4,
      consulting: 4,
      finance: 3,
      promotion: 3,
      strategy: 3,
      work: 6
    })

    const vitalityRoot = 'package/skills/kimi-ppt/references/business/curated-vitality-blue'
    const vitalityPages = [...entries.keys()].filter(name =>
      new RegExp(`^${vitalityRoot}/pages/\\d{2}\\.jpg$`, 'u').test(name)
    )
    const design = entries.get(`${vitalityRoot}/design.md`)?.toString('utf8') ?? ''
    expect(vitalityPages).toHaveLength(58)
    expect(design).toContain('shared slide layout 7')
    expect(design).toContain('29729fab2132fc120eba39371e4093a51beefa099ac978965d92dc9965b3c68e')
    expect(design).toContain('logo-free')

    const approvedTemplates = [
      {
        root: 'package/skills/kimi-ppt/references/work/curated-cobalt-work-atlas',
        pageCount: 128,
        sourcePageCount: 0
      },
      {
        root: 'package/skills/kimi-ppt/references/work/curated-modular-logistics-system',
        pageCount: 10,
        sourcePageCount: 10
      },
      {
        root: 'package/skills/kimi-ppt/references/consulting/curated-swiss-signal-grid',
        pageCount: 10,
        sourcePageCount: 10
      },
      {
        root: 'package/skills/kimi-ppt/references/work/curated-nordic-operating-report',
        pageCount: 10,
        sourcePageCount: 10
      }
    ] as const

    for (const template of approvedTemplates) {
      expect(designs).toContain(`${template.root}/design.md`)
      const pages = [...entries.keys()].filter(name =>
        new RegExp(`^${template.root}/pages/\\d{2,3}\\.jpg$`, 'u').test(name)
      )
      expect(pages).toHaveLength(template.pageCount)

      if (template.sourcePageCount > 0) {
        expect(entries.has(`${template.root}/source/deck.pptd`)).toBe(true)
        const sourcePages = [...entries.keys()].filter(name =>
          name.startsWith(`${template.root}/source/pages/`) && name.endsWith('.page')
        )
        expect(sourcePages).toHaveLength(template.sourcePageCount)
      }
    }

    const excludedExperiments = /research-project|culture-census|monochrome/iu
    expect([...entries.keys()].some(name => excludedExperiments.test(name))).toBe(false)
  })

  it('places the PPT action beside the agent preset and the catalog below the input', async () => {
    const client = await readFile(path.join(
      projectRoot,
      'node_modules',
      '@deepseek-ai',
      'dsh-client-ui-conversation',
      'lib',
      'client.js'
    ), 'utf8')
    const cluster = client.indexOf('className: ConversationRoot_module_css_default.heroModeCluster')
    const agentPreset = client.indexOf('renderSlot("conversation.hero.agentPreset", {})', cluster)
    const modeActions = client.indexOf(
      'zone !== void 0 && renderSlot("conversation.hero.modeActions", zone)',
      agentPreset
    )
    const owner = client.indexOf('extensionZone: zone')
    const input = client.indexOf('className: clsx(InputBar_module_css_default.card', owner)
    const catalog = client.indexOf(
      'extensionZone !== void 0 ? renderSlot("conversation.composer.dock", extensionZone) : null',
      input
    )

    expect(cluster).toBeGreaterThan(-1)
    expect(modeActions).toBeGreaterThan(agentPreset)
    expect(owner).toBeGreaterThan(-1)
    expect(input).toBeGreaterThan(owner)
    expect(catalog).toBeGreaterThan(input)
  })

  it('integrates hero mode actions with the adjacent agent-preset control style', async () => {
    const patch = await readFile(path.join(
      projectRoot,
      'patches',
      '@deepseek-ai+dsh-client-ui-conversation+0.1.2-rc.1.patch'
    ), 'utf8')

    expect(patch).toContain(
      '[data-slot=conversation\\\\.hero\\\\.agentPreset]>span{width:max-content!important;min-width:0!important',
    )
    expect(patch).toContain('._8JRpoa_heroModeCluster{width:max-content')
    expect(patch).not.toContain('._8JRpoa_heroModeCluster{margin-left:auto')
    expect(patch).toContain('._8JRpoa_heroModeCluster button{')
    expect(patch).toContain('height:28px')
    expect(patch).toContain('border:0!important')
    expect(patch).toContain('color:var(--dsw-alias-label-primary)!important')
    expect(patch).toContain('button[data-selected=true]')
    expect(patch).toContain('var(--dsw-alias-state-business-primary) 10%')
    expect(patch).toContain('button:focus-visible')
  })

  it('renders the selected template before editable prompt text', async () => {
    const client = await readFile(path.join(
      projectRoot,
      'node_modules',
      '@deepseek-ai',
      'dsh-client-ui-conversation',
      'lib',
      'client.js'
    ), 'utf8')
    const promptRow = client.indexOf('className: InputBar_module_css_default.promptRow')
    const accessory = client.indexOf('className: InputBar_module_css_default.accessory', promptRow)
    const scroll = client.indexOf('ref: scrollRef', promptRow)

    expect(promptRow).toBeGreaterThan(-1)
    expect(accessory).toBeGreaterThan(promptRow)
    expect(scroll).toBeGreaterThan(accessory)
    expect(client).toContain('children: accessory ?? renderSlot("conversation.input.accessory", extensionZone)')
  })

  it('declares both local artifacts and mounts only the Kimi adapter', async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const profilePatch = await readFile(path.join(projectRoot, 'build', 'dsh-desktop.patch.yml'), 'utf8')

    expect(manifest.dependencies['dsh-kimi-ppt']).toBe(
      `file:packages/kimi-ppt/${artifacts.core.file}`
    )
    expect(manifest.dependencies['@deepseek-ai/dsh-experimental-kimi-ppt-standard-adapter']).toBe(
      `file:packages/kimi-ppt/${artifacts.adapter.file}`
    )
    expect(profilePatch).toContain("name: '@deepseek-ai/dsh-experimental-kimi-ppt-standard-adapter'")
    expect(profilePatch).not.toContain('office-ppt-standard-adapter')
    expect(profilePatch).not.toContain('name: dsh-kimi-ppt')
    expect(profilePatch).not.toContain('workbuddy')
  })
})
