import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { addTag } from "../editor-state"

/** The tag chip row and its inline add field. */
export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) input.current?.focus()
  }, [adding])

  const commit = () => {
    onChange(addTag(tags, draft))
    setDraft("")
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold tracking-[1px] text-text-faded">{fc("TagsLabel")}</span>

      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex h-[26px] items-center gap-1.5 rounded-pill bg-[var(--card-background-secondary)] px-2.5 text-caption text-text-secondary"
          >
            {tag}
            <button
              type="button"
              aria-label={`${t("Flashcards", "Remove")} ${tag}`}
              onClick={() => onChange(tags.filter((existing) => existing !== tag))}
              className="grid size-4 place-items-center rounded-sm text-text-tertiary transition-colors hover:bg-[var(--navigation-button-background-hover)] hover:text-text-primary"
            >
              <AppIcon name="common/x" size={10} />
            </button>
          </span>
        ))}

        {adding ? (
          <input
            ref={input}
            // Marks this as an inner editor that owns its own Escape; the dialog reads it to
            // decide whether an Escape was meant for the tag field or for the whole editor.
            data-inline-editor=""
            value={draft}
            placeholder={fc("TagAddPlaceholder")}
            aria-label={fc("TagAddPlaceholder")}
            onChange={(event) => setDraft(event.target.value)}
            // Blurring commits rather than discards, matching the desktop: clicking away from a
            // typed tag keeps it.
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Enter belongs to the tag field even with Ctrl held. Without this the save
                // shortcut also fires, and it would save from a render that predates the tag
                // this keypress just added - persisting the card without it.
                event.stopPropagation()
                event.preventDefault()
                commit()
              } else if (event.key === "Escape") {
                // Discards rather than commits, unlike blur. The dialog declines its own
                // dismiss for this keypress - see the data-inline-editor check there.
                setDraft("")
                setAdding(false)
              }
            }}
            className="h-[26px] w-[150px] rounded-sm border border-line bg-[var(--workspace-background)] px-2 text-caption text-text-primary outline-none placeholder:text-text-faded focus:border-brand"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-[26px] items-center gap-[5px] rounded-pill border border-line px-2.5 text-caption text-text-faded transition-colors hover:text-text-secondary"
          >
            <AppIcon name="common/plus" size={11} />
            {fc("CardEditorAddTag")}
          </button>
        )}
      </div>
    </div>
  )
}
