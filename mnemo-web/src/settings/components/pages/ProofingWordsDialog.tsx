import { useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useT } from "@/i18n/useT"
import {
  useAddPersonalWord,
  useProofingPersonalWords,
  useRemovePersonalWord,
  useRescopePersonalWord,
} from "@/notes/proofing/status"
import type { PersonalWord, ProofingLanguage } from "@/notes/proofing/types"
import { toast } from "@/stores/toast"

import { SelectControl } from "../controls/SelectControl"
import { ANY_LANGUAGE, resolveScope, scopeChange, scopeLabel, scopeValues } from "./proofing-languages"

const NS = "Settings"

/** Up to this many the list is short enough to scan, and a search field is one control too many. */
const SEARCH_FROM = 6

/** One reference for "no words", so the memo below does not re-run every render. */
const NO_WORDS: readonly PersonalWord[] = []

/**
 * The words the checker has been told to accept.
 *
 * Adding and finding are deliberately kept apart: the add field is the body's
 * first control, and the search sits up in the dialog's header, because two
 * text fields stacked in the same corner read as one control that cannot decide
 * what it does.
 *
 * The scope control is a select rather than a flyout menu. The dialog portals
 * at `Z_LAYERS.modal` and a `Menu` portals at `Z_LAYERS.menu`, which is lower,
 * so a menu opened from inside a dialog is painted behind it and looks like a
 * control that does nothing. {@link SelectControl} is the one this app gives a
 * tier above the dialog.
 *
 * A word's scope is stored as the string it was added with, and removal matches
 * that string exactly, so changing a scope is an add at the new one followed by
 * a removal at the old one rather than an edit (see {@link useRescopePersonalWord}).
 * The choices still name only the languages on this machine: a word carried over
 * from the older editor setting holds a bare code, and the one dictionary that
 * answers for it is the option it sits on.
 */
export function ProofingWordsDialog({
  onClose,
  languages,
}: {
  onClose: () => void
  languages: readonly ProofingLanguage[]
}) {
  const t = useT()
  const st = (key: string, params?: Record<string, string | number>) => t(NS, key, params)
  const { data } = useProofingPersonalWords()
  const addWord = useAddPersonalWord()
  const removeWord = useRemovePersonalWord()
  const rescopeWord = useRescopePersonalWord()
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")

  const words = data?.words ?? NO_WORDS

  // Alphabetical, so a word is where the eye looks for it. The host keeps its own
  // newest-first order for the settings page preview; here scanning wins.
  const sorted = useMemo(() => [...words].sort((a, b) => a.word.localeCompare(b.word)), [words])

  // Per word, because only a word stored under a scope no installed language
  // answers for adds an option, and it adds it to its own row alone.
  const scopesFor = (stored: string | null) =>
    scopeValues(stored, languages).map((value) => ({
      value,
      label: value === ANY_LANGUAGE ? st("ProofingScopeAll") : scopeLabel(value, languages),
    }))

  const needle = query.trim().toLowerCase()
  const rows = needle.length === 0 ? sorted : sorted.filter((entry) => entry.word.toLowerCase().includes(needle))

  // Every failing write surfaces the same way; the add path adds its own recovery.
  const warnError = { onError: () => toast.warning(t("Common", "Error")) }

  function add() {
    const word = draft.trim()
    if (word.length === 0) return
    const before = words.length
    setDraft("")
    addWord.mutate(
      { word },
      {
        // The host keys a word by its scope and this add is always unscoped, so a
        // list that did not grow means the word was already accepted.
        onSuccess: (next) => {
          if (next.words.length === before) toast.info(st("ProofingPersonalAlreadyAdded"))
        },
        // Put the word back, but only if the field is still empty: the user may
        // have started the next one while the request was in flight.
        onError: () => {
          setDraft((current) => (current.length === 0 ? word : current))
          toast.warning(t("Common", "Error"))
        },
      },
    )
  }

  function rescope(word: string, stored: string | null, chosen: string) {
    const change = scopeChange(stored, chosen, languages)
    if (!change) return
    rescopeWord.mutate({ word, from: change.from, to: change.to }, warnError)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={st("ProofingPersonalTitle")}
      subtitle={st("ProofingPersonalSubtitle")}
      closeLabel={t("Common", "Close")}
      width={560}
      headerRight={
        words.length > SEARCH_FROM ? (
          <div className="flex h-8 w-[172px] shrink-0 items-center gap-2 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
            <AppIcon name="search" size={14} className="shrink-0 text-ink-icon" strokeWidth={1.7} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={st("ProofingPersonalSearch")}
              aria-label={st("ProofingPersonalSearch")}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        ) : undefined
      }
    >
      {/* No h-full: the dialog body is a flex row of a definite height, and a percentage
          height against it resolves to the content instead, which grew the list past the
          dialog and left nothing for the scroller to scroll. */}
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-5 pb-1">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
            <AppIcon name="plus" size={15} className="shrink-0 text-ink-icon" strokeWidth={1.8} />
            <input
              autoFocus
              value={draft}
              maxLength={100}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") add()
              }}
              placeholder={st("ProofingPersonalPlaceholder")}
              aria-label={st("ProofingPersonalPlaceholder")}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <Button disabled={draft.trim().length === 0} onClick={add}>
            {st("ProofingPersonalAdd")}
          </Button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-3">
              {words.length === 0 ? st("ProofingPersonalEmpty") : st("ProofingPersonalNoMatchFormat", { 0: query })}
            </p>
          ) : (
            <div className="[&>*+*]:border-t [&>*+*]:border-line-soft">
              {rows.map((entry) => (
                <div key={`${entry.word}:${entry.language ?? ""}`} className="flex items-center gap-2 py-1.5">
                  <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{entry.word}</p>

                  <SelectControl
                    value={resolveScope(entry.language, languages)}
                    choices={scopesFor(entry.language)}
                    label={st("ProofingScopeLabelFormat", { 0: entry.word })}
                    className="h-7 min-w-0 max-w-[148px] text-[12.5px] text-ink-3 shadow-none"
                    onChange={(next) => rescope(entry.word, entry.language, next)}
                  />

                  <button
                    type="button"
                    onClick={() => removeWord.mutate({ word: entry.word, language: entry.language }, warnError)}
                    aria-label={st("ProofingPersonalRemoveFormat", { 0: entry.word })}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-danger-wash hover:text-danger"
                  >
                    <AppIcon name="trash-2" size={15} strokeWidth={1.7} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
