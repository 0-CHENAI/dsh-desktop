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

      /* Settings-card chrome for third-party plugin cards that name classes
         without shipping rules for them.

         The plugins tab draws the column, not the card: it dispatches
         settings.plugin.item and leaves the appearance to the plugin. A plugin
         that names classes and ships no stylesheet therefore renders with
         browser defaults — its header <button> reads as a hairline input box
         and its title and description run together on one line, next to cards
         the host drew properly. @perrylink/dsh-github is one: 0.7.7 and 0.7.8
         name twenty-two ghc-* classes and carry no CSS at all (no stylesheet
         in the package, no style injection in lib/client.js).

         These rules are the host PluginCard chrome, rule for rule, on the
         same --dsw-* tokens, so a shimmed card is indistinguishable from a
         host-drawn one. Every selector is namespaced to the plugin's own
         class prefix, so the sheet is inert for a layout that never renders a
         .ghc-* node — which is also why it is safe to ship unconditionally
         rather than probing the profile for the plugin.

         Delete this block once the plugin ships its own chrome (fixed
         upstream in @perrylink/dsh-github 0.7.9): the rules are identical by
         construction, so the sheet simply becomes redundant. */
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

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-desktop-client-ui"]')) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-desktop-client-ui'
      style.dataset.pluginCss = 'dsh-desktop-client-ui'
      style.textContent = css
      document.head.appendChild(style)
    }
    // Tight bounds of the mark inside its 1000x1000 source artwork.
    const BRAND_MARK_VIEWBOX = { x: 42, y: 218, width: 898, height: 564 }
    // DSH Desktop whale mark: a window with a tail, drawn in currentColor so
    // it follows the sidebar text color in both themes.
    const BRAND_MARK_PATH = "M478.318 218C605.318 218 683.318 287 687.318 404L691.318 472C693.318 525 697.319 556 726.318 574C746.318 587 774.318 585 790.318 562C799.318 550 802.318 539 792.318 534C747.319 513 727.318 472 738.318 428C739.652 420 742.652 418.667 747.318 424C774.318 450 815.318 460 831.318 501C855.318 457 898.318 456 930.318 436C936.318 431.333 939.318 433.333 939.318 442C938.318 496 903.318 535 850.318 547C841.318 570 833.318 592 819.318 622C773.318 723 661.318 782 491.318 782H294.318C161.319 782 74.3183 714 53.3184 592C41.3184 526 38.3184 433 50.3184 375C70.3184 277 113.82 218 234.32 218H478.318ZM571.82 350.5C469.82 333.5 277.82 329.5 164.82 350.5C138.82 355.5 114.318 379 110.318 404C100.318 451 102.318 551 124.318 596C155.318 660 214.319 697 315.318 705C324.318 678 346.319 662 376.318 662C404.318 662 427.318 678 435.318 705C493.318 699 526.318 680 562.318 652C621.318 606 633.749 527.103 633.749 424C633.749 385.144 604.82 355.5 571.82 350.5ZM179.32 264C167.722 264 158.32 273.402 158.32 285C158.32 296.598 167.722 306 179.32 306C190.918 306 200.32 296.598 200.32 285C200.32 273.402 190.918 264 179.32 264ZM245.551 264C233.953 264 224.551 273.402 224.551 285C224.551 296.598 233.953 306 245.551 306C257.149 306 266.551 296.598 266.551 285C266.551 273.402 257.149 264 245.551 264ZM311.782 264C300.184 264 290.782 273.402 290.782 285C290.782 296.598 300.184 306 311.782 306C323.38 306 332.782 296.598 332.782 285C332.782 273.402 323.38 264 311.782 264Z"

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
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopBrandMark)
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
