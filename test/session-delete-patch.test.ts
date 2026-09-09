import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

// version tracks the patch-filename suffix; bumped per-entry as Task 5b migrates each patch to rc.1
const patchedPackages = [
  {
    name: 'dsh-session-persistence',
    version: '0.1.2-rc.1',
    file: 'lib/index.js',
    markers: ['assertDeletable(id)', 'async delete(id)', 'await this.backend.deleteStored(id)']
  },
  {
    name: 'dsh-session-persistence-jsonl',
    version: '0.1.2-rc.1',
    file: 'lib/index.js',
    markers: ['delete(id) {', 'return this.coordinator.delete(id)', 'async deleteStored(id)']
  },
  {
    name: 'dsh-workspace',
    version: '0.1.2-rc.1',
    file: 'lib/index.js',
    markers: ['forgetSession(sessionId)', 'archivedSessionIds: state.archivedSessionIds.filter']
  },
  {
    name: 'dsh-api-session-controller',
    version: '0.1.2-rc.1',
    file: 'lib/index.js',
    markers: ['disposeOwned(sessionId)', 'await persistence.delete(request.sessionId)', 'workspaceRegistry.forgetSession(request.sessionId)']
  },
  {
    name: 'dsh-api-session-controller',
    version: '0.1.2-rc.1',
    file: 'lib/client.js',
    markers: ['SessionDeleteError', 'this.remote.session.delete({ sessionId })', 'if (this.watched === sessionId) this.watched = void 0']
  },
  {
    name: 'dsh-api-session-controller',
    version: '0.1.2-rc.1',
    file: 'lib/typert.host.js',
    markers: ["id: '@deepseek-ai/dsh-api-session-controller#session/delete'", "method: 'delete'"]
  },
  {
    name: 'dsh-api-remotes',
    version: '0.1.2-rc.1',
    file: 'lib/client.js',
    markers: ['#session/delete', 'SessionDeleteRequest', 'SessionDeleteValue']
  },
  {
    name: 'dsh-client-ui-workspace',
    version: '0.1.2-rc.1',
    file: 'lib/client.js',
    markers: ['delete.session', 'danger: true', 'Workspace files are kept', 'await sessions.delete(sessionId)']
  }
] as const

describe('permanent session deletion dependency patches', () => {
  it.each(patchedPackages)('$name patch is reproducible and installed', async ({ name, file, markers, version }) => {
    const [patch, installed] = await Promise.all([
      readFile(path.join(projectRoot, 'patches', `@deepseek-ai+${name}+${version}.patch`), 'utf8'),
      readFile(path.join(projectRoot, 'node_modules', '@deepseek-ai', name, file), 'utf8')
    ])

    for (const marker of markers) {
      expect(patch).toContain(marker)
      expect(installed).toContain(marker)
    }
  })

  it('mounts the delete command from the actual client bundle with matching wire schemas', async () => {
    type Schema = { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } }
    type Command = {
      id: string; service: string; namespace: string; method: string
      parameters: Array<{ name: string; wire: string; source: string; codec: { schema: Schema; typeSymbol: string } }>
      result: { schema: Schema; typeSymbol: string }
    }
    const commands: Command[] = []
    let client!: { apply(ctx: unknown): Promise<() => Promise<void>> }
    const source = await readFile(
      path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-api-remotes/lib/client.js'), 'utf8'
    )
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (module: { factory(): typeof client }) => {
        client = module.factory()
      } } }
    })
    const dispose = await client.apply({ remote: { $mount: async (contribution: { descriptors: Command[] }) => {
      commands.push(...contribution.descriptors)
      return async () => {}
    } } })
    try {
      const matches = commands.filter((command) => command.namespace === 'session' && command.method === 'delete')
      expect(matches).toHaveLength(1)
      const command = matches[0]
      if (!command) throw new Error('Missing session/delete descriptor')
      expect(command.id).toBe('@deepseek-ai/dsh-api-session-controller#session/delete')
      expect(command.service).toBe('sessionController')
      expect(command.parameters).toHaveLength(1)
      const parameter = command.parameters[0]
      if (!parameter) throw new Error('Missing session/delete request parameter')
      expect(parameter).toMatchObject({ name: 'request', wire: 'request', source: 'json' })
      expect(parameter.codec.typeSymbol).toBe('@deepseek-ai/dsh-api-session-controller/types#SessionDeleteRequest')
      const request = parameter.codec.schema
      expect(request.parse({ sessionId: 'delete-test' })).toEqual({ sessionId: 'delete-test' })
      expect(request.safeParse({}).success).toBe(false)
      expect(request.safeParse({ sessionId: 42 }).success).toBe(false)
      expect(command.result.typeSymbol).toBe('@deepseek-ai/dsh-api-session-controller/types#SessionDeleteValue')
      expect(command.result.schema.parse({ deleted: true })).toEqual({ deleted: true })
      expect(command.result.schema.safeParse({ deleted: false }).success).toBe(false)
      expect(command.result.schema.safeParse({}).success).toBe(false)
    } finally {
      await dispose()
    }
  })

  it('states the destructive retention boundary in both locales', async () => {
    const ui = await readFile(
      path.join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js'),
      'utf8'
    )

    expect(ui).toContain('工作区文件会保留。此操作无法撤销。')
    expect(ui).toContain('Workspace files are kept. This can’t be undone.')
  })

  it('removes one materialized JSONL log without touching another session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-desktop-session-delete-'))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const persistence = ctx.sessionPersistence as typeof ctx.sessionPersistence & {
      delete(id: ReturnType<typeof SessionId>): Promise<boolean>
    }
    const removed = SessionId('desktop-delete-removed')
    const kept = SessionId('desktop-delete-kept')
    const event = [{ type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } }] as const

    try {
      await persistence.create({ version: SESSION_FORMAT_VERSION, id: removed, createdAt: 1, isSeeded: false })
      await persistence.append(removed, event)
      await persistence.create({ version: SESSION_FORMAT_VERSION, id: kept, createdAt: 2, isSeeded: false })
      await persistence.append(kept, event)

      expect(await persistence.delete(removed)).toBe(true)
      expect((await persistence.list()).map((header) => header.id)).toEqual([kept])
      await expect(persistence.load(removed)).rejects.toThrow(/not found/i)
      expect((await persistence.load(kept)).meta.id).toBe(kept)
      expect(await persistence.delete(SessionId('desktop-delete-missing'))).toBe(false)
    } finally {
      await fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
