import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Persona from '@deepseek-ai/dsh-persona'
import { expect, it } from 'vitest'

it('retains legacy deployment persona settings while preferring the explicit new field', async () => {
  for (const [config, expected] of [
    [{ persona: 'Existing instructions' }, 'Existing instructions'],
    [{ persona: 'Old', personaPrefix: 'New' }, 'New'],
    [{ persona: 'Old', personaPrefix: '' }, '']
  ]) {
    const ctx = new Context()
    const fiber = await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, ...config })
    try { expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toBe(expected) }
    finally { await fiber.dispose() }
  }
})

it('accepts existing preset text and maps it to the new prefix section', () => {
  for (const [config, expected] of [[{ text: 'Old preset' }, 'Old preset'], [{ text: 'Old', prefix: 'New' }, 'New']]) {
    const sections = []
    Persona.apply({ effect: fn => fn(), systemPrompt: { getSectionOrder: () => 0, section: section => { sections.push(section); return () => {} } } }, Persona.Config(config))
    expect(sections[0].name).toBe('deployment:persona-prefix')
    expect(sections[0].text).toBe(expected)
  }
})

it('rejects an absent or invalid persona at schema validation and accepts explicit empty prefixes', () => {
  for (const invalid of [{}, { prefix: 42 }, { text: 42 }]) expect(() => Persona.Config(invalid)).toThrow()
  expect(Persona.Config({ prefix: '', text: 'ignored' }).prefix).toBe('')
})
