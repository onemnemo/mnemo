// WebView2 answers a right click with its own browser menu (Back, Reload, Save
// as, Print, Inspect), which is a browser's menu in an app that is not a browser.
// Where Mnemo has something to offer on right click it draws its own menu, so
// everywhere else the click does nothing, the way the Avalonia build did.
//
// Text is not the exception it once was. The menu was left alone over inputs and
// editable prose because the webview's spelling suggestions live in it and
// nothing else offered them; proofing marks its own words and answers a click on
// the mark or Alt+Enter, so what was left over text was a browser menu naming
// Back and Inspect on a page that has neither.
//
// Paste by mouse is the note editor's own menu now. Everywhere else the chord is
// the way, which is what the field on the other side of this guard has always
// been: a browser's menu cannot be trimmed down to the one row worth keeping.

/**
 * Suppresses the webview's own context menu for the life of the returned disposer.
 */
export function installContextMenuGuard(): () => void {
  const onContextMenu = (event: MouseEvent) => {
    // Allow the native page menu bypass only in development builds.
    if (event.shiftKey && import.meta.env.DEV) return
    event.preventDefault()
  }

  // Bubble, and last, because the app's own right-click menus have to see the
  // event first. Radix reads defaultPrevented before deciding to open, so a
  // capture-phase preventDefault here would stop every one of them from ever
  // appearing. The webview makes its own decision after the dispatch finishes,
  // so suppressing at the end of it works just as well.
  window.addEventListener("contextmenu", onContextMenu)
  return () => window.removeEventListener("contextmenu", onContextMenu)
}
