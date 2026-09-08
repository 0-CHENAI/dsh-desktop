import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFishLogoPath, whaleAppIconSvg, whaleMarkSvg } from '../scripts/whale-brand.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('official whale brand assets', () => {
  it('reads the Harness FishLogo path and draws that silhouette', async () => {
    const dts = await readFile(
      path.join(
        projectRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh-client-ui-primitives',
        'lib',
        'types',
        'FishLogo.d.ts'
      ),
      'utf8'
    )
    const whalePath = readFishLogoPath(dts)
    expect(whalePath.startsWith('M22.9168')).toBe(true)

    const mark = whaleMarkSvg({
      fill: '#000000',
      width: 168,
      height: 96,
      path: whalePath,
      padding: 8
    })
    expect(mark).toContain(whalePath)
    expect(mark).toContain('fill="#000000"')
    expect(mark).not.toContain('window')

    const appIcon = whaleAppIconSvg({ size: 1024, path: whalePath })
    expect(appIcon).toContain(whalePath)
    expect(appIcon).toContain('fill="#000000"')
    expect(appIcon).toContain('fill="#ffffff"')
    expect(appIcon).not.toContain('#111213')
  })

  it('rebuilds committed brand rasters from FishLogo', async () => {
    const generator = await readFile(
      path.join(projectRoot, 'scripts', 'generate-app-icons.mjs'),
      'utf8'
    )
    expect(generator).toContain("from './whale-brand.mjs'")
    expect(generator).toContain('FishLogo.d.ts')
    expect(generator).toContain("'logo-light.png'")
    expect(generator).toContain("'logo-dark.png'")
    expect(generator).toContain("'app-icon.png'")
    expect(generator).toContain("'icon.png'")
  })
})
