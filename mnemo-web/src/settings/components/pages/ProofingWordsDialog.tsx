import { useMemo, useState } from "react"

import { ApiError } from "@/api/client"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSectionLabel, MenuTrigger } from "@/components/ui/menu"
import { ListState } from "@/components/ui/list-state"
import { Modal } from "@/components/ui/modal"
import { MODAL_MENU_CLASS } from "@/components/ui/modal-menu"
import { useT } from "@/i18n/useT"
import { languageNameLookup } from "@/notes/proofing/language-names"
import {
  useAddPersonalWord,
  useProofingPersonalWords,
  useRemovePersonalWord,
  useRescopePersonalWord,
} from "@/notes/proofing/status"
import type { PersonalWord, ProofingLanguage } from "@/notes/proofing/types"
import { toast } from "@/stores/toast"

import { ANY_LANGUAGE, resolveScope, scopeChange, scopeLabel, scopeValues } from "./proofing-languages"

const NS = "Settings"

/** Up to this many the list is short enough to scan, and a search field is one control too many. */
const SEARCH_FROM = 6

/** One reference for "no words", so the memo below does not re-run every render. */
const NO_WORDS: readonly PersonalWord[] = []

/** A row's identity while a write about it is in flight. The scope is part of it: the host keys on both. */
function rowKey(word: string, language: string | null): string {
  return `${word}:${language ?? ""}`
}

/**
 * The words the checker has been told to accept.
 *
 * Adding and finding are deliberately kept apart: the add field is the body's
 * first control, and the search sits up in the dialog's header, because two
 * text fields stacked in the same corner read as one control that cannot decide
 * what it does.
 *
 * Scope lives in a row's overflow menu rather than in a control of its own.
 * Nearly every word is added for every language, so a picker on every row taxes
 * the common case with the rare one, and a row says which language it is for
 * only when that is not the answer every other row gives. The menu takes
 * {@link MODAL_MENU_CLASS}: menus portal to the body, so without it one opened
 * from in here paints behind the dialog.
 *
 * A word's scope is stored as the string it was added with, and removal matches
 * that string exactly, so changing a scope is an add at the new one followed by
 * a removal at the old one rather than an edit (see {@link useRescopePersonalWord}).
 * That is two calls, so the row it runs on takes no further input until it
 * settles: interleaving two of them can leave the word under both scopes or
 * under neither. The choices still name only the languages on this machine: a
 * word carried over from the older editor setting holds a bare code, and the one
 * dictionary that answers for it is the option it sits on.
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
  const named = languageNameLookup(t)
  const { data, isPending, isError, refetch } = useProofingPersonalWords()
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState<readonly string[]>([])

  const words = data?.words ?? NO_WORDS

  // Alphabetical, so a word is where the eye looks for it. The host keeps its own
  // newest-first order for the settings page preview; here scanning wins.
  const sorted = useMemo(() => [...words].sort((a, b) => a.word.localeCompare(b.word)), [words])

  const needle = query.trim().toLowerCase()
  const rows = needle.length === 0 ? sorted : sorted.filter((entry) => entry.word.toLowerCase().includes(needle))

  function hold(key: string) {
    setBusy((current) => [...current, key])
  }

  function release(key: string) {
    setBusy((current) => current.filter((entry) => entry !== key))
  }

  /** Every failure that is not one the host explains reads the same way. */
  function warn(error: unknown) {
    const code = error instanceof ApiError ? error.code : undefined
    if (code === "proofing_word_not_checkable") toast.warning(st("ProofingPersonalNotAWord"))
    else if (code === "proofing_word_limit") toast.warning(st("ProofingPersonalFull"))
    else toast.warning(t("Common", "Error"))
  }

  /** A short receipt with the way back, so a one click write is not a one click loss. */
  function receipt(title: string, undo: () => void) {
    toast.info(title, { primary: { label: t("Common", "Undo"), onClick: undo } })
  }

  // The way back from a receipt is a write of its own, so taking one back never
  // reads as a fresh add or removal and never offers a receipt in turn.
  const dropWord = useRemovePersonalWord({ onError: warn })
  const restoreWord = useAddPersonalWord({ onError: warn })

  const addWord = useAddPersonalWord({
    onSuccess: (next, { word }) => {
      if (next.outcome === "alreadyPresent") {
        toast.info(st("ProofingPersonalAlreadyAdded"))
        return
      }
      receipt(st("ProofingPersonalAddedFormat", { 0: word }), () => dropWord.mutate({ word, language: null }))
    },
    // Put the word back, but only if the field is still empty: the user may have
    // started the next one while the request was in flight.
    onError: (error, { word }) => {
      setDraft((current) => (current.length === 0 ? word : current))
      warn(error)
    },
  })

  const removeWord = useRemovePersonalWord({
    onSuccess: (_next, { word, language }) => {
      receipt(st("ProofingPersonalRemovedFormat", { 0: word }), () => restoreWord.mutate({ word, language }))
    },
    onError: warn,
    onSettled: ({ word, language }) => release(rowKey(word, language)),
  })

  const rescopeWord = useRescopePersonalWord({
    onError: warn,
    onSettled: ({ word, from }) => release(rowKey(word, from)),
  })

  function add() {
    const word = draft.trim()
    if (word.length === 0) return
    setDraft("")
    addWord.mutate({ word })
  }

  function remove(entry: PersonalWord) {
    hold(rowKey(entry.word, entry.language))
    removeWord.mutate({ word: entry.word, language: entry.language })
  }

  function rescope(entry: PersonalWord, chosen: string) {
    const change = scopeChange(entry.language, chosen, languages)
    if (!change) return
    hold(rowKey(entry.word, entry.language))
    rescopeWord.mutate({ word: entry.word, from: change.from, to: change.to })
  }

  // Per word, because only a word stored under a scope no installed language
  // answers for adds an option, and it adds it to its own row alone.
  const scopesFor = (stored: string | null) =>
    scopeValues(stored, languages).map((value) => ({
      value,
      label: value === ANY_LANGUAGE ? st("ProofingScopeAll") : scopeLabel(value, languages, named),
    }))

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
          {/* An unanswered list and an empty one are not the same thing, and a failed one
              is a third. Telling a reader whose dictionary is full that they have no words
              invites them to add every one of them back. */}
          {isPending ? (
            <ListState message={st("ProofingPersonalLoading")} />
          ) : isError ? (
            <ListState
              message={st("ProofingPersonalFailed")}
              action={{ label: t("Common", "Retry"), onClick: () => void refetch() }}
            />
          ) : rows.length === 0 ? (
            <ListState
              message={
                words.length === 0 ? st("ProofingPersonalEmpty") : st("ProofingPersonalNoMatchFormat", { 0: query })
              }
            />
          ) : (
            <div className="[&>*+*]:border-t [&>*+*]:border-line-soft">
              {rows.map((entry) => {
                const scope = resolveScope(entry.language, languages)
                const pending = busy.includes(rowKey(entry.word, entry.language))
                return (
                  <div key={rowKey(entry.word, entry.language)} className="flex items-center gap-2 py-1.5">
                    <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{entry.word}</p>

                    {scope !== ANY_LANGUAGE && (
                      <span className="shrink-0 truncate text-[12px] text-ink-3">{scopeLabel(scope, languages, named)}</span>
                    )}

                    <Menu>
                      <MenuTrigger asChild>
                        <button
                          type="button"
                          disabled={pending}
                          aria-label={st("ProofingScopeLabelFormat", { 0: entry.word })}
                          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-45"
                        >
                          <AppIcon name="ellipsis" size={15} strokeWidth={1.7} />
                        </button>
                      </MenuTrigger>
                      <MenuContent align="end" className={MODAL_MENU_CLASS}>
                        <MenuSectionLabel>{st("ProofingScopeAppliesTo")}</MenuSectionLabel>
                        <MenuRadioGroup value={scope} onValueChange={(next) => rescope(entry, next)}>
                          {scopesFor(entry.language).map((choice) => (
                            <MenuRadioItem key={choice.value} value={choice.value}>
                              {choice.label}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuContent>
                    </Menu>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(entry)}
                      aria-label={st("ProofingPersonalRemoveFormat", { 0: entry.word })}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-danger-wash hover:text-danger disabled:pointer-events-none disabled:opacity-45"
                    >
                      <AppIcon name="trash-2" size={15} strokeWidth={1.7} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
