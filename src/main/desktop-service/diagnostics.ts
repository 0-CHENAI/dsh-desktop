import { classifyGpuExit, emptyGpuExitContext, type GpuExitContext } from '../gpu-fallback'
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { rendererDiagnosticUrl } from '../renderer-diagnostics'
import type { RuntimeSnapshot } from '../../shared/contracts'
import { DesktopService, type FailureKind } from './service'

/** Bind before webContents are created. Capture synchronously before recovery can app.exit(). */
export function attachDiagnostics(app: EventEmitter, service: DesktopService, options: {
  getExitContext?: () => GpuExitContext
  resourceEvidence?: () => string
  platform?: NodeJS.Platform
  processEvents?: EventEmitter
  onError?: (error: unknown) => void
  dedupeWindowMs?: number
} = {}) {
  const processEvents = options.processEvents ?? process
  const dedupeWindowMs = options.dedupeWindowMs ?? 10 * 60_000 // 10 minutes deduplication window
  const recentCaptures = new Map<string, number>()
  const safe = (operation: () => void) => { try { operation() } catch (error) { options.onError?.(error) } }
  const flush = () => { void service.flush().catch(error => options.onError?.(error)) }
  let canSend = false
  let pendingPluginFailureEventId: string | undefined
  let suppressPluginFailure = false
  const capture = (kind: FailureKind, message: string, eventId?: string) => {
    if (dedupeWindowMs > 0) {
      const dedupeKey = `${kind}:${message}`
      const now = Date.now()
      const last = recentCaptures.get(dedupeKey)
      if (last !== undefined && now - last < dedupeWindowMs) {
        return
      }
      recentCaptures.set(dedupeKey, now)
      if (recentCaptures.size > 100) {
        for (const [k, t] of recentCaptures) {
          if (now - t >= dedupeWindowMs) recentCaptures.delete(k)
        }
      }
    }
    let evidence = ''
    try { evidence = options.resourceEvidence?.() ?? '' }
    catch (error) { options.onError?.(error) }
    safe(() => service.capture(kind, evidence ? `${message.slice(0, 2200)}\nresources=${evidence.slice(0, 1700)}` : message, eventId))
    // A plugin-attributed startup failure waits: recovery may still discard it.
    if (canSend && (eventId === undefined || eventId !== pendingPluginFailureEventId)) flush()
  }
  safe(() => service.beginSession())
  const fatal = (error: Error) => safe(() => service.captureFatal(error))
  processEvents.on('uncaughtExceptionMonitor', fatal)
  const contentsListeners = new Map<EventEmitter, (...args: any[]) => void>()
  const created = (_event: unknown, contents: EventEmitter) => {
    const gone = (_event: unknown, details: { reason: string; exitCode: number }) => {
      if (!['clean-exit', 'killed'].includes(details.reason)) {
        let urlInfo = ''
        try {
          const url = (contents as { getURL?: () => string }).getURL?.()
          if (url) urlInfo = ` url=${rendererDiagnosticUrl(url)}`
        } catch { /* ignore */ }
        capture('renderer-crash', `reason=${details.reason} exitCode=${details.exitCode}${urlInfo}`)
      }
    }
    contentsListeners.set(contents, gone)
    contents.prependListener('render-process-gone', gone)
    contents.once('destroyed', () => contentsListeners.delete(contents))
  }
  app.on('web-contents-created', created)
  const childGone = (_event: unknown, details: { type: string; reason: string; exitCode: number }) => {
    if (details.type === 'GPU' && !['clean-exit', 'killed'].includes(details.reason)) {
      const context = options.getExitContext?.() ?? emptyGpuExitContext()
      const classification = classifyGpuExit(options.platform ?? process.platform, details.exitCode, context)
      // Keep all reports, including expected shutdown, for server-side triage.
      capture('gpu-crash', `reason=${details.reason} exitCode=${details.exitCode}` +
        ` classification=${classification} sessionEndRequested=${context.sessionEndRequested}` +
        ` sessionEnding=${context.sessionEnding} quitRequested=${context.quitRequested} appExiting=${context.appExiting}`)
    }
  }
  app.prependListener('child-process-gone', childGone)
  const clean = () => safe(() => service.markCleanExit())
  app.on('will-quit', clean)
  // Confirmed Windows logoff bypasses quit events, even for hidden tray windows.
  const windowListeners = new Map<EventEmitter, () => void>()
  const windowCreated = (_event: unknown, window: EventEmitter) => {
    const closed = () => {
      window.removeListener('session-end', clean)
      windowListeners.delete(window)
    }
    windowListeners.set(window, closed)
    window.prependListener('session-end', clean)
    window.once('closed', closed)
  }
  app.on('browser-window-created', windowCreated)
  let previousAttempt = -1
  let recoveryGeneration = 0
  let wasReady = false
  let previousPhase: RuntimeSnapshot['phase'] | undefined
  return {
    startSending() {
      if (canSend) return
      canSend = true
      flush()
    },
    runtimeChanged(snapshot: RuntimeSnapshot, flushLog: () => Promise<void>, attempt = 0) {
      if (attempt !== previousAttempt) {
        recoveryGeneration++
        wasReady = false
        suppressPluginFailure = false
        pendingPluginFailureEventId = undefined
      }
      if (snapshot.phase === 'starting') {
        wasReady = false
        suppressPluginFailure = false
      }
      if (snapshot.phase === 'ready') {
        recoveryGeneration++
        wasReady = true
        suppressPluginFailure = false
        if (pendingPluginFailureEventId) {
          service.discard(pendingPluginFailureEventId)
          pendingPluginFailureEventId = undefined
        }
      }
      if (snapshot.phase === 'failed' && (previousPhase !== 'failed' || attempt !== previousAttempt)) {
        const kind = wasReady ? 'harness-crash' : 'startup-failure'
        const startupPluginFailure = !wasReady && Boolean(snapshot.pluginFailures?.length)
        const failureGeneration = recoveryGeneration
        // Wait for the actual Harness stream callback, not a guessed timer.
        void flushLog().catch(error => options.onError?.(error)).then(() => {
          if (startupPluginFailure && (suppressPluginFailure || failureGeneration !== recoveryGeneration)) {
            return
          }
          const eventId = randomUUID()
          if (startupPluginFailure) {
            pendingPluginFailureEventId = eventId
          }
          capture(kind, snapshot.message, eventId)
        })
      }
      previousPhase = snapshot.phase
      previousAttempt = attempt
    },
    discardPendingPluginFailure() {
      suppressPluginFailure = true
      if (pendingPluginFailureEventId) {
        service.discard(pendingPluginFailureEventId)
        pendingPluginFailureEventId = undefined
      }
    },
    startupFailed(error: unknown) { capture('startup-failure', error instanceof Error ? error.stack ?? error.message : String(error)) },
    markCleanExit: clean,
    dispose() {
      processEvents.removeListener('uncaughtExceptionMonitor', fatal)
      app.removeListener('web-contents-created', created)
      app.removeListener('child-process-gone', childGone)
      app.removeListener('will-quit', clean)
      app.removeListener('browser-window-created', windowCreated)
      for (const [window, closed] of windowListeners) {
        window.removeListener('session-end', clean)
        window.removeListener('closed', closed)
      }
      windowListeners.clear()
      for (const [contents, listener] of contentsListeners) contents.removeListener('render-process-gone', listener)
      contentsListeners.clear()
    }
  }
}
