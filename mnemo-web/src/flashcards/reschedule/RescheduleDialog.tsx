import { useMemo, useState, type ReactNode } from "react"

import { describeError } from "@/api/error-copy"
import type { CardViewDto, QueuePlace } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Segmented, type SegmentedOption } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast"

import { useDecksQuery } from "../api"
import { usePresetsQuery } from "../presets/api"
import { NumberStepper } from "../presets/controls/NumberStepper"
import { useNewQueueQuery, useRescheduleCards } from "./api"
import {
  applyLabelKey,
  availableModes,
  consequence,
  dayStartHourOf,
  DEFAULT_OPTIONS,
  initialMode,
  MAX_DAYS,
  rescheduleRequest,
  splitSelection,
  touchesNothing,
  type RescheduleMode,
  type RescheduleOptions,
} from "./reschedule"

const MODE_ICONS: Record<RescheduleMode, SegmentedOption<RescheduleMode>["icon"]> = {
  due: "calendar-clock",
  reset: "rotate-ccw",
  position: "list-ordered",
}

/** The stepper's ceiling when the queue size is not known yet. */
const POSITION_FALLBACK_MAX = 9999

/**
 * Moving cards in time: a due date, a start over, or a place in the new queue. One dialog for
 * the three, because they are three names for one intention; the mode list is filtered by what
 * the selection can take, and the sentence under the controls says what will happen.
 *
 * Mounted per opening rather than kept around with an `open` flag, so every control starts
 * from its default for each new selection.
 */
export function RescheduleDialog({
  views,
  onClose,
  onApplied,
}: {
  /** The selection. The dialog is a function of it. */
  views: CardViewDto[]
  onClose: () => void
  /** Called once the change has landed, with the sentence that described it. */
  onApplied: (summary: string) => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const locale = useI18nStore((state) => state.language)

  const split = useMemo(() => splitSelection(views), [views])
  const modes = availableModes(split)
  const [options, setOptions] = useState<RescheduleOptions>({ ...DEFAULT_OPTIONS, mode: initialMode(split) })
  const patch = (next: Partial<RescheduleOptions>) => setOptions((current) => ({ ...current, ...next }))

  const queue = useNewQueueQuery(split.freshDeckId)
  const queueAhead = queue.data ? Math.max(0, queue.data.count - split.fresh.length) : null
  const positionMax = queue.data ? Math.max(1, queue.data.count) : POSITION_FALLBACK_MAX

  // The decks and their presets, for the hour the study day starts: the sentence names a
  // date the way the server will land on it, or counts days while it cannot know.
  const decks = useDecksQuery()
  const presets = usePresetsQuery(true)
  const dayStartHour = dayStartHourOf(views, decks.data, presets.data)

  const reschedule = useRescheduleCards()
  const summary = consequence(t, split, options, queueAhead, locale, new Date(), dayStartHour)
  const nothingToDo = touchesNothing(split, options.mode)

  const apply = async () => {
    try {
      await reschedule.mutateAsync(rescheduleRequest(views.map((view) => view.card.id), options))
    } catch (error) {
      toast.warning(fc("RescheduleFailedTitle"), { description: describeError(t, error) })
      return
    }
    onApplied(summary)
    onClose()
  }

  if (views.length === 0) return null

  const modeOptions: SegmentedOption<RescheduleMode>[] = modes.map((mode) => ({
    value: mode,
    label: fc(MODE_LABEL_KEYS[mode]),
    icon: MODE_ICONS[mode],
  }))

  return (
    <Modal
      open
      onClose={() => !reschedule.isPending && onClose()}
      title={fc("RescheduleTitle")}
      subtitle={views.length === 1 ? fc("RescheduleSelectedOne") : fc("RescheduleSelectedFormat", { 0: views.length })}
      closeLabel={t("Common", "Close")}
      width={560}
      footer={
        <>
          <span />
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={reschedule.isPending} onClick={onClose}>
              {t("Common", "Cancel")}
            </Button>
            <Button variant="solid" disabled={reschedule.isPending || nothingToDo} onClick={() => void apply()}>
              {fc(applyLabelKey(options.mode))}
            </Button>
          </div>
        </>
      }
    >
      <div className="min-w-0 flex-1 px-5 pt-1 pb-4">
        {/* Three names for one intention, so they sit side by side rather than in three places in a menu. */}
        <Segmented
          value={options.mode}
          options={modeOptions}
          onChange={(mode) => patch({ mode })}
          label={fc("RescheduleModeLabel")}
        />

        <div className="mt-1 [&>*+*]:border-t [&>*+*]:border-line-soft">
          {options.mode === "due" && (
            <>
              <Row label={fc("RescheduleMakeDue")}>
                <div className="flex items-center gap-1.5">
                  {/* The two everyone means, then the general case. A stepper starting at 0 makes
                      "tomorrow" a thing you count to. */}
                  <Pill on={options.days === 0} onClick={() => patch({ days: 0 })}>
                    {fc("RescheduleToday")}
                  </Pill>
                  <Pill on={options.days === 1} onClick={() => patch({ days: 1 })}>
                    {fc("RescheduleTomorrow")}
                  </Pill>
                  <NumberStepper
                    value={options.days}
                    min={0}
                    max={MAX_DAYS}
                    onChange={(days) => patch({ days })}
                    label={fc("RescheduleDaysFromNow")}
                  />
                  <span className="text-[12.5px] text-ink-3">{fc("RescheduleDaysUnit")}</span>
                </div>
              </Row>

              <Row
                label={fc("RescheduleMatchInterval")}
                description={fc(options.matchInterval ? "RescheduleMatchIntervalOn" : "RescheduleMatchIntervalOff")}
              >
                <Switch
                  checked={options.matchInterval}
                  onChange={(matchInterval) => patch({ matchInterval })}
                  label={fc("RescheduleMatchInterval")}
                />
              </Row>
            </>
          )}

          {options.mode === "reset" && (
            <Row
              label={fc("RescheduleKeepCounts")}
              description={fc(options.keepCounts ? "RescheduleKeepCountsOn" : "RescheduleKeepCountsOff")}
            >
              <Switch
                checked={options.keepCounts}
                onChange={(keepCounts) => patch({ keepCounts })}
                label={fc("RescheduleKeepCountsSwitch")}
              />
            </Row>
          )}

          {options.mode === "position" && (
            <>
              <Row label={fc("ReschedulePutThese")}>
                <div className="flex items-center gap-1.5">
                  {PLACES.map(([place, key]) => (
                    <Pill key={place} on={options.place === place} onClick={() => patch({ place })}>
                      {fc(key)}
                    </Pill>
                  ))}
                </div>
              </Row>

              {options.place === "at" && (
                <Row label={fc("ReschedulePosition")} description={fc("ReschedulePositionHint")}>
                  <NumberStepper
                    value={options.at}
                    min={1}
                    max={positionMax}
                    onChange={(at) => patch({ at })}
                    label={fc("ReschedulePosition")}
                  />
                </Row>
              )}
            </>
          )}
        </div>

        {/* The point of the dialog. Everything above is a control; this is the answer to the
            question you actually had. */}
        <p
          aria-live="polite"
          className="mt-4 rounded-lg bg-canvas-sunken px-3 py-2.5 text-[12.5px] leading-[1.55] text-ink-2"
        >
          {summary}
        </p>
      </div>
    </Modal>
  )
}

const MODE_LABEL_KEYS: Record<RescheduleMode, string> = {
  due: "RescheduleModeDue",
  reset: "RescheduleModeReset",
  position: "RescheduleModePosition",
}

const PLACES: readonly (readonly [QueuePlace, string])[] = [
  ["start", "ReschedulePlaceFirst"],
  ["end", "ReschedulePlaceLast"],
  ["at", "ReschedulePlaceAt"],
]

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-8 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors",
        on ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  )
}
