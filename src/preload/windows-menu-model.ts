// Sandboxed Electron preloads cannot load arbitrary local CommonJS modules.
// Keep the menu preload's runtime model private to its entry so Rollup inlines
// it instead of extracting a chunk shared with the main window preload.
export const WINDOWS_MENU_PRELOAD_BUTTON_WIDTH = 44
export const WINDOWS_MENU_PRELOAD_TITLEBAR_HEIGHT = 36

export function formatWindowsMenuZoomPercentage(zoomFactor: number): string {
  return `${Math.round(zoomFactor * 100)}%`
}
