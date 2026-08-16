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
      <span className="text-[12px] font-medium text-ink-3">{fc("TagsLabel")}</span>

      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex h-7 items-center gap-1 rounded-md bg-canvas-sunken pr-1 pl-2 text-[12px] text-ink-2"
          >
            {tag}
            <button
              type="button"
              aria-label={`${t("Flashcards", "Remove")} ${tag}`}
              onClick={() => onChange(tags.filter((existing) => existing !== tag))}
              className="grid size-4 place-items-center rounded text-ink-3 transition-colors hover:bg-frame-active hover:text-ink"
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
            className="h-7 w-[120px] rounded-md bg-transparent px-2 text-[12px] text-ink shadow-[0_0_0_1px_var(--line)] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1.5px_var(--solid)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-ink-3 shadow-[0_0_0_1px_var(--line-soft)] transition-colors hover:bg-frame-hover hover:text-ink"
          >
            <AppIcon name="common/plus" size={11} />
            {fc("CardEditorAddTag")}
          </button>
        )}
      </div>
    </div>
  )
}
