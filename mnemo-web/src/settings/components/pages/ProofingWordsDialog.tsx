import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useT } from "@/i18n/useT"
import { proofingClient, useInvalidateProofing, useProofingPersonalWords } from "@/notes/proofing/status"
import type { ProofingLanguage } from "@/notes/proofing/types"
import { toast } from "@/stores/toast"

import { SelectControl } from "../controls/SelectControl"
import { ANY_LANGUAGE, scopeLabel, scopeValues } from "./proofing-languages"

const NS = "Settings"

/** Up to this many the list is short enough to scan, and a search field is one control too many. */
const SEARCH_FROM = 6

/**
 * The words the checker has been told to accept.
 *
 * A word's scope is stored as the string it was added with, and removal matches
 * that string exactly, so changing a scope is a removal at the old one followed
 * by an add at the new one rather than an edit. Words carried over from the
 * older editor setting hold a bare code, which is why the select is built from
 * what the words store as well as from the catalogue.
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
  const invalidate = useInvalidateProofing()
  const { data } = useProofingPersonalWords()
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)

  const words = data?.words ?? []
  const scopes = scopeValues(words, languages).map((value) => ({
    value,
    label: value === ANY_LANGUAGE ? st("ProofingScopeAll") : scopeLabel(value, languages),
  }))

  const needle = query.trim().toLowerCase()
  const rows = needle.length === 0 ? words : words.filter((entry) => entry.word.toLowerCase().includes(needle))

  // Reread whether or not the work succeeded: a scope change is a removal and an
  // add, so a failure can land between the two and leave the list showing a word
  // the host no longer holds.
  async function run(work: () => Promise<void>) {
    setBusy(true)
    try {
      await work()
    } catch {
      toast.warning(t("Common", "Error"))
    } finally {
      setBusy(false)
      invalidate()
    }
  }

  function add() {
    const word = draft.trim()
    if (word.length === 0) return
    setDraft("")
    void run(() => proofingClient.addPersonalWord(word))
  }

  function rescope(word: string, from: string | null, to: string) {
    const next = to === ANY_LANGUAGE ? null : to
    if (next === from) return
    void run(async () => {
      await proofingClient.removePersonalWord(word, from)
      await proofingClient.addPersonalWord(word, next)
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={st("ProofingPersonalTitle")}
      subtitle={st("ProofingPersonalSubtitle")}
      closeLabel={t("Common", "Close")}
      width={560}
    >
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex shrink-0 items-center gap-2 px-5">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
            <AppIcon name="plus" size={15} className="shrink-0 text-ink-icon" strokeWidth={1.8} />
            <input
              autoFocus
              value={draft}
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
          <Button disabled={busy || draft.trim().length === 0} onClick={add}>
            {st("ProofingPersonalAdd")}
          </Button>
        </div>

        {words.length > SEARCH_FROM && (
          <div className="mx-5 mt-2 flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 shadow-[0_0_0_1px_var(--line-soft)] focus-within:shadow-[0_0_0_1px_var(--line)]">
            <AppIcon name="search" size={14} className="shrink-0 text-ink-icon" strokeWidth={1.7} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={st("ProofingPersonalSearch")}
              aria-label={st("ProofingPersonalSearch")}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        )}

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-3">
              {words.length === 0 ? st("ProofingPersonalEmpty") : st("ProofingPersonalNoMatchFormat", { 0: query })}
            </p>
          ) : (
            <div className="[&>*+*]:border-t [&>*+*]:border-line-soft">
              {rows.map((entry) => (
                <div key={`${entry.word}:${entry.language ?? ""}`} className="flex items-center gap-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{entry.word}</p>

                  <SelectControl
                    value={entry.language ?? ANY_LANGUAGE}
                    choices={scopes}
                    disabled={busy}
                    label={st("ProofingScopeLabelFormat", { 0: entry.word })}
                    className="w-[168px]"
                    onChange={(next) => rescope(entry.word, entry.language, next)}
                  />

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => proofingClient.removePersonalWord(entry.word, entry.language))}
                    aria-label={st("ProofingPersonalRemoveFormat", { 0: entry.word })}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-danger-wash hover:text-danger disabled:pointer-events-none disabled:opacity-45"
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
