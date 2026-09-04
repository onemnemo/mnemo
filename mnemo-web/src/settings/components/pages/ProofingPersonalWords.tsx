import { useState, type FormEvent } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { proofingClient, useInvalidateProofing, useProofingPersonalWords } from "@/notes/proofing/status"
import { toast } from "@/stores/toast"

import { Section } from "../kit"

/**
 * The words the checker has been told to accept everywhere.
 *
 * Kept beside the language list rather than behind a dialog: this is the one
 * place a word added from the editor by mistake can be taken back out, and
 * hiding that behind a second surface is what makes people distrust the "add"
 * button in the first place.
 */
export function ProofingPersonalWords() {
  const t = useT()
  const st = (key: string, params?: Record<string, string | number>) => t("Settings", key, params)
  const invalidate = useInvalidateProofing()
  const { data } = useProofingPersonalWords()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  const words = data?.words ?? []

  async function run(work: () => Promise<void>) {
    setBusy(true)
    try {
      await work()
      invalidate()
    } catch {
      toast.warning(t("Common", "Error"))
    } finally {
      setBusy(false)
    }
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const word = draft.trim()
    if (word.length === 0) return
    setDraft("")
    void run(() => proofingClient.addPersonalWord(word))
  }

  return (
    <Section title={st("ProofingPersonalTitle")} note={st("ProofingPersonalCountFormat", { 0: words.length })}>
      <div className="py-3.5">
        <form className="flex gap-2" onSubmit={add}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={st("ProofingPersonalPlaceholder")}
            aria-label={st("ProofingPersonalPlaceholder")}
            spellCheck={false}
            className="h-8 flex-1 rounded-lg bg-canvas-sunken px-2.5 text-[13px] text-ink outline-none shadow-[0_0_0_1px_var(--line)] placeholder:text-ink-3"
          />
          <Button type="submit" disabled={busy || draft.trim().length === 0}>
            {st("ProofingPersonalAdd")}
          </Button>
        </form>

        {words.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-ink-3">{st("ProofingPersonalEmpty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {words.map((entry) => (
              <li key={`${entry.word}:${entry.language ?? ""}`} className="flex items-center justify-between gap-4 py-1.5">
                <span className="min-w-0 truncate text-[13px] text-ink">{entry.word}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`${st("ProofingPersonalRemove")}: ${entry.word}`}
                  onClick={() => void run(() => proofingClient.removePersonalWord(entry.word, entry.language))}
                  icon={<AppIcon name="x" size={14} />}
                >
                  {st("ProofingPersonalRemove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}
