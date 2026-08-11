import { useCallback, useEffect, useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Keycap } from "@/components/ui/keycap"
import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"
import { deleteKeybindOverride, fetchKeybinds, putKeybindOverride, resetKeybindOverrides } from "@/keybinds/api"
import { chordFromEvent, formatChord } from "@/keybinds/chord"
import { findConflicts } from "@/keybinds/conflicts"
import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"
import { cn } from "@/lib/utils"
import { dialog } from "@/stores/dialog"

// Action labels and categories resolve from the Keybinds namespace. A definition's own
// `namespace` field is its matching scope ("global", "editor"), not an i18n one.
const NS = "Keybinds"

/** Marks the control that arms a recording, so the cancel-on-click-away can spare it. */
const RECORD_ATTR = "data-keybind-record"

/**
 * The Keyboard page: every registered action, the keys it answers to, and a way to
 * change them.
 *
 * This replaces a modal. A shortcut catalogue is reference material, not a decision to
 * be made and dismissed: it is read alongside the app, searched, and left open while
 * several bindings get moved. A dialog is the wrong container for all three, and it
 * also meant the one surface that teaches the keyboard could not be reached from the
 * keyboard's own page.
 *
 * The server owns definitions and overrides, so every edit writes through and the
 * catalog is refetched: only the server can produce the merged result of manifest
 * defaults under user overrides.
 */
export function KeyboardPage() {
  const t = useT()
  const keybinds = useKeybindStore((s) => s.keybinds)
  const setKeybinds = useKeybindStore((s) => s.setKeybinds)

  const [query, setQuery] = useState("")
  const [recording, setRecording] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const conflicts = useMemo(() => findConflicts(keybinds), [keybinds])
  const labels = useMemo(() => labelsFor(keybinds, t), [keybinds, t])
  const overrides = keybinds.filter((action) => action.isOverridden).length

  const sections = useMemo(() => groupByCategory(filterBy(keybinds, query, labels), t), [keybinds, query, labels, t])

  // Stable, so arming the recorder does not re-subscribe its listener on every render.
  const withRefresh = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true)
      try {
        await work()
        setKeybinds(await fetchKeybinds())
      } finally {
        setBusy(false)
      }
    },
    [setKeybinds],
  )

  async function resetAll() {
    const confirmed = await dialog.confirm({
      title: t(NS, "keybindManager.resetAll"),
      message: t("Settings", "KeyboardResetAllMessage"),
      confirmLabel: t(NS, "keybindManager.resetAll"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
    if (confirmed) await withRefresh(resetKeybindOverrides)
  }

  // Capture phase, and preventDefault on everything: while recording, Ctrl+K has to land
  // in this row rather than open the search it is currently bound to. A settings page is
  // not a modal, so the window-level keymap listener stays armed and nothing else would
  // hold it off.
  useEffect(() => {
    if (!recording) return

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") {
        setRecording(null)
        return
      }
      const chord = chordFromEvent(event)
      // Modifiers on their own, and keys with no token, mean "still listening".
      if (!chord) return
      setRecording(null)
      void withRefresh(() => putKeybindOverride(recording, [{ kind: "Chord", chord }]))
    }

    // Anywhere but the control that armed it: that one owns its own toggle, and
    // cancelling here first would leave its click to immediately re-arm.
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.(`[${RECORD_ATTR}]`)) return
      setRecording(null)
    }

    document.addEventListener("keydown", onKey, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
    }
  }, [recording, withRefresh])

  const conflicted = conflicts.size

  return (
    <>
      <div className="mt-6 flex items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(NS, "keybindManager.searchPlaceholder")}
            aria-label={t(NS, "keybindManager.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <Button
          variant="ghost"
          size="md"
          disabled={busy || overrides === 0}
          onClick={() => void resetAll()}
          icon={<AppIcon name="rotate-ccw" size={14} strokeWidth={1.7} />}
        >
          {overrides > 0
            ? t("Settings", "KeyboardResetCountFormat", { 0: overrides })
            : t("Settings", "KeyboardReset")}
        </Button>
      </div>

      {conflicted > 0 ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-danger-wash px-3 py-2.5">
          <AppIcon name="triangle-alert" size={16} strokeWidth={1.8} className="mt-px shrink-0 text-danger" />
          <p className="text-[12.5px] leading-snug text-ink-2">
            {t("Settings", "KeyboardConflictsFormat", { 0: conflicted })}
          </p>
        </div>
      ) : null}

      {sections.length === 0 ? (
        <p className="mt-8 text-[13px] text-ink-3">{t("Settings", "KeyboardNoMatchFormat", { 0: query })}</p>
      ) : null}

      {sections.map(([category, actions]) => (
        <section key={category} className="mt-8">
          <h2 className="text-[12.5px] font-medium text-ink-3">{category}</h2>
          <div className="mt-1 [&>*+*]:border-t [&>*+*]:border-line-soft">
            {actions.map((action) => (
              <ActionRow
                key={action.actionId}
                action={action}
                label={labels.get(action.actionId) ?? action.actionId}
                clashesWith={(conflicts.get(action.actionId) ?? [])
                  .map((id) => labels.get(id) ?? id)
                  .join(", ")}
                recording={recording === action.actionId}
                busy={busy}
                onToggleRecord={() =>
                  setRecording((current) => (current === action.actionId ? null : action.actionId))
                }
                onReset={() => void withRefresh(() => deleteKeybindOverride(action.actionId))}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function ActionRow({
  action,
  label,
  clashesWith,
  recording,
  busy,
  onToggleRecord,
  onReset,
}: {
  action: Keybind
  label: string
  clashesWith: string
  recording: boolean
  busy: boolean
  onToggleRecord: () => void
  onReset: () => void
}) {
  const t = useT()
  const chord = action.bindings.find((b) => b.kind === "Chord" && b.chord)?.chord ?? null

  return (
    <div className="group/kb flex items-center justify-between gap-6 py-2">
      <div className="min-w-0">
        <p className={cn("truncate text-[13.5px] text-ink", !action.enabled && "text-ink-3 line-through")}>
          {label}
        </p>
        {clashesWith ? (
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-danger">
            <AppIcon name="triangle-alert" size={12} strokeWidth={2} />
            {t("Settings", "KeyboardAlsoBoundFormat", { 0: clashesWith })}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          {...{ [RECORD_ATTR]: "" }}
          onClick={onToggleRecord}
          disabled={busy}
          title={t("Keybinds", "keybindManager.editShortcut")}
          className={cn(
            "flex h-8 items-center rounded-lg px-1.5 transition-colors disabled:opacity-45",
            recording ? "bg-accent-wash" : "hover:bg-frame-hover",
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {recording ? (
            <span className="px-1 text-[12.5px] font-medium text-accent-ink">
              {t("Keybinds", "keybindManager.editorPressShortcut")}
            </span>
          ) : (
            <Keycap chord={chord} muted={!action.enabled} />
          )}
        </button>

        {/* Only meaningful once a binding has moved, so it only exists then, and it stays
            out of the way until the row is hovered. */}
        <button
          type="button"
          onClick={onReset}
          disabled={busy || !action.isOverridden}
          title={t("Keybinds", "keybindManager.editorRestoreDefault")}
          aria-label={t("Keybinds", "keybindManager.editorRestoreDefault")}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-ink-3 transition-opacity",
            "hover:bg-frame-hover hover:text-ink",
            action.isOverridden
              ? "opacity-0 group-hover/kb:opacity-100 focus-visible:opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          <AppIcon name="rotate-ccw" size={14} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}

/** Every action's display label, resolved once so search and conflict lines share it. */
function labelsFor(keybinds: readonly Keybind[], t: TranslateFn): Map<string, string> {
  return new Map(keybinds.map((action) => [action.actionId, action.labelKey ? t(NS, action.labelKey) : action.actionId]))
}

/** Actions whose label, description or current chord contains the query. */
function filterBy(keybinds: readonly Keybind[], query: string, labels: Map<string, string>): Keybind[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...keybinds]

  return keybinds.filter((action) => {
    const chords = action.bindings
      .filter((b) => b.kind === "Chord" && b.chord)
      .map((b) => formatChord(b.chord as string))
      .join(" ")
    return `${labels.get(action.actionId) ?? ""}\n${action.actionId}\n${chords}`
      .toLocaleLowerCase()
      .includes(needle)
  })
}

function groupByCategory(keybinds: readonly Keybind[], t: TranslateFn): [string, Keybind[]][] {
  const groups = new Map<string, Keybind[]>()
  for (const action of keybinds) {
    const category = action.categoryKey ? t(NS, action.categoryKey) : action.namespace
    const bucket = groups.get(category)
    if (bucket) bucket.push(action)
    else groups.set(category, [action])
  }
  return [...groups]
}
