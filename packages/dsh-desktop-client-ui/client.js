window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { BrandWordmark, FishLogo, MenuItemButton, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    // Tight bounds of the mark inside its 1000x1000 source artwork.
    const BRAND_MARK_VIEWBOX = { x: 42, y: 218, width: 898, height: 564 }
    // DSH Desktop whale mark: a window with a tail, drawn in currentColor so
    // it follows the sidebar text color in both themes.
    const BRAND_MARK_PATH = "M478.318 218C605.318 218 683.318 287 687.318 404L691.318 472C693.318 525 697.319 556 726.318 574C746.318 587 774.318 585 790.318 562C799.318 550 802.318 539 792.318 534C747.319 513 727.318 472 738.318 428C739.652 420 742.652 418.667 747.318 424C774.318 450 815.318 460 831.318 501C855.318 457 898.318 456 930.318 436C936.318 431.333 939.318 433.333 939.318 442C938.318 496 903.318 535 850.318 547C841.318 570 833.318 592 819.318 622C773.318 723 661.318 782 491.318 782H294.318C161.319 782 74.3183 714 53.3184 592C41.3184 526 38.3184 433 50.3184 375C70.3184 277 113.82 218 234.32 218H478.318ZM571.82 350.5C469.82 333.5 277.82 329.5 164.82 350.5C138.82 355.5 114.318 379 110.318 404C100.318 451 102.318 551 124.318 596C155.318 660 214.319 697 315.318 705C324.318 678 346.319 662 376.318 662C404.318 662 427.318 678 435.318 705C493.318 699 526.318 680 562.318 652C621.318 606 633.749 527.103 633.749 424C633.749 385.144 604.82 355.5 571.82 350.5ZM179.32 264C167.722 264 158.32 273.402 158.32 285C158.32 296.598 167.722 306 179.32 306C190.918 306 200.32 296.598 200.32 285C200.32 273.402 190.918 264 179.32 264ZM245.551 264C233.953 264 224.551 273.402 224.551 285C224.551 296.598 233.953 306 245.551 306C257.149 306 266.551 296.598 266.551 285C266.551 273.402 257.149 264 245.551 264ZM311.782 264C300.184 264 290.782 273.402 290.782 285C290.782 296.598 300.184 306 311.782 306C323.38 306 332.782 296.598 332.782 285C332.782 273.402 323.38 264 311.782 264Z"

    function DesktopBrandMark() {
      const height = 17
      return React.createElement(
        'svg',
        {
          width: height * BRAND_MARK_VIEWBOX.width / BRAND_MARK_VIEWBOX.height,
          height,
          viewBox: `${BRAND_MARK_VIEWBOX.x} ${BRAND_MARK_VIEWBOX.y} ${BRAND_MARK_VIEWBOX.width} ${BRAND_MARK_VIEWBOX.height}`,
          fill: 'none',
          'aria-hidden': 'true'
        },
        React.createElement('path', { d: BRAND_MARK_PATH, fill: 'currentColor' })
      )
    }

    function DesktopBrandName() {
      return React.createElement(BrandWordmark, { includeMark: true })
    }

    function ConversationBrandMark(props) {
      return React.createElement(FishLogo, props)
    }

    function OpenUnpreviewableFile({ absolutePath, openWorkspacePath, t }) {
      const [error, setError] = React.useState('')
      const label = t('openLocal')
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {
          type: 'button',
          'data-textpreview-open-local': true,
          onClick: () => {
            setError('')
            // Archive utilities may extract and close without a visible window.
            const request = /\.(zip|7z|rar|tar|gz|tgz|bz2)$/i.test(absolutePath)
              ? { path: absolutePath, action: 'reveal' }
              : { path: absolutePath }
            void openWorkspacePath(request).catch((reason) => {
              setError(reason instanceof Error ? reason.message : String(reason))
            })
          }
        }, label),
        error && React.createElement('span', { role: 'alert' }, error)
      )
    }

    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, deleteSession, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      const label = t('deleteSession')
      const warning = t('deleteWarning', { title: displayTitle || sessionId })
      return React.createElement(MenuItemButton, {
        danger: true,
        onSelect: () => {
          setMenuOpen(false)
          if (!window.confirm(warning)) return
          void Promise.resolve().then(() => deleteSession(sessionId)).catch((reason) => {
            window.alert(reason instanceof Error ? reason.message : String(reason))
          })
        }
      }, label)
    }

    function OpenSessionFolderMenuItem({ sessionId, useMenuOpenState, openInFinder, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      if (typeof window.dshDesktop?.openInFinder !== 'function') return null
      const label = t('openFolder')
      return React.createElement(MenuItemButton, {
        onSelect: () => {
          setMenuOpen(false)
          void Promise.resolve().then(() => openInFinder(sessionId)).catch((reason) => {
            window.alert(reason instanceof Error ? reason.message : String(reason))
          })
        }
      }, label)
    }

    function UnreadSessionMenuItem({ sessionId, unread, onUnreadChange, useMenuOpenState, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      return React.createElement(MenuItemButton, {
        onSelect: () => {
          setMenuOpen(false)
          onUnreadChange(sessionId, !unread)
        }
      }, t(unread ? 'markRead' : 'markUnread'))
    }

    const ACTIONS_NS = 'dsh-desktop-actions'
    const actionMessages = {
      zh: {
        openLocal: '用本地应用打开',
        deleteSession: '永久删除会话',
        deleteWarning: '确定删除“{title}”？工作区文件会保留。此操作无法撤销。',
        openFolder: '在文件管理器中打开',
        markRead: '标为已读',
        markUnread: '标为未读',
        workspaceUnavailable: '工作区导航不可用',
        directoryUnavailable: '会话工作区目录不可用'
      },
      en: {
        openLocal: 'Open with local app',
        deleteSession: 'Delete session permanently',
        deleteWarning: 'Delete “{title}”? Workspace files are kept. This can’t be undone.',
        openFolder: 'Open in file manager',
        markRead: 'Mark as read',
        markUnread: 'Mark as unread',
        workspaceUnavailable: 'Workspace navigation is unavailable',
        directoryUnavailable: 'Session workspace directory is unavailable'
      },
      ja: {
        openLocal: 'ローカルアプリで開く',
        deleteSession: 'セッションを完全に削除',
        deleteWarning: '「{title}」を削除しますか？ワークスペースのファイルは保持されます。この操作は取り消せません。',
        openFolder: 'ファイルマネージャーで開く',
        markRead: '既読にする',
        markUnread: '未読にする',
        workspaceUnavailable: 'ワークスペースのナビゲーションを利用できません',
        directoryUnavailable: 'セッションのワークスペースディレクトリを利用できません'
      },
      es: {
        openLocal: 'Abrir con una aplicación local',
        deleteSession: 'Eliminar sesión permanentemente',
        deleteWarning: '¿Eliminar «{title}»? Se conservan los archivos del espacio de trabajo. No se puede deshacer.',
        openFolder: 'Abrir en el administrador de archivos',
        markRead: 'Marcar como leído',
        markUnread: 'Marcar como no leído',
        workspaceUnavailable: 'La navegación del espacio de trabajo no está disponible',
        directoryUnavailable: 'El directorio de la sesión no está disponible'
      },
      fr: {
        openLocal: 'Ouvrir avec une application locale',
        deleteSession: 'Supprimer définitivement la session',
        deleteWarning: 'Supprimer « {title} » ? Les fichiers de l’espace de travail sont conservés. Cette action est irréversible.',
        openFolder: 'Ouvrir dans le gestionnaire de fichiers',
        markRead: 'Marquer comme lu',
        markUnread: 'Marquer comme non lu',
        workspaceUnavailable: 'La navigation de l’espace de travail est indisponible',
        directoryUnavailable: 'Le dossier de la session est indisponible'
      },
      de: {
        openLocal: 'Mit lokaler Anwendung öffnen',
        deleteSession: 'Sitzung endgültig löschen',
        deleteWarning: '„{title}“ löschen? Die Arbeitsbereichsdateien bleiben erhalten. Dies kann nicht rückgängig gemacht werden.',
        openFolder: 'Im Dateimanager öffnen',
        markRead: 'Als gelesen markieren',
        markUnread: 'Als ungelesen markieren',
        workspaceUnavailable: 'Arbeitsbereichsnavigation ist nicht verfügbar',
        directoryUnavailable: 'Das Arbeitsbereichsverzeichnis der Sitzung ist nicht verfügbar'
      },
      ru: {
        openLocal: 'Открыть в локальном приложении',
        deleteSession: 'Удалить сеанс навсегда',
        deleteWarning: 'Удалить «{title}»? Файлы рабочей области сохранятся. Это действие нельзя отменить.',
        openFolder: 'Открыть в файловом менеджере',
        markRead: 'Отметить как прочитанное',
        markUnread: 'Отметить как непрочитанное',
        workspaceUnavailable: 'Навигация по рабочей области недоступна',
        directoryUnavailable: 'Каталог рабочей области сеанса недоступен'
      },
      pt: {
        openLocal: 'Abrir com aplicativo local',
        deleteSession: 'Excluir sessão permanentemente',
        deleteWarning: 'Excluir “{title}”? Os arquivos do espaço de trabalho serão mantidos. Não é possível desfazer.',
        openFolder: 'Abrir no gerenciador de arquivos',
        markRead: 'Marcar como lida',
        markUnread: 'Marcar como não lida',
        workspaceUnavailable: 'A navegação do espaço de trabalho está indisponível',
        directoryUnavailable: 'O diretório da sessão está indisponível'
      }
    }

    // The session-scope slot supplies Harness's public editor actions. Capture the
    // revision before IPC so an async suggestion can never overwrite a user's edit.
    function RepairDraft({ session, input, inputActions }) {
      const currentInput = React.useRef(input)
      currentInput.current = input
      React.useEffect(() => {
        const bridge = window.dshDesktop
        if (typeof bridge?.getRepairDraft !== 'function') return
        let alive = true
        const span = inputActions.captureInsertion()
        const empty = input.draft === '' && input.attachmentIds.length === 0 && input.phase === 'plain'
        void bridge.getRepairDraft(session.sessionId).then(async draft => {
          if (!alive || typeof draft?.token !== 'string') return
          const current = currentInput.current
          if (empty && current.draft === '' && current.attachmentIds.length === 0 && current.phase === 'plain' && typeof draft.text === 'string' && draft.text) {
            if (inputActions.insertText(draft.text, span)) inputActions.persistDraft()
          }
          await bridge.acknowledgeRepairDraft(session.sessionId, draft.token)
        }).catch(error => { console.warn('[desktop-repair] draft initialization failed', error) })
        return () => { alive = false }
      }, [session.sessionId, inputActions])
      return null
    }
    function applyRepair(ctx) {
      const bridge = window.dshDesktop
      if (typeof bridge?.getRepairDraft === 'function') ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'desktop-repair-draft' }, RepairDraft))
    }

    // Compatibility chrome for older dsh-github cards which declare ghc-*
    // classes without shipping CSS. Newer plugin releases use the same tokens.
    const pluginCardCss = `
      .ghc-card{list-style:none;display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
      .ghc-card:hover{border-color:var(--dsw-alias-label-dimmed)}
      .ghc-cardOpen{border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)}
      .ghc-header{appearance:none;display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;border-radius:12px;background:0 0;cursor:pointer;text-align:left;font:inherit;color:inherit}
      .ghc-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
      .ghc-headText{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0}
      .ghc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
      .ghc-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
      .ghc-pending{flex:none;white-space:nowrap;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
      .ghc-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
      .ghc-chevronOpen{transform:rotate(180deg)}
      .ghc-body{display:flex;flex-direction:column;margin:0 16px;padding-bottom:8px;border-top:.5px solid var(--dsw-alias-border-l2)}
      .ghc-readOnly{margin:12px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
      .ghc-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
      .ghc-field+.ghc-field{border-top:.5px solid var(--dsw-alias-border-l2)}
      .ghc-head{display:flex;align-items:center;gap:8px}
      .ghc-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}
      .ghc-badges{display:inline-flex;align-items:center;gap:8px}
      .ghc-badge{white-space:nowrap;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
      .ghc-badgeMuted{white-space:nowrap;border-radius:999px;color:var(--dsw-alias-label-tertiary);padding:1px 8px;font-size:11px;line-height:17px}
      .ghc-input{height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}
      .ghc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
      .ghc-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
      .ghc-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
      .ghc-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:.5px solid var(--dsw-alias-border-l2)}
      .ghc-failed{flex:1;min-width:0;margin:0;color:var(--dsw-alias-label-error);font-size:12px;line-height:1.5}
      .ghc-spin{display:inline-flex;animation:ghc-spin 1s linear infinite}
      @keyframes ghc-spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.ghc-spin{animation:none}.ghc-card,.ghc-chevron{transition:none}}
    `
    function installPluginCardStyles(ctx) {
      ctx.effect(() => {
        if (document.querySelector('style[data-plugin-css="dsh-desktop-client-ui"]')) return
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-desktop-client-ui'
        style.dataset.pluginCss = 'dsh-desktop-client-ui'
        style.textContent = pluginCardCss
        document.head.appendChild(style)
        return () => style.remove()
      })
    }

    const inject = ['locale', 'slots', 'remote.session', 'sessions', 'uiWorkspace']
    function apply(ctx) {
      installPluginCardStyles(ctx)
      applyRepair(ctx)
      ctx.effect(() => ctx.locale.register(ACTIONS_NS, actionMessages))
      const actionText = ctx.locale.bind(ACTIONS_NS)


      ctx.effect(() => {
        const id = 'dsh-desktop-preset-toolbar-style'
        if (typeof document.getElementById !== 'function') return
        if (typeof document.getElementById !== 'function') return
        if (document.getElementById(id)) return
        const style = document.createElement('style')
        style.id = id
        style.textContent = `
          /* Third-party plugins (dshmarket, dsh-better-sidebar) draw custom icons via ::before on settings nav rows,
             expecting direct > svg to hide the fallback gear. In 0.2.2-rc.1, navIcon wraps the fallback in a span,
             so ensure the fallback gear container is hidden when custom nav marker is present. */
          [data-dsh-market-nav-icon] span[class*="navIcon"],
          [data-dsh-market-nav-icon] svg,
          [data-dsh-better-sidebar-settings-nav] span[class*="navIcon"],
          [data-dsh-better-sidebar-settings-nav] svg { display:none !important; }

          :root { --dsh-page-title-top-spacing:56px; }
          [data-conversation-tabs] { grid-column:2; padding-inline-start:8px; }
          /* Top-level page titles align with the sidebar brand row. Keep
             conversation chrome and detail/dialog headers in their own layout. */
          [data-plugin-panel] > header[data-window-drag] {
            padding-top:var(--dsh-page-title-top-spacing);
          }
          [data-dsh-preset-heading] { display:flex; align-items:center; flex-wrap:wrap; gap:12px 16px; }
          [data-dsh-preset-heading] h2 { margin:0; }
          [data-dsh-preset-actions] { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-left:auto; }
          [data-dsh-preset-actions] button { white-space:nowrap; }
          [data-dsh-preset-search] { margin-bottom:16px; }
          [data-dsh-preset-search] input[type=search] {
            box-sizing:border-box; width:100%; min-width:0; height:36px;
            border:1px solid var(--dsw-alias-border-l2); border-radius:10px;
            background:var(--dsw-alias-bg-module-platform); color:var(--dsw-alias-label-primary);
            padding:0 12px; font:inherit; font-size:13px;
          }
          [data-dsh-preset-search] input[type=search]::placeholder { color:var(--dsw-alias-label-caption); }
          [data-dsh-preset-search] input[type=search]:focus-visible {
            outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px;
            background:var(--dsw-alias-bg-base);
          }
        `
        document.head.appendChild(style)
        return () => style.remove()
      })
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.inject('conversation.hero.brand.mark', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopBrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopBrandName)
            yield ctx.slots.register(
              { name: 'conversation.hero.brand.mark' },
              ConversationBrandMark
            )
          })
        )
      )
      ctx.slots.inject('sidebar.right.tab.document.unpreviewable', () =>
        ctx.slots.register({
          name: 'sidebar.right.tab.document.unpreviewable',
          id: 'desktop-open-local', locale: ACTIONS_NS,
          inject: () => ({
            t: actionText,
            openWorkspacePath: (request) => ctx.remote.session.openWorkspacePath(request)
          })
        }, OpenUnpreviewableFile)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-delete-session', locale: ACTIONS_NS,
          order: 900,
          inject: () => ({
            t: actionText,
            deleteSession: (sessionId) => {
              const workspace = ctx.get('uiWorkspace')
              if (!workspace) throw new Error(actionText('workspaceUnavailable'))
              return workspace.deleteSession(sessionId)
            }
          })
        }, DeleteSessionMenuItem)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-open-session-folder', locale: ACTIONS_NS,
          order: 800,
          inject: () => ({
            t: actionText,
            openInFinder: (sessionId) => {
              const cwd = ctx.get('sessions').list.getSnapshot().byId[sessionId]?.cwd
              if (!cwd) throw new Error(actionText('directoryUnavailable'))
              return window.dshDesktop.openInFinder(cwd)
            }
          })
        }, OpenSessionFolderMenuItem)
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'desktop-unread-session', locale: ACTIONS_NS,
          inject: () => ({ t: actionText }),
          order: 350
        }, UnreadSessionMenuItem)
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
