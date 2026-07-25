/**
 * Assembles a `RunResult` and ships it out of the page by every path a reader of this spike
 * might actually have available.
 *
 * Four paths exist because no single audience has all of them: a browser pane watching the
 * run live has the DOM and the console but the process driving it may be headless and only
 * scraping the POST; a desktop webview has neither devtools nor a terminal, only whatever the
 * page itself renders or offers to download. None of the four may throw and take the others
 * down with it, so each is wrapped and reported independently.
 */

import type {
  ArmId,
  ClockCalibration,
  EngineFidelity,
  EnvironmentFacts,
  FrameStats,
  LatencyStats,
  OnScreenCounts,
  ProofOfExecution,
  RunResult,
  ScenarioId,
  ScenarioVerdict,
  Viewport,
} from './contract'
import type { MindmapFixture } from '../fixture/model'

// ---- buildRunResult -----------------------------------------------------------------------

export interface BuildRunResultInput {
  readonly arm: ArmId
  readonly scenario: ScenarioId
  /** `elementCount`, `edgeCount`, `fixtureLayout` and `fixtureDigest` are all derived from
   *  this, never accepted separately, so a caller cannot restate them inconsistently with
   *  the fixture actually used. */
  readonly fixture: MindmapFixture
  readonly lodEnabled: boolean
  readonly viewport: Viewport
  readonly onScreen: OnScreenCounts
  readonly calibration: ClockCalibration
  readonly frames: FrameStats | null
  readonly latency: LatencyStats | null
  readonly scalars: Readonly<Record<string, number>>
  readonly proofs: readonly ProofOfExecution[]
  readonly aborts: readonly string[]
  readonly environment: EnvironmentFacts
  readonly engineFidelity: EngineFidelity
  readonly startedAt: number
  readonly durationMs: number
}

/** A proof fails if either dimension failed: the arm's own state, or what actually committed. */
function failedProofs(proofs: readonly ProofOfExecution[]): readonly ProofOfExecution[] {
  return proofs.filter((p) => !p.stateMatched || !p.committedMatched)
}

/**
 * Assembles a `RunResult`. Guards here catch the cheapest ways to produce a fabricated
 * measurement by accident: a negative duration (a clock-math bug upstream) and a result that
 * carries no frames, no latency, no scalars and no aborts at all, which is not "a clean run",
 * it is "nothing was ever measured".
 *
 * Failed proofs of execution are folded into `aborts` here rather than left for a caller to
 * remember to check. A gesture that never reached the arm produces a flawless idle frame
 * histogram, so a proof failure is the single most likely route to a confident wrong pass, and
 * the check has to sit where the result is constructed rather than anywhere it could be skipped.
 */
export function buildRunResult(input: BuildRunResultInput): RunResult {
  if (input.durationMs < 0) {
    throw new Error(`buildRunResult received a negative durationMs (${input.durationMs})`)
  }
  const aborts = [
    ...input.aborts,
    ...failedProofs(input.proofs).map(
      (p) =>
        `proof of execution failed for '${p.gesture}': ` +
        `${p.stateMatched ? '' : 'arm state did not change by the intended magnitude; '}` +
        `${p.committedMatched ? '' : 'the committed transform did not agree with the arm state; '}` +
        `expected ${p.expected}, actual ${p.actual}`,
    ),
  ]

  // Checked against the combined aborts, not the caller's, so a run that produced nothing but
  // a failed proof is recorded as an aborted run rather than throwing here and losing the
  // reason it failed.
  if (
    input.frames === null &&
    input.latency === null &&
    Object.keys(input.scalars).length === 0 &&
    aborts.length === 0
  ) {
    throw new Error(
      'buildRunResult received no frame stats, no latency stats, no scalars and no aborts; ' +
        'nothing was measured',
    )
  }

  return {
    arm: input.arm,
    scenario: input.scenario,
    fixtureLayout: input.fixture.layout,
    fixtureDigest: input.fixture.digest,
    elementCount: input.fixture.elements.length,
    edgeCount: input.fixture.edges.length,
    lodEnabled: input.lodEnabled,
    viewport: input.viewport,
    onScreen: input.onScreen,
    calibration: input.calibration,
    frames: input.frames,
    latency: input.latency,
    scalars: input.scalars,
    proofs: input.proofs,
    aborts,
    environment: input.environment,
    engineFidelity: input.engineFidelity,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
  }
}

// ---- publishing -----------------------------------------------------------------------------

declare global {
  interface Window {
    __spikeResult?: RunResult
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function renderResultElement(body: string): void {
  let el = document.getElementById('result')
  if (!el) {
    el = document.createElement('pre')
    el.id = 'result'
    document.body.appendChild(el)
  }
  el.textContent = body
}

function storeOnWindow(result: RunResult): void {
  window.__spikeResult = result
}

// Tracked so a second publish in the same page life revokes the previous object URL rather
// than leaking one blob per run.
let lastDownloadUrl: string | undefined

function offerDownload(result: RunResult, body: string): void {
  const blob = new Blob([body], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl)
  }
  lastDownloadUrl = url

  const existing = document.getElementById('result-download')
  const link = existing instanceof HTMLAnchorElement ? existing : document.createElement('a')
  link.id = 'result-download'
  link.textContent = 'Download result JSON'
  link.href = url
  link.download = `${result.arm}-${result.scenario}-${result.startedAt}.json`
  if (!existing) {
    document.body.appendChild(link)
  }
}

export interface PublishOutcome {
  readonly postedResult: boolean
  readonly renderedToDom: boolean
  readonly storedOnWindow: boolean
  readonly downloadOffered: boolean
  readonly errors: readonly string[]
}

/**
 * Takes all four paths regardless of whether an earlier one failed. A POST failure is the
 * expected case when nothing is listening on `/__probe/result`, for example a plain browser
 * pane with no host harness attached, and must not stop the DOM render, the window handle or
 * the download link from still being offered to whichever audience is actually present.
 */
/**
 * A result plus the verdict computed beside it. Written together so that any summary assembled
 * later from the files on disk reads the call that was actually made, rather than re-deriving
 * the thresholds for itself: two implementations of one rule set is two chances to disagree,
 * and the disagreement would surface as a changed verdict with nothing to explain it.
 */
export type PublishableResult = RunResult & { readonly verdict?: ScenarioVerdict }

export async function publishResult(result: PublishableResult): Promise<PublishOutcome> {
  const errors: string[] = []
  const body = JSON.stringify(result, null, 2)

  let postedResult = false
  try {
    const response = await fetch('/__probe/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    postedResult = response.ok
    if (!response.ok) {
      errors.push(`POST /__probe/result returned ${response.status}`)
    }
  } catch (err) {
    errors.push(`POST /__probe/result failed: ${describeError(err)}`)
  }

  let renderedToDom = false
  try {
    renderResultElement(body)
    renderedToDom = true
  } catch (err) {
    errors.push(`rendering #result failed: ${describeError(err)}`)
  }

  let storedOnWindow = false
  try {
    storeOnWindow(result)
    storedOnWindow = true
  } catch (err) {
    errors.push(`storing window.__spikeResult failed: ${describeError(err)}`)
  }

  let downloadOffered = false
  try {
    offerDownload(result, body)
    downloadOffered = true
  } catch (err) {
    errors.push(`offering the download blob failed: ${describeError(err)}`)
  }

  return { postedResult, renderedToDom, storedOnWindow, downloadOffered, errors }
}

export interface FailureOutcome {
  readonly posted: boolean
  readonly error?: string
}

/** Same non-throwing discipline as `publishResult`: a failed POST here must not itself
 *  become an unhandled rejection that hides the very failure it was reporting. */
export async function publishFailure(message: string): Promise<FailureOutcome> {
  try {
    const response = await fetch('/__probe/fail', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, at: Date.now() }),
    })
    if (!response.ok) {
      return { posted: false, error: `POST /__probe/fail returned ${response.status}` }
    }
    return { posted: true }
  } catch (err) {
    return { posted: false, error: describeError(err) }
  }
}

// ---- markdown summary -----------------------------------------------------------------------

function formatFrameOrLatency(result: RunResult): string {
  if (result.frames) {
    return `p95 ${result.frames.p95.toFixed(1)} / p99 ${result.frames.p99.toFixed(1)} / max ${result.frames.max.toFixed(1)}`
  }
  if (result.latency) {
    return `latency p95 ${result.latency.p95.toFixed(1)} / p99 ${result.latency.p99.toFixed(1)} / max ${result.latency.max.toFixed(1)}`
  }
  return '-'
}

/**
 * The width of the distribution behind the percentiles in the previous column, which phase it was
 * taken over, and whether it is thin enough not to be read as a converged distribution. A table
 * that prints p95/p99/max without the sample count invites reading three identical numbers off a
 * fourteen-frame window as agreement between three independent measurements.
 */
function formatSamples(result: RunResult): string {
  if (!result.frames) return '-'
  const suffix = result.frames.degraded ? ', degraded' : ''
  return `${result.frames.count} ${result.frames.phase}${suffix}`
}

function formatScalars(result: RunResult): string {
  const entries = Object.entries(result.scalars)
  if (entries.length === 0) return '-'
  return entries.map(([key, value]) => `${key}=${value.toFixed(1)}`).join(', ')
}

function escapeForTable(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function formatReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) return ''
  const first = escapeForTable(reasons[0])
  return reasons.length > 1 ? `${first} (+${reasons.length - 1} more)` : first
}

function formatRow(result: RunResult, verdict: ScenarioVerdict): string {
  const onScreen = `${result.onScreen.elements}el/${result.onScreen.edges}e/${result.onScreen.domNodes}dom`
  return (
    `| ${result.arm} | ${result.scenario} | ${result.engineFidelity} | ${verdict.verdict} | ` +
    `${formatFrameOrLatency(result)} | ${formatSamples(result)} | ${formatScalars(result)} | ` +
    `${onScreen} | ${formatReasons(verdict.reasons)} |`
  )
}

/**
 * `results` and `verdicts` must be the same length and in the same order, one verdict per
 * result, which is how every caller in this codebase produces them (`results.map(evaluateScenario)`).
 * Mismatched pairing would silently mislabel a row's numbers with another row's verdict, so
 * it is checked rather than assumed.
 *
 * No mean anywhere on purpose: the frame-time distribution is bimodal by construction, and a
 * mean sitting between the fast mode and the stall mode describes neither one.
 *
 * Every row carries what the reader needs to discount it without going back to the JSON: the
 * engine fidelity that says how much the row may claim, the number of driven frames behind its
 * percentiles and whether that count is degraded, and the on-screen counts that expose a renderer
 * that scored well by drawing less.
 */
export function summarizeToMarkdown(
  results: readonly RunResult[],
  verdicts: readonly ScenarioVerdict[],
): string {
  if (results.length !== verdicts.length) {
    throw new Error(
      `summarizeToMarkdown received ${results.length} result(s) but ${verdicts.length} verdict(s); ` +
        'callers must pass one verdict per result, in the same order',
    )
  }

  const rows = results.map((result, i) => {
    const verdict = verdicts[i]
    if (verdict.scenario !== result.scenario) {
      throw new Error(
        `summarizeToMarkdown: result[${i}] is scenario '${result.scenario}' but verdict[${i}] is ` +
          `for '${verdict.scenario}'; results and verdicts must be paired in the same order`,
      )
    }
    return formatRow(result, verdict)
  })

  const header = [
    '| Arm | Scenario | Fidelity | Verdict | Frames/Latency | Samples | Scalars | On-screen | Reasons |',
    '|---|---|---|---|---|---|---|---|---|',
  ]

  return [...header, ...rows].join('\n')
}
