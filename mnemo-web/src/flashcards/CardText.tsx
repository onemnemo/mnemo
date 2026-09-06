import { useMemo, type ReactNode } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"

import { useT } from "@/i18n/useT"

import { parseCardText, type CardInline } from "./card-format"

/**
 * Card text as the card's owner wrote it: the format bar's markers rendered, and the maths
 * typeset.
 *
 * Both halves have to happen here rather than in two passes. The formula button inserts `$…$`
 * and the bold button `**…**`, and a card carries them mixed, so the markers are read around
 * whole formulas instead of into them: `$5 * 3$` is a product, `5 * 3` outside one is not
 * formatting either, and `**$E=mc^2$**` is a bold formula. See `card-format.ts` for the grammar.
 */

/**
 * A formula that will not parse is shown as what you typed, marked.
 *
 * KaTeX's own `throwOnError: false` renders the broken source in red inside the formula, which
 * is right for a document and wrong here: mid-review you need to recognise this as your own
 * typo rather than as the card, and you need to be able to read the source to fix it.
 */
function render(tex: string, display: boolean): { html: string } | { error: true } {
  try {
    return {
      html: katex.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        strict: false,
        // Matches the surrounding type rather than KaTeX's default 1.21x, which makes an
        // inline formula sit a size larger than the sentence it is part of.
        minRuleThickness: 0.06,
      }),
    }
  } catch {
    return { error: true }
  }
}

/**
 * Typeset per formula rather than per card, because building a MathML tree is the expensive
 * part: without the memo, every unrelated state change in a session (reveal, flag, grade)
 * re-typesets every formula on screen from scratch.
 */
function Formula({ value, display }: { value: string; display: boolean }) {
  const t = useT()
  const out = useMemo(() => render(value, display), [value, display])

  if ("error" in out) {
    return (
      <span
        title={t("Flashcards", "StudyMathUnreadable")}
        className="rounded bg-danger-wash px-1 font-mono text-[0.85em] text-danger"
      >
        {display ? `$$${value}$$` : `$${value}$`}
      </span>
    )
  }

  return (
    <span
      role="math"
      aria-label={value}
      // KaTeX emits its own markup, and there is no version of this that avoids
      // `dangerouslySetInnerHTML`, the input is the card owner's own text, and KaTeX
      // escapes rather than passes through HTML.
      className={display ? "my-2 block overflow-x-auto" : "inline-block"}
      dangerouslySetInnerHTML={{ __html: out.html }}
    />
  )
}

function renderInline(nodes: CardInline[]): ReactNode[] {
  return nodes.map((node, i) => {
    // A plain string, not a wrapper: the surfaces lay text out with `white-space: pre-wrap`,
    // and an element per run would give the browser somewhere new to break lines.
    if (node.kind === "text") return node.value
    if (node.kind === "math") return <Formula key={i} value={node.value} display={node.display} />

    const children = renderInline(node.children)
    switch (node.mark) {
      case "bold":
        return <strong key={i}>{children}</strong>
      case "italic":
        return <em key={i}>{children}</em>
      case "underline":
        return <u key={i}>{children}</u>
      case "code":
        return <code key={i}>{children}</code>
      case "highlight":
        return <mark key={i}>{children}</mark>
    }
  })
}

export function CardText({ children }: { children: string }) {
  const blocks = useMemo(() => parseCardText(children ?? ""), [children])

  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "list" ? (
          <ul key={i}>
            {block.items.map((item, k) => (
              <li key={k}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{renderInline(block.content)}</p>
        ),
      )}
    </>
  )
}
