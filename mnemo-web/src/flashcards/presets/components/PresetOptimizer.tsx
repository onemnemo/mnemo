import { useEffect, useRef, useState } from "react"

import type { OptimizeWeightsDto } from "@/api/types"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { SettingRowShell } from "@/settings/components/SettingRowShell"
import { toast } from "@/stores/toast"

import { applyPresetWeights, optimizePreset, usePresetsQuery, useRefreshAfterPresetWrite } from "../api"
import { readOutcome } from "../optimizer"

/**
 * Fitting the scheduler's memory weights to the collection's own review history.
 *
 * A fit stores nothing on its own: the result is offered, and applying it is a second, separate
 * write. That write lands immediately rather than waiting for Save, the way deleting a preset in
 * this dialog does, because the vector belongs to the preset that was fitted and not to whichever
 * draft happens to be on screen when the dialog closes.
 */
export function PresetOptimizer({ presetId }: { presetId: string | null }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const presets = usePresetsQuery(presetId !== null)
  const refresh = useRefreshAfterPresetWrite()

  const [busy, setBusy] = useState<"none" | "fitting" | "saving">("none")
  const [result, setResult] = useState<OptimizeWeightsDto | null>(null)

  // A fit runs for seconds, so closing the dialog has to take the request with it rather than
  // leave the server working on an answer nothing will read.
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => inFlight.current?.abort(), [])

  const stored = presets.data?.find((preset) => preset.id === presetId) ?? null
  const outcome = result ? readOutcome(result) : null
  const idle = busy === "none"

  const run = async () => {
    if (!presetId || !idle) return
    const controller = new AbortController()
    inFlight.current = controller
    setBusy("fitting")
    setResult(null)
    try {
      setResult(await optimizePreset(presetId, controller.signal))
    } catch (error) {
      // An abort is the dialog closing, and there is nothing left to tell.
      if (!controller.signal.aborted) {
        toast.warning(fc("ReviewSettingsOptimizeErrorTitle"), {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      inFlight.current = null
      setBusy("none")
    }
  }

  const write = async (weights: number[] | null, appliedTitle: string) => {
    if (!presetId || !idle) return
    setBusy("saving")
    try {
      await applyPresetWeights(presetId, weights)
      setResult(null)
      toast.success(appliedTitle)
    } catch (error) {
      toast.warning(fc("ReviewSettingsOptimizeErrorTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy("none")
      // Every deck bound to this preset now schedules on a different vector, so the counts and
      // due dates downstream of it are stale whichever way the write went.
      await refresh()
    }
  }

  const message = () => {
    if (!presetId) return fc("ReviewSettingsOptimizeUnsaved")
    if (busy === "fitting") return fc("ReviewSettingsOptimizeWorkingHint")
    if (!outcome) return fc("ReviewSettingsOptimizeDescription")
    if (outcome.kind === "not-enough-reviews") {
      return fc("ReviewSettingsOptimizeNotEnoughFormat", { 0: outcome.scored, 1: outcome.minimum })
    }
    if (outcome.kind === "already-tuned") return fc("ReviewSettingsOptimizeAlreadyTuned")
    return fc("ReviewSettingsOptimizeImprovedFormat", {
      0: result?.reviewsScored ?? 0,
      1: outcome.gainPercent,
    })
  }

  return (
    <>
      <SettingRowShell
        title={fc("ReviewSettingsOptimizeTitle")}
        description={message()}
        divider={stored?.weights != null}
        dimmed={presetId === null}
        align="start"
      >
        <div className="flex items-center gap-2">
          {outcome?.kind === "improved" && result ? (
            <Button
              size="sm"
              disabled={!idle}
              onClick={() => void write(result.weights, fc("ReviewSettingsOptimizeApplied"))}
            >
              {fc("ReviewSettingsOptimizeApply")}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={!presetId || !idle} onClick={() => void run()}>
            {busy === "fitting" ? fc("ReviewSettingsOptimizeWorking") : fc("ReviewSettingsOptimizeAction")}
          </Button>
        </div>
      </SettingRowShell>

      {stored?.weights != null ? (
        <SettingRowShell
          title={fc("ReviewSettingsWeightsCustomTitle")}
          description={fc("ReviewSettingsWeightsCustomDescription")}
          divider={false}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={!idle}
            onClick={() => void write(null, fc("ReviewSettingsWeightsRestored"))}
          >
            {fc("ReviewSettingsWeightsUseDefaults")}
          </Button>
        </SettingRowShell>
      ) : null}
    </>
  )
}
