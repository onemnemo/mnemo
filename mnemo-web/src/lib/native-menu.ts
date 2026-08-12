// WebView2 answers a right click with its own browser menu (Back, Reload, Save
// as, Print, Inspect), which is a browser's menu in an app that is not a browser.
// Where Mnemo has something to offer on right click it draws its own menu, so
// everywhere else the click should do nothing, the way the Avalonia build did.
//
// Text entry is the exception: the native menu is where the webview puts spelling
// suggestions and the clipboard commands, and there is no way to keep that part
// of it while dropping the rest.

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "email",
  "password",
  "tel",
  "number",
])

function isTextEntry(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node instanceof HTMLTextAreaElement) return true
  if (node instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(node.type)

  // The click lands on whatever is under the cursor, usually a span inside the
  // editor rather than the editable element itself, so the host is what counts.
  // An editable="false" island (an embedded block in a note) is not text.
  const editable = node.closest("[contenteditable]")
  return editable !== null && editable.getAttribute("contenteditable") !== "false"
}

/**
 * Suppresses the webview's own context menu for the life of the returned disposer.
 */
export function installContextMenuGuard(): () => void {
  const onContextMenu = (event: MouseEvent) => {
    // Shift-right-click is the browser's long-standing way past a page's own
    // handling of the menu, and it keeps Inspect reachable while porting.
    if (event.shiftKey) return
    if (isTextEntry(event.target)) return
    event.preventDefault()
  }

  // Capture, so a handler that stops propagation on its way up cannot leave the
  // native menu on screen.
  window.addEventListener("contextmenu", onContextMenu, true)
  return () => window.removeEventListener("contextmenu", onContextMenu, true)
}
