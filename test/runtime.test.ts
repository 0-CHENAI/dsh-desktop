// CLI launch/UtilityProcess contracts were replaced by real Host subprocess
// coverage in test/host and test/shell. Public navigation/security stays tested.
import { describe, expect, it } from 'vitest'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/main/security-policy'
import {
  clearStaleHarnessAuthCookies, desktopHarnessUrl,
  isAbortedNavigationError, shouldLoadHarnessUrl
} from '../src/main/window-navigation'

describe('navigation trust boundary', () => {
  it('only trusts the launcher and loopback HTTP pages', () => {
    expect(isTrustedAppUrl('file:///app/index.html')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:43127')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:43127')).toBe(true)
    expect(isTrustedAppUrl('https://127.0.0.1:43127')).toBe(false)
    expect(isTrustedAppUrl('http://example.com')).toBe(false)
    expect(isTrustedAppUrl('javascript:alert(1)')).toBe(false)
  })

  it('only grants clipboard writes from the trusted main frame', () => {
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://127.0.0.1:43127/session',
        true
      )
    ).toBe(true)
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://localhost:43127/session',
        true
      )
    ).toBe(true)
    expect(
      canGrantWindowPermission('clipboard-read', 'http://127.0.0.1:43127/session', true)
    ).toBe(false)
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://127.0.0.1:43127/session',
        false
      )
    ).toBe(false)
    expect(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'https://example.com/session',
        true
      )
    ).toBe(false)
    expect(
      canGrantWindowPermission('clipboard-sanitized-write', 'file:///tmp/app.html', true)
    ).toBe(false)
  })

  it('only grants notifications from the trusted main frame', () => {
    expect(
      canGrantWindowPermission('notifications', 'http://127.0.0.1:43127/session', true)
    ).toBe(true)
    expect(
      canGrantWindowPermission('notifications', 'http://localhost:43127/session', true)
    ).toBe(true)
    expect(
      canGrantWindowPermission('notifications', 'http://127.0.0.1:43127/session', false)
    ).toBe(false)
    expect(
      canGrantWindowPermission('notifications', 'https://example.com/session', true)
    ).toBe(false)
    expect(
      canGrantWindowPermission('notifications', 'https://127.0.0.1:43127/session', true)
    ).toBe(false)
    expect(canGrantWindowPermission('notifications', 'file:///tmp/app.html', true)).toBe(
      false
    )
    expect(canGrantWindowPermission('notifications', undefined, true)).toBe(false)
  })
})

describe('Harness window activation', () => {
  it('removes accumulated authority cookies before exchanging a new launch token', async () => {
    const removed: Array<[string, string]> = []
    const cookies = {
      get: async () => [
        { name: 'dsh-auth-old-port' },
        { name: 'unrelated-cookie' },
        { name: 'dsh-auth-current-port' }
      ],
      remove: async (url: string, name: string) => {
        removed.push([url, name])
      }
    }

    expect(
      await clearStaleHarnessAuthCookies(
        cookies,
        'http://127.0.0.1:43127/?token=next',
        'next'
      )
    ).toBe(2)
    expect(removed).toEqual([
      ['http://127.0.0.1:43127/', 'dsh-auth-old-port'],
      ['http://127.0.0.1:43127/', 'dsh-auth-current-port']
    ])
  })

  it('does not clear cookies for a non-Harness destination or without a launch token', async () => {
    const cookies = {
      get: async () => [{ name: 'dsh-auth-old-port' }],
      remove: async () => undefined
    }

    expect(await clearStaleHarnessAuthCookies(cookies, 'https://example.com', 'next')).toBe(0)
    expect(await clearStaleHarnessAuthCookies(cookies, 'http://127.0.0.1:43127')).toBe(0)
  })

  it('stamps Windows renderer URLs so plugins can avoid the native titlebar overlay', () => {
    expect(desktopHarnessUrl('http://127.0.0.1:43127', 'win32')).toBe(
      'http://127.0.0.1:43127/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32&dsh-desktop-titlebar-inset=40'
    )
    expect(desktopHarnessUrl('http://127.0.0.1:43127/?workspace=demo', 'win32')).toBe(
      'http://127.0.0.1:43127/?workspace=demo&dsh-desktop-mode=advanced&dsh-desktop-platform=win32&dsh-desktop-titlebar-inset=40'
    )
    expect(desktopHarnessUrl('http://127.0.0.1:43127', 'darwin')).toBe(
      'http://127.0.0.1:43127'
    )
  })

  it('preserves the current page when the existing Harness instance is focused again', () => {
    expect(
      shouldLoadHarnessUrl(
        'http://127.0.0.1:43127/settings/models',
        'http://127.0.0.1:43127'
      )
    ).toBe(false)
  })

  it('loads the page for a new window or a restarted Harness instance', () => {
    expect(shouldLoadHarnessUrl('about:blank', 'http://127.0.0.1:43127')).toBe(true)
    expect(
      shouldLoadHarnessUrl('http://127.0.0.1:43127/settings', 'http://127.0.0.1:43128')
    ).toBe(true)
  })

  it('recognizes Electron navigation cancellation without hiding other load failures', () => {
    expect(isAbortedNavigationError({ code: 'ERR_ABORTED', errno: -3 })).toBe(true)
    expect(
      isAbortedNavigationError(
        new Error("ERR_ABORTED (-3) loading 'http://127.0.0.1:43127/'")
      )
    ).toBe(true)
    expect(isAbortedNavigationError({ code: 'ERR_CONNECTION_REFUSED', errno: -102 })).toBe(
      false
    )
  })
})
