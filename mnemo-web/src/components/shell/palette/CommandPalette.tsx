import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { AppIcon } from "@/components/icon/AppIcon"
import { PaletteRow } from "@/components/shell/palette/PaletteRow"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { getActions } from "@/search/actions"
import { defaultGroups, runSearch, scopeFor } from "@/search/score"
import type { ActionContext, Group, Hit, Scope } from "@/search/types"
import { useSearchPool } from "@/search/useSearchPool"
import { useAiEnabled } from "@/settings/aiEnabled"
import { usePaletteStore } from "@/stores/palette"
import { useShellStore } from "@/stores/shell"
import { useSomaStore } from "@/stores/soma"
import { useThemeStore } from "@/stores/theme"

/**
 * The global search.
 *
 * Search first, commands second, which is why it opens on the magnifier and not
 * on a `>` prompt. Everything is one index, and the two scopes (`>` actions,
 * `#` tags) are the whole of the advanced interface.
 *
 * Two rules do most of the work. It is useful before you type: recents and
 * destinations, not a blank box. And where the assistant is available it never
 * dead-ends: the last row is Soma, so a search that finds nothing still goes
 * somewhere.
 */
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  // The body is a separate component so that opening the palette is what pays for
  // loading the note and deck lists, rather than starting the app.
  return open ? <PaletteBody /> : null
}

function PaletteBody() {
  const t = useT()
  const aiEnabled = useAiEnabled()
  const close = () => usePaletteStore.getState().setOpen(false)

  const [raw, setRaw] = useState("")
  const [scope, setScope] = useState<Scope>(null)
  const [active, setActive] = useState(0)
  /** Session-local, so the palette remembers what you opened last time. */
  const recentRef = useRef<Hit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const indexed = useSearchPool()
  const pool = useMemo(() => [...getActions(t), ...indexed], [indexed, t])
  const scopeLabel: Record<"actions" | "tags", string> = {
    actions: t("GlobalSearch", "ScopeActions"),
    tags: t("GlobalSearch", "ScopeTags"),
  }

  const groups: Group[] = useMemo(() => {
    if (!raw.trim() && !scope) return defaultGroups(pool, recentRef.current)
    return runSearch(pool, raw, scope)
  }, [pool, raw, scope])

  // One flat list underneath the headings: arrows should never stop on a group
  // label, and the index has to survive regrouping as the query changes.
  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups])
  // The last-resort row goes where Soma is, so it can only be offered where Soma is:
  // with the assistant unavailable it opened a dock that renders nothing.
  const askRow = aiEnabled && raw.trim().length > 0
  const total = flat.length + (askRow ? 1 : 0)

  useEffect(() => setActive(0), [raw, scope])

  useEffect(() => {
    // After paint, or the browser hands focus back to whatever had it.
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(handle)
  }, [])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active, groups])

  const ctx: ActionContext = {
    navigate: (href) => {
      window.location.hash = href
    },
    toggleTheme: () => {
      // Toggling off the theme on screen rather than off the preference: from "system"
      // it means "the other one to what I am looking at", which is also what makes the
      // toggle an explicit choice and stops the OS overriding it a moment later.
      const { theme, setPreference } = useThemeStore.getState()
      setPreference(theme === "dark" ? "light" : "dark")
    },
    toggleSidebar: () => useShellStore.getState().toggleSidebar(),
    askSoma: () => useSomaStore.getState().setDockOpen(true),
  }

  function choose(index: number): void {
    if (askRow && index === flat.length) {
      close()
      ctx.askSoma(raw.trim())
      return
    }

    const hit = flat[index]
    if (!hit) return
    close()

    // Recents are what you opened, not what you searched for. Actions and routes
    // are excluded: "Toggle theme" at the top of a fresh palette is noise.
    if (hit.kind !== "action" && hit.kind !== "route") {
      recentRef.current = [hit, ...recentRef.current.filter((other) => other.id !== hit.id)].slice(0, 4)
    }

    if (hit.run) hit.run(ctx)
    else if (hit.href) ctx.navigate(hit.href)
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault()
      // Escape peels one layer at a time: the scope chip first, the dialog
      // second. Closing outright would throw away the query you just refined.
      if (scope) setScope(null)
      else close()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => (total ? (i + 1) % total : 0))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => (total ? (i - 1 + total) % total : 0))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      choose(active)
      return
    }
    if (event.key === "Backspace" && !raw && scope) {
      event.preventDefault()
      setScope(null)
    }
  }

  function onChange(value: string): void {
    // A leading `>` or `#` becomes a chip instead of a character: the prefix is a
    // way to type a mode, not something you should have to look at afterwards.
    if (!scope && !raw) {
      const next = scopeFor(value.slice(0, 1))
      if (next) {
        setScope(next)
        setRaw(value.slice(1))
        return
      }
    }
    setRaw(value)
  }

  let index = -1

  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[160] flex justify-center px-4 pt-[13vh]">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={close} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Topbar", "SearchLabel")}
        onKeyDown={onKeyDown}
        className="animate-pop-in relative flex h-max max-h-[68vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-canvas shadow-pop"
      >
        <div className="flex shrink-0 items-center gap-2.5 px-4">
          <AppIcon name="search" size={18} strokeWidth={1.8} className="shrink-0 text-ink-icon" />

          {scope && (
            <span className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-frame-active pl-2 pr-1 text-[12.5px] font-medium text-ink">
              {scopeLabel[scope]}
              <button
                type="button"
                onClick={() => {
                  setScope(null)
                  inputRef.current?.focus()
                }}
                aria-label={t("Common", "Close")}
                className="grid size-4 place-items-center rounded text-ink-3 hover:text-ink"
              >
                <AppIcon name="x" size={12} strokeWidth={2.4} />
              </button>
            </span>
          )}

          <input
            ref={inputRef}
            value={raw}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("Topbar", "SearchPlaceholder")}
            className="h-[54px] min-w-0 flex-1 bg-transparent text-[15px] tracking-[-0.01em] text-ink outline-none placeholder:text-ink-3"
          />

          <kbd className="shrink-0 rounded-md px-1.5 py-1 font-sans text-[11px] text-ink-3 shadow-[0_0_0_1px_var(--line-soft)]">
            Esc
          </kbd>
        </div>

        <div className="h-px shrink-0 bg-line-soft" />

        <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {groups.length === 0 && !askRow && (
            <p className="px-3 py-8 text-center text-[13px] text-ink-3">{t("GlobalSearch", "NoResults")}</p>
          )}

          {groups.map((group) => (
            <div key={group.key}>
              <p className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                {group.label}
              </p>
              {group.hits.map((hit) => {
                index += 1
                return (
                  <PaletteRow
                    key={hit.id}
                    hit={hit}
                    query={raw}
                    active={index === active}
                    index={index}
                    onHover={setActive}
                    onPick={choose}
                  />
                )
              })}
            </div>
          ))}

          {askRow && <AskSomaRow query={raw.trim()} active={active === flat.length} onHover={() => setActive(flat.length)} onPick={() => choose(flat.length)} />}
        </div>

        <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-line-soft px-3 text-[11.5px] text-ink-3">
          <Hint keys="↑↓" what={t("GlobalSearch", "HintMove")} />
          <Hint keys="↵" what={t("GlobalSearch", "HintOpen")} />
          <div className="flex-1" />
          <Hint keys=">" what={scopeLabel.actions} />
          <Hint keys="#" what={scopeLabel.tags} />
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function AskSomaRow({
  query,
  active,
  onHover,
  onPick,
}: {
  query: string
  active: boolean
  onHover: () => void
  onPick: () => void
}) {
  const t = useT()
  return (
    <>
      <div className="mx-1.5 my-1.5 h-px bg-line-soft" />
      <button
        type="button"
        data-active={active}
        onPointerEnter={onHover}
        onClick={onPick}
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors",
          active && "bg-frame-hover",
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-wash">
          <AppIcon name="orbit" size={14} strokeWidth={1.8} className="text-accent-ink" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
          {t("GlobalSearch", "AskSoma")} <span className="font-medium">{query}</span>
        </span>
        {active && <AppIcon name="corner-down-left" size={14} strokeWidth={1.8} className="shrink-0 text-ink-3" />}
      </button>
    </>
  )
}

function Hint({ keys, what }: { keys: string; what: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded px-1 py-px font-sans text-[11px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)]">
        {keys}
      </kbd>
      {what}
    </span>
  )
}
