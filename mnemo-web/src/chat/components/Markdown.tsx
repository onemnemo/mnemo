import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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

/** Opens links out of the webview rather than navigating the SPA away from itself. */
function openExternally(event: React.MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
  event.preventDefault()
  if (href) window.open(href, "_blank", "noopener,noreferrer")
}

interface MarkdownProps {
  content: string
  /** True while the message is still streaming, enables re-render throttling. */
  streaming?: boolean
}

export function Markdown({ content, streaming = false }: MarkdownProps) {
  const source = useThrottled(content, streaming)
  return (
    <div className="chat-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a {...props} href={href} onClick={(e) => openExternally(e, href)}>
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
