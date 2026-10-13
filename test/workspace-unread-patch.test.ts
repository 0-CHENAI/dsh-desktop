import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { patchPath, projectRoot } from './patch-path'

const workspacePath = path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js')
const desktopPath = path.join(projectRoot, 'packages/dsh-desktop-client-ui/client.js')

describe('workspace session unread markers', () => {
  it('uses the existing persisted view key and upgrades older snapshots on write', async () => {
    const source = await readFile(workspacePath, 'utf8')
    const start = source.indexOf('function createWorkspaceViewStore() {')
    const end = source.indexOf('\n\t\t//#endregion', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const spec = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return createWorkspaceViewStore() })()`, {
      _deepseek_ai_dsh_client_store: { defineStore: (value: unknown) => value }
    }) as {
      init: () => { unreadSessionIds: string[] }
      persist: string
      actions: {
        markSessionUnread: (draft: { unreadSessionIds?: string[] }, id: string) => void
        markSessionRead: (draft: { unreadSessionIds?: string[] }, id: string) => void
      }
    }
    expect(spec.persist).toBe('dsh.workspace.view.v5')
    expect(spec.init().unreadSessionIds).toEqual([])
    const olderSnapshot: { unreadSessionIds?: string[] } = {}
    spec.actions.markSessionUnread(olderSnapshot, 'session-1')
    spec.actions.markSessionUnread(olderSnapshot, 'session-1')
    expect(olderSnapshot.unreadSessionIds).toEqual(['session-1'])
    spec.actions.markSessionRead(olderSnapshot, 'session-1')
    expect(olderSnapshot.unreadSessionIds).toEqual([])
  })

  it('offers a right-click menu action in both session list modes', async () => {
    const [workspace, desktop, patch] = await Promise.all([
      readFile(workspacePath, 'utf8'),
      readFile(desktopPath, 'utf8'),
      readFile(patchPath('@deepseek-ai/dsh-client-ui-workspace'), 'utf8')
    ])
    expect(workspace).toContain('onContextMenu: (event) =>')
    expect(workspace).toContain('if (!row.blank) setMenuOpen(true)')
    expect(workspace).toContain('unread: unreadSessionIds.includes(node.id)')
    expect(workspace).toContain('onUnreadChange')
    expect(desktop).toContain("id: 'desktop-unread-session'")
    expect(desktop).toContain("'标为未读'")
    expect(desktop).toContain("'标为已读'")
    expect(patch).toContain('markSessionUnread')
  })

  it('renders an unread indicator and clears the marker when opening a session', async () => {
    const source = await readFile(workspacePath, 'utf8')
    expect(source).toContain('StateDot, { state: "done" }')
    expect(source).toContain('style: unread ? { fontWeight: 600 } : void 0')
    expect(source).toContain('children: t("status.unread")')
    expect(source).toContain('this.view.markSessionRead(target)')
    expect(source).toContain('this.view.markSessionRead(sessionId)')
  })
})

it('marks search results read while preserving search exit and reveal navigation', async () => {
  const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', import.meta.url), 'utf8')
  const search = source.match(/const openSearchResult = \(sessionId\) => \{[\s\S]*?\n\t\t\t\};/)![0]
  const calls: unknown[][] = []
  const handler = new Function('actions', 'open', 'archivedSessionIds', 'notifyArchivedNotOpenable', 'setRevealSessionId', 'setQuery', 'setSearchExpanded', `${search}\nreturn openSearchResult;`)(
    { markSessionRead: (id: string) => calls.push(['read', id]) },
    (id: string) => calls.push(['open', id]),
    [], () => { throw new Error('Archived sessions must not open') },
    (id: string) => calls.push(['reveal', id]),
    (query: string) => calls.push(['query', query]),
    (expanded: boolean) => calls.push(['expanded', expanded])
  )
  handler('searched-session')
  expect(calls).toEqual([['reveal', 'searched-session'], ['query', ''], ['expanded', false], ['read', 'searched-session'], ['open', 'searched-session']])
})

it('maps every workspace browser class to a shipped CSS selector or animation', async () => {
  const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', import.meta.url), 'utf8')
  const map = source.match(/var WorkspaceBrowser_module_css_default = \{([\s\S]*?)\n\s*\};/)![1]!
  const classes = [...map.matchAll(/"[^"]+": "([^"]+)"/g)].map(match => match[1]!)
  expect(classes.length).toBeGreaterThan(20)
  const missing = classes.filter(name => !source.includes(`.${name}`) && !source.includes(`@keyframes ${name}`))
  expect(missing).toEqual([])
})
