import { memo } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { CardText } from "../CardText"

/** The answer under an occlusion image: the asked label, then the fact's Back text. */
export const OcclusionAnswer = memo(function OcclusionAnswer({ label, back }: { label: string; back: string }) {
  const t = useT()
  const text = label.trim()

  return (
    <div data-selectable>
      <p
        className={cn("m-0 leading-[1.6]", text ? "font-medium" : "text-ink-3")}
        style={{ fontSize: "var(--font-size-body-medium)" }}
      >
        {text || t("Flashcards", "OcclusionNoLabel")}
      </p>
      {back.trim() && (
        <div className="chat-prose whitespace-pre-wrap">
          {back.split(/\n{2,}/).map((para, i) => (
            <CardText key={i}>{para}</CardText>
          ))}
        </div>
      )}
    </div>
  )
})
