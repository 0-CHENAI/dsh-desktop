window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { BrandWordmark, FishLogo } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'settings.desktopVersion'

    const en = {
      nav: 'Version',
      desktop: 'DSH Desktop version',
      desktopHint: 'Version of the installed app',
      harness: 'Bundled Harness version',
      harnessHint: 'Updated together with DSH Desktop',
      check: 'Check for updates',
      checkHint: 'Look for a newer installer',
      checking: 'Checking…',
      upToDate: 'You are on the latest version',
      available: 'A newer version is available',
      checkFailed: 'Could not check for updates',
      unsupported: 'Automatic updates are not available here',
      changelog: "What's new",
      changelogHint: 'Recent changes from published releases',
      loading: 'Loading…',
      empty: 'No release notes yet',
      current: 'Current'
    }

    const zh = {
      nav: '版本',
      desktop: 'DSH Desktop 版本',
      desktopHint: '当前安装包的版本号',
      harness: '内置 Harness 版本',
      harnessHint: '随 DSH Desktop 一起更新',
      check: '检查更新',
      checkHint: '查看是否有新的安装包',
      checking: '正在检查…',
      upToDate: '已是最新版本',
      available: '发现新版本',
      checkFailed: '检查更新失败',
      unsupported: '当前环境不支持自动更新',
      changelog: '更新说明',
      changelogHint: '最近几个已发布版本的改动',
      loading: '正在加载…',
      empty: '暂无更新说明',
      current: '当前'
    }

    const css = `
      .dshDesktopVersion{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column}
      .dshDesktopVersionRow{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0}
      .dshDesktopVersionCopy{min-width:0;display:flex;flex-direction:column;gap:2px}
      .dshDesktopVersionTitle{font-size:14px;font-weight:400;line-height:22px}
      .dshDesktopVersionHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .dshDesktopVersionValue{flex:none;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;font-variant-numeric:tabular-nums}
      .dshDesktopVersionActions{flex:none;display:flex;align-items:center;gap:10px}
      .dshDesktopVersionStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;max-width:220px;text-align:right}
      .dshDesktopVersionButton{box-sizing:border-box;height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l3);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
      .dshDesktopVersionButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dshDesktopVersionButton:disabled{cursor:default;opacity:.5}
      .dshDesktopVersionButton:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
      .dshDesktopVersionChangelog{display:flex;flex-direction:column;gap:12px;padding:20px 0 8px}
      .dshDesktopVersionChangelogHead{display:flex;flex-direction:column;gap:2px}
      .dshDesktopVersionRelease{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-module-platform);padding:16px 18px;display:flex;flex-direction:column;gap:8px}
      .dshDesktopVersionReleaseMeta{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px}
      .dshDesktopVersionReleaseTitle{font-size:14px;font-weight:600;line-height:22px}
      .dshDesktopVersionReleaseDate{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .dshDesktopVersionBadge{color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px}
      .dshDesktopVersionBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
      .dshDesktopVersionEmpty{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
    `

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-desktop-client-ui"]')) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-desktop-client-ui'
      style.dataset.pluginCss = 'dsh-desktop-client-ui'
      style.textContent = css
      document.head.appendChild(style)
    }

    function desktopBridge() {
      return globalThis.dshDesktop
    }

    function formatPublishedAt(value) {
      if (typeof value !== 'string' || value.length < 10) return ''
      return value.slice(0, 10)
    }

    function updateStatusMessage(status, t) {
      if (!status) return ''
      if (status.phase === 'checking') return t('checking')
      if (status.phase === 'up-to-date') return t('upToDate')
      if (status.phase === 'available' || status.phase === 'downloading' || status.phase === 'downloaded') {
        return status.availableVersion
          ? `${t('available')} ${status.availableVersion}`
          : t('available')
      }
      if (status.phase === 'unsupported') return t('unsupported')
      if (status.phase === 'error') return t('checkFailed')
      return ''
    }

    function VersionRow({ title, hint, children }) {
      return React.createElement(
        'div',
        { className: 'dshDesktopVersionRow' },
        React.createElement(
          'div',
          { className: 'dshDesktopVersionCopy' },
          React.createElement('div', { className: 'dshDesktopVersionTitle' }, title),
          hint
            ? React.createElement('p', { className: 'dshDesktopVersionHint' }, hint)
            : null
        ),
        children
      )
    }

    function VersionSection({ t }) {
      const [page, setPage] = React.useState()
      const [loadError, setLoadError] = React.useState()
      const [updateMessage, setUpdateMessage] = React.useState('')
      const [checking, setChecking] = React.useState(false)

      React.useEffect(() => {
        let disposed = false
        const bridge = desktopBridge()
        if (!bridge || typeof bridge.getVersionPage !== 'function') {
          setLoadError(t('empty'))
          return undefined
        }
        void bridge
          .getVersionPage()
          .then((next) => {
            if (!disposed) setPage(next)
          })
          .catch(() => {
            if (!disposed) setLoadError(t('empty'))
          })
        return () => {
          disposed = true
        }
      }, [t])

      const check = async () => {
        const bridge = desktopBridge()
        if (!bridge || typeof bridge.checkForUpdates !== 'function') return
        setChecking(true)
        setUpdateMessage(t('checking'))
        try {
          const status = await bridge.checkForUpdates()
          setUpdateMessage(updateStatusMessage(status, t))
        } catch {
          setUpdateMessage(t('checkFailed'))
        } finally {
          setChecking(false)
        }
      }

      const desktopVersion = page?.desktopVersion || '—'
      const harnessVersion = page?.harnessVersion || '—'
      const releases = page?.releases || []
      const notesError = page?.notesError || loadError
      const canCheck = typeof desktopBridge()?.checkForUpdates === 'function'

      return React.createElement(
        'section',
        { className: 'dshDesktopVersion' },
        React.createElement(
          VersionRow,
          { title: t('desktop'), hint: t('desktopHint') },
          React.createElement('span', { className: 'dshDesktopVersionValue' }, desktopVersion)
        ),
        React.createElement(
          VersionRow,
          { title: t('harness'), hint: t('harnessHint') },
          React.createElement('span', { className: 'dshDesktopVersionValue' }, harnessVersion)
        ),
        canCheck
          ? React.createElement(
              VersionRow,
              { title: t('check'), hint: t('checkHint') },
              React.createElement(
                'div',
                { className: 'dshDesktopVersionActions' },
                updateMessage
                  ? React.createElement(
                      'span',
                      { className: 'dshDesktopVersionStatus' },
                      updateMessage
                    )
                  : null,
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshDesktopVersionButton',
                    disabled: checking,
                    onClick: () => void check()
                  },
                  checking ? t('checking') : t('check')
                )
              )
            )
          : null,
        React.createElement(
          'div',
          { className: 'dshDesktopVersionChangelog' },
          React.createElement(
            'div',
            { className: 'dshDesktopVersionChangelogHead' },
            React.createElement('div', { className: 'dshDesktopVersionTitle' }, t('changelog')),
            React.createElement('p', { className: 'dshDesktopVersionHint' }, t('changelogHint'))
          ),
          !page && !notesError
            ? React.createElement('p', { className: 'dshDesktopVersionEmpty' }, t('loading'))
            : null,
          notesError && releases.length === 0
            ? React.createElement('p', { className: 'dshDesktopVersionEmpty' }, notesError)
            : null,
          !notesError && page && releases.length === 0
            ? React.createElement('p', { className: 'dshDesktopVersionEmpty' }, t('empty'))
            : null,
          releases.map((release) => {
            const date = formatPublishedAt(release.publishedAt)
            const current = release.version === page?.desktopVersion
            return React.createElement(
              'article',
              { className: 'dshDesktopVersionRelease', key: release.tag },
              React.createElement(
                'div',
                { className: 'dshDesktopVersionReleaseMeta' },
                React.createElement(
                  'span',
                  { className: 'dshDesktopVersionReleaseTitle' },
                  release.heading || release.tag
                ),
                date
                  ? React.createElement('span', { className: 'dshDesktopVersionReleaseDate' }, date)
                  : null,
                current
                  ? React.createElement('span', { className: 'dshDesktopVersionBadge' }, t('current'))
                  : null
              ),
              release.body
                ? React.createElement('p', { className: 'dshDesktopVersionBody' }, release.body)
                : null
            )
          })
        )
      )
    }

    function DesktopBrandName() {
      return React.createElement(BrandWordmark, { includeMark: false })
    }

    function bindLocale(ctx) {
      try {
        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'dsh-desktop-client-ui: copy dictionaries'
        )
        return ctx.locale.bind(NS)
      } catch {
        const dict = (
          typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
            ? zh
            : en
        )
        return (key) => dict[key] ?? key
      }
    }

    const inject = ['slots', 'locale']
    function apply(ctx) {
      installStyles()
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.inject('conversation.hero.brand.mark', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, FishLogo)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopBrandName)
            yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, FishLogo)
          })
        )
      )
      const t = bindLocale(ctx)
      // Nested inject waits for the settings slots; do not hard-depend on
      // settings-general at plugin-graph level or this occupant can stay unmounted.
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'version',
            order: 50,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ t })
          },
          VersionSection
        )
      )
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          {
            name: 'settings.general.item',
            id: 'desktop-version',
            order: 100,
            locale: NS,
            inject: () => ({ t })
          },
          VersionSection
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
