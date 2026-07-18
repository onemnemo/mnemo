import { Dialog } from "radix-ui"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"
import { cn } from "@/lib/utils"
import { dialog } from "@/stores/dialog"

import { deleteKeybindOverride, fetchKeybinds, putKeybindOverride, resetKeybindOverrides } from "../api"
import { formatChord } from "../chord"
import { useKeybindStore } from "../store"
import type { Keybind } from "../types"
import { ChordCapture } from "./ChordCapture"
import { useKeybindManagerStore } from "./store"

// Action labels and categories resolve from the Keybinds namespace. A definition's
// own `namespace` field is its matching scope ("global", "editor"), not an i18n one.
const NS = "Keybinds"

/**
 * The keybind manager: every registered action, its current chord, and a way to
 * rebind or restore it.
 *
 * The server owns definitions and overrides, so each edit writes through and the
 * catalog is refetched — only the server can produce the merged result of manifest
 * defaults under user overrides.
 */
export function KeybindManagerOverlay() {
  const isOpen = useKeybindManagerStore((s) => s.isOpen)
  const close = useKeybindManagerStore((s) => s.close)
  const t = useT()

  const keybinds = useKeybindStore((s) => s.keybinds)
  const setKeybinds = useKeybindStore((s) => s.setKeybinds)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const conflicts = useMemo(() => findConflicts(keybinds), [keybinds])
  const grouped = useMemo(() => groupByCategory(keybinds, t), [keybinds, t])

  async function withRefresh(work: () => Promise<void>) {
    setBusy(true)
    try {
      await work()
      setKeybinds(await fetchKeybinds())
    } finally {
      setBusy(false)
    }
  }

  async function restoreAll() {
    const confirmed = await dialog.confirm({
      title: t(NS, "keybindManager.resetAll"),
      message: t(NS, "keybindManager.subtitle"),
      confirmLabel: t(NS, "keybindManager.resetAll"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
    if (confirmed) await withRefresh(resetKeybindOverrides)
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[calc(100%-3rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-[var(--overlay-background)] shadow-elevation-4 focus:outline-none">
          <div className="flex items-start justify-between gap-4 border-b p-5 pb-4">
            <div>
              <Dialog.Title className="text-heading-6 font-semibold text-text-primary">
                {t("Settings", "KeybindManager")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-body-small text-text-tertiary">
                {t(NS, "keybindManager.subtitle")}
              </Dialog.Description>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void restoreAll()}>
              {t(NS, "keybindManager.resetAll")}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
            {conflicts.size > 0 ? (
              <p className="mt-3 rounded-lg bg-surface-subtle p-2.5 text-body-extra-small text-text-tertiary">
                {t(NS, "keybindManager.conflictsHeader")}
              </p>
            ) : null}

            {grouped.map(([category, actions]) => (
              <section key={category} className="mt-4 first:mt-2">
                <h3 className="mb-1 text-micro font-semibold uppercase tracking-[1px] text-text-faded">
                  {category}
                </h3>
                {actions.map((action) => (
                  <KeybindRow
                    key={action.actionId}
                    action={action}
                    conflicted={conflicts.has(action.actionId)}
                    capturing={capturing === action.actionId}
                    busy={busy}
                    onCapture={() => setCapturing(action.actionId)}
                    onCancelCapture={() => setCapturing(null)}
                    onChord={(chord) => {
                      setCapturing(null)
                      void withRefresh(() => putKeybindOverride(action.actionId, [{ kind: "Chord", chord }]))
                    }}
                    onRestore={() => void withRefresh(() => deleteKeybindOverride(action.actionId))}
                  />
                ))}
              </section>
            ))}
          </div>

          <div className="flex items-center justify-between border-t p-4">
            <span className="text-micro text-text-faded">
              {t(NS, "keybindManager.footerCount", { 0: keybinds.length, 1: keybinds.length })}
            </span>
            <Dialog.Close asChild>
              <Button size="sm">{t(NS, "keybindManager.close")}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function KeybindRow({
  action,
  conflicted,
  capturing,
  busy,
  onCapture,
  onCancelCapture,
  onChord,
  onRestore,
}: {
  action: Keybind
  conflicted: boolean
  capturing: boolean
  busy: boolean
  onCapture: () => void
  onCancelCapture: () => void
  onChord: (chord: string) => void
  onRestore: () => void
}) {
  const t = useT()
  const chord = action.bindings.find((b) => b.kind === "Chord" && b.chord)?.chord

  return (
    <div className="flex items-center gap-3 border-b border-divider-subtle py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-body-small text-text-primary",
            !action.enabled && "text-text-faded line-through",
          )}
        >
          {action.labelKey ? t(NS, action.labelKey) : action.actionId}
        </div>
        {action.descriptionKey ? (
          <div className="truncate text-micro text-text-tertiary">{t(NS, action.descriptionKey)}</div>
        ) : null}
      </div>

      {capturing ? (
        <ChordCapture onChord={onChord} onCancel={onCancelCapture} />
      ) : (
        <>
          <kbd
            className={cn(
              "shrink-0 rounded-sm border bg-surface-subtle px-2 py-1 text-micro text-text-secondary",
              // A chord two enabled actions share stops being predictable for both.
              conflicted && "border-[var(--destructive-button-color)] text-[var(--destructive-button-color)]",
            )}
          >
            {chord ? formatChord(chord) : "—"}
          </kbd>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCapture}>
            {t(NS, "keybindManager.editShortcut")}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRestore}>
            {t(NS, "keybindManager.editorRestoreDefault")}
          </Button>
        </>
      )}
    </div>
  )
}

/** Actions bound to a chord another enabled action already uses. */
function findConflicts(keybinds: Keybind[]): Set<string> {
  const byChord = new Map<string, string[]>()
  for (const action of keybinds) {
    if (!action.enabled) continue
    for (const binding of action.bindings) {
      if (binding.kind !== "Chord" || !binding.chord) continue
      // Local actions in different namespaces never fire together, so a shared chord
      // is only a conflict within one scope.
      const slot = `${action.scope === "Global" ? "global" : action.namespace}:${binding.chord}`
      const owners = byChord.get(slot)
      if (owners) owners.push(action.actionId)
      else byChord.set(slot, [action.actionId])
    }
  }

  const conflicted = new Set<string>()
  for (const owners of byChord.values()) {
    if (owners.length > 1) owners.forEach((id) => conflicted.add(id))
  }
  return conflicted
}

function groupByCategory(keybinds: Keybind[], t: TranslateFn): [string, Keybind[]][] {
  const groups = new Map<string, Keybind[]>()
  for (const action of keybinds) {
    const category = action.categoryKey ? t(NS, action.categoryKey) : action.namespace
    const bucket = groups.get(category)
    if (bucket) bucket.push(action)
    else groups.set(category, [action])
  }
  return [...groups]
}
