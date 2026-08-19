import { useMemo } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"

import { useT } from "@/i18n/useT"

import { splitMath, type MathPiece } from "./math"

/**
 * Card text with the maths rendered.
 *
 * The editor has had a formula button since before this existed, it inserts `$…$` and nothing
 * on the other end ever turned that into anything, so a card showed `$E_K$` to its owner
 * mid-review. See `math.ts` for the split and strip logic this renders from.
 */

type RenderedPiece = MathPiece & { out: { html: string } | { error: true } | null }

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

export function MathText({ children }: { children: string }) {
  const t = useT()

  /**
   * Parsed and typeset in the memo, not just split.
   *
   * Splitting a string is not the expensive part, building a MathML tree is, so the typeset
   * result has to live in the same memo as the split or every unrelated state change in a
   * session (reveal, flag, grade) re-typesets every formula on screen from scratch.
   */
  const pieces = useMemo<RenderedPiece[]>(
    () =>
      splitMath(children ?? "").map((p) =>
        p.kind === "text" ? { ...p, out: null } : { ...p, out: render(p.value, p.display) },
      ),
    [children],
  )

  // The overwhelmingly common case. Worth short-circuiting so an ordinary card does not pay
  // for a regex split and a map on every render.
  if (!children?.includes("$")) return <>{children}</>

  return (
    <>
      {pieces.map((p, i) => {
        const out = p.out
        if (p.kind === "text" || !out) return <span key={i}>{p.value}</span>

        if ("error" in out) {
          return (
            <span
              key={i}
              title={t("Flashcards", "StudyMathUnreadable")}
              className="rounded bg-danger-wash px-1 font-mono text-[0.85em] text-danger"
            >
              {p.display ? `$$${p.value}$$` : `$${p.value}$`}
            </span>
          )
        }

        return (
          <span
            key={i}
            role="math"
            aria-label={p.value}
            // KaTeX emits its own markup, and there is no version of this that avoids
            // `dangerouslySetInnerHTML`, the input is the card owner's own text, and KaTeX
            // escapes rather than passes through HTML.
            className={p.display ? "my-2 block overflow-x-auto" : "inline-block"}
            dangerouslySetInnerHTML={{ __html: out.html }}
          />
        )
      })}
    </>
  )
}
