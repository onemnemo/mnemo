import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { openExternally } from "@/lib/external"

// Streaming markdown. While tokens arrive the rendered source is gated to at most
// one update per REFRESH_MS so the remark pipeline doesn't re-parse on every
// delta (the desktop's MarkdownView throttles the same way); when the turn
// finishes we render the final text immediately. Latest-snapshot-wins.
const REFRESH_MS = 120

function useThrottled(value: string, active: boolean): string {
  const [shown, setShown] = useState(value)
  const lastAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!active) {
      if (timer.current) clearTimeout(timer.current)
      setShown(value)
      return
    }
    const elapsed = Date.now() - lastAt.current
    if (elapsed >= REFRESH_MS) {
      lastAt.current = Date.now()
      setShown(value)
      return
    }
    timer.current = setTimeout(() => {
      lastAt.current = Date.now()
      setShown(value)
    }, REFRESH_MS - elapsed)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, active])

  return shown
}

/**
 * Opens links out of the webview rather than navigating the SPA away from itself.
 *
 * Through the host rather than `window.open`, for the reason `openExternally` documents,
 * and with the side benefit that the host opens http and https only. Chat hrefs come out
 * of a model, so they are the least trustworthy links in the app.
 *
 * The default is prevented even when the host will refuse the href: this anchor lives in a
 * chromeless window with no way back, so navigating is the one outcome that must not
 * happen, whatever the link turns out to say.
 */
function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
  event.preventDefault()
  if (href) openExternally(href)
}

interface MarkdownProps {
  content: string
  /** True while the message is still streaming, enables re-render throttling. */
  streaming?: boolean
}

export function Markdown({ content, streaming = false }: MarkdownProps) {
  const source = useThrottled(content, streaming)
  return (
    // Rendered prose is read to be copied out of, so it opts out of the app-wide
    // user-select:none. Every caller of this renderer wants that.
    <div className="chat-prose" data-selectable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a {...props} href={href} onClick={(e) => handleLinkClick(e, href)}>
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
