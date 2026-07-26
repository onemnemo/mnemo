/**
 * Turns a measured `RunResult` into a `ScenarioVerdict`, and a set of per-scenario verdicts
 * into a go/no-go call for one arm.
 *
 * Every refusal rule here exists because a harness that quietly turns an unmeasurable row
 * into a passing one produces a confident wrong answer, which is worse than no answer. So
 * every escape hatch (non-gating fidelity, non-gating scenario, calibration-unachievable
 * threshold, a missing measurement, a sample too thin to hold a percentile, a run calibrated
 * against a different clock than the control) is a distinct, named outcome, never a silent skip.
 *
 * Nothing here reads Event Timing. It only records user-agent-generated events, and every
 * gesture in this harness is dispatched synthetically, so it can corroborate a result but can
 * never gate one.
 */

import type {
  ArmId,
  ClockCalibration,
  EnvironmentFacts,
  FrameStats,
  RunResult,
  ScenarioId,
  ScenarioVerdict,
  Verdict,
} from './contract'

import rawThresholds from '../../thresholds.json'

// ---- thresholds.json shape --------------------------------------------------------------

/**
 * A single ceiling (frame-cadence metrics, quantized latency metrics) or a two-tier
 * pass/warn ceiling (scalar timings, where thresholds.json spells out a distinct warn
 * band). Unifying the two into one type lets every metric run through the same classifier
 * instead of a per-scenario special case.
 */
export type MetricThreshold = number | { readonly pass: number; readonly warn: number }

export interface CollapseSubGate {
  readonly noFrameOverMs: number
  readonly noHang: boolean
  readonly noBlankRender: boolean
}

export interface ScenarioThresholds {
  readonly name: string
  readonly gating: boolean
  readonly loadBearing?: boolean
  readonly metrics?: Readonly<Record<string, MetricThreshold>>
  /** Frame-cadence bars, as multiples of the run's calibrated frame period. See resolveCadenceMetrics. */
  readonly cadenceMultiples?: Readonly<Record<string, number>>
  readonly collapseSubGate?: CollapseSubGate
  readonly memberDeltaEquality?: string
  readonly extraAssertion?: string
  readonly reasoning: string
}

export interface ControlMeasurement {
  readonly description: string
  readonly reasoning: string
  readonly metrics: Readonly<Record<string, MetricThreshold>>
  readonly cadenceMultiples?: Readonly<Record<string, number>>
}

export interface EngineFidelityConfig {
  readonly gating: readonly string[]
  readonly leadOnly: readonly string[]
  readonly rule: string
}

export interface ThresholdsFile {
  readonly version: number
  readonly frameBudgetMs: number
  readonly halfRateMs: number
  readonly scenarios: Readonly<Record<string, ScenarioThresholds>>
  readonly armVerdictRule: string
  readonly substrateDecisionRule: readonly string[]
  readonly controlMeasurement: ControlMeasurement
  readonly engineFidelity: EngineFidelityConfig
}

const REQUIRED_SCENARIO_IDS: readonly string[] = [
  'S1',
  'S2',
  'S3',
  'S4a',
  'S4b',
  'S5',
  'S5x',
  'S6',
  'S7',
  'S8',
  'S9',
]

/** Every field of `FrameStats` a threshold may name, so `pctOver16_7` is a usable gate and not
 *  a silently-missing scalar. */
const FRAME_METRIC_KEYS: ReadonlySet<string> = new Set([
  'p50',
  'p95',
  'p99',
  'max',
  'pctOver16_7',
  'pctOver33_3',
])

/**
 * Every scalar a scenario is allowed to gate on. Declared rather than inferred so a typo in
 * thresholds.json is caught at import time: an unreadable key would otherwise be scored as a
 * missing measurement and fail the arm for what is actually a broken threshold file.
 */
const SCALAR_METRIC_KEYS: ReadonlySet<string> = new Set([
  'mountMs',
  'longestBlockMs',
  'timeToPaintedMs',
  'worstFrameAtCrossingMs',
  'dispatchToPaintedP95',
  'dispatchToPaintedP99',
])

/**
 * Scalars whose resolution is one animation frame, because they are measured by counting frames
 * until the arm's own state reflects a dispatch. A threshold below the calibrated frame time is
 * therefore as unachievable for them as it is for a frame-cadence metric, even though they do
 * not live on `FrameStats`.
 */
const FRAME_QUANTIZED_SCALAR_KEYS: ReadonlySet<string> = new Set([
  'dispatchToPaintedP95',
  'dispatchToPaintedP99',
])

/** How many dispatch-to-painted observations the run reported, alongside the percentiles. */
const DISPATCH_SAMPLE_COUNT_KEY = 'dispatchToPaintedCount'

/** Dispatches whose effect never became observable in the arm's state, so they were dropped. */
const DISPATCH_DROPPED_KEY = 'dispatchToPaintedTimeouts'

/**
 * The JSON import gives each scenario's `metrics` its own narrow literal shape, which is
 * precise but useless for generic code: nothing here can write one classifier against
 * eleven different object shapes. Asserting a hand-written, structurally-checked interface
 * over it once, at load time, is what lets the rest of this file treat every metric
 * uniformly. The runtime check below is what makes that assertion honest rather than a
 * type-system lie: an edit to thresholds.json that drops a required scenario fails at
 * import time, not with a wrong verdict three functions later.
 */
function assertThresholdsShape(value: unknown): asserts value is ThresholdsFile {
  if (typeof value !== 'object' || value === null) {
    throw new Error('thresholds.json did not parse to an object')
  }
  const record = value as Record<string, unknown>

  if (typeof record.version !== 'number') {
    throw new Error("thresholds.json is missing a numeric 'version'")
  }
  if (typeof record.scenarios !== 'object' || record.scenarios === null) {
    throw new Error("thresholds.json is missing a 'scenarios' object")
  }
  if (typeof record.controlMeasurement !== 'object' || record.controlMeasurement === null) {
    throw new Error("thresholds.json is missing a 'controlMeasurement' object")
  }

  const scenarios = record.scenarios as Record<string, unknown>
  for (const id of REQUIRED_SCENARIO_IDS) {
    if (!(id in scenarios)) {
      throw new Error(`thresholds.json is missing required scenario '${id}'`)
    }
  }
}

/**
 * Every metric key must have a reader. A key with no reader would resolve to `undefined` at
 * evaluation time and be scored as "the arm did not produce this measurement", so a one-character
 * mistake in the threshold file would be reported as a failure of the renderer. Checked once at
 * import so it surfaces as a broken config the moment the file is loaded.
 */
export function assertMetricKeysKnown(file: ThresholdsFile): void {
  const unknown: string[] = []

  function check(owner: string, metrics: Readonly<Record<string, MetricThreshold>> | undefined): void {
    for (const key of Object.keys(metrics ?? {})) {
      if (!FRAME_METRIC_KEYS.has(key) && !SCALAR_METRIC_KEYS.has(key)) {
        unknown.push(`${owner}.${key}`)
      }
    }
  }

  for (const [id, spec] of Object.entries(file.scenarios)) check(id, spec.metrics)
  check('controlMeasurement', file.controlMeasurement.metrics)

  if (unknown.length > 0) {
    throw new Error(
      `thresholds.json names metric key(s) this harness has no reader for: ${unknown.join(', ')}; ` +
        'an unreadable key scores as a missing measurement and would fail an arm for a config typo',
    )
  }
}

assertThresholdsShape(rawThresholds)

/** The parsed, structurally-validated contents of `thresholds.json`. */
export const thresholds: ThresholdsFile = rawThresholds

assertMetricKeysKnown(thresholds)

// ---- metric resolution -------------------------------------------------------------------

type MetricSource = 'frames' | 'scalars'

/**
 * Total by construction: the key sets above are validated against thresholds.json at import, so
 * an unknown key here is an internal inconsistency rather than a config mistake, and throwing is
 * the honest response.
 *
 * There is deliberately no Event Timing source. Event Timing only creates entries for events the
 * user agent generated itself, and every gesture in this harness is dispatched synthetically, so
 * no gating metric may be read from it. It is still recorded on the run as corroboration.
 */
function resolveMetricSource(key: string): MetricSource {
  if (FRAME_METRIC_KEYS.has(key)) return 'frames'
  if (SCALAR_METRIC_KEYS.has(key)) return 'scalars'
  throw new Error(`no reader is registered for metric key '${key}'`)
}

function readFrameField(frames: FrameStats, key: string): number {
  switch (key) {
    case 'p50':
      return frames.p50
    case 'p95':
      return frames.p95
    case 'p99':
      return frames.p99
    case 'max':
      return frames.max
    case 'pctOver16_7':
      return frames.pctOver16_7
    case 'pctOver33_3':
      return frames.pctOver33_3
    default:
      throw new Error(`unrecognized frame metric key '${key}'`)
  }
}

function readMetricValue(result: RunResult, source: MetricSource, key: string): number | undefined {
  switch (source) {
    case 'frames':
      return result.frames ? readFrameField(result.frames, key) : undefined
    case 'scalars':
      return result.scalars[key]
  }
}

/**
 * A threshold below the run's own calibrated floor cannot be cleared by any arm, fast or slow:
 * the machine itself cannot paint that often right now.
 *
 * Scoped to the metrics that are actually bound to vsync: the frame-cadence percentiles, and the
 * dispatch-to-painted scalars, which are measured by counting whole frames and so cannot resolve
 * anything finer than one. The wall-clock scalars (mount, relayout) are not frame-quantized and
 * are never flagged this way.
 */
function isFrameQuantized(source: MetricSource, key: string): boolean {
  return source === 'frames' || FRAME_QUANTIZED_SCALAR_KEYS.has(key)
}

function isUnachievable(calibration: ClockCalibration, thresholdMs: number): boolean {
  return calibration.medianFrameMs > thresholdMs
}

function classify(value: number, threshold: MetricThreshold): 'pass' | 'warn' | 'fail' {
  if (typeof threshold === 'number') {
    return value <= threshold ? 'pass' : 'fail'
  }
  if (value <= threshold.pass) return 'pass'
  if (value <= threshold.warn) return 'warn'
  return 'fail'
}

function describeThresholdCompare(
  frameQuantized: boolean,
  value: number,
  threshold: MetricThreshold,
  calibration: ClockCalibration,
): string {
  const abs =
    typeof threshold === 'number'
      ? `measured ${value.toFixed(2)}ms, absolute threshold ${threshold}ms`
      : `measured ${value.toFixed(2)}ms, pass<=${threshold.pass}ms, warn<=${threshold.warn}ms`
  if (!frameQuantized) return abs
  return (
    `${abs}, calibrated floor this run ${calibration.medianFrameMs.toFixed(2)}ms ` +
    `(regime ${calibration.regime}, ~${calibration.impliedHz.toFixed(1)}Hz)`
  )
}

/**
 * Below this many driven frames the nearest-rank percentiles stop being distinct: at n under 20
 * the 95th percentile is literally the maximum, and at n under 100 so is the 99th. A run that
 * short cannot be read as a distribution, so it may report its numbers but may not pass on them.
 */
export const MIN_FRAME_SAMPLES_FOR_PASS = 100

/** The same distinctness argument as `MIN_FRAME_SAMPLES_FOR_PASS`, for percentiles computed over
 *  dispatches rather than over frames. */
const MIN_DISPATCH_SAMPLES_FOR_PASS = 100

type MetricTier = 'pass' | 'warn' | 'fail' | 'unachievable' | 'missing'

interface MetricEvaluation {
  readonly key: string
  readonly source: MetricSource
  readonly tier: MetricTier
  readonly detail: string
}

function evaluateMetric(result: RunResult, key: string, threshold: MetricThreshold): MetricEvaluation {
  const source = resolveMetricSource(key)
  const value = readMetricValue(result, source, key)
  const frameQuantized = isFrameQuantized(source, key)

  if (value === undefined) {
    return {
      key,
      source,
      tier: 'missing',
      detail: `no measurement available (expected from ${source})`,
    }
  }

  if (frameQuantized && typeof threshold === 'number' && isUnachievable(result.calibration, threshold)) {
    return {
      key,
      source,
      tier: 'unachievable',
      detail:
        describeThresholdCompare(frameQuantized, value, threshold, result.calibration) +
        '; threshold sits below this run\'s calibrated floor, flagged rather than failed',
    }
  }

  return {
    key,
    source,
    tier: classify(value, threshold),
    detail: describeThresholdCompare(frameQuantized, value, threshold, result.calibration),
  }
}

function evaluateMetrics(
  result: RunResult,
  metrics: Readonly<Record<string, MetricThreshold>>,
): readonly MetricEvaluation[] {
  return Object.entries(metrics).map(([key, threshold]) => evaluateMetric(result, key, threshold))
}

function describeMetric(evaluation: MetricEvaluation): string {
  return `[${evaluation.tier}] ${evaluation.key}: ${evaluation.detail}`
}

const TIER_SEVERITY: Readonly<Record<'pass' | 'warn' | 'fail', number>> = { pass: 0, warn: 1, fail: 2 }

function worstTier(tiers: readonly ('pass' | 'warn' | 'fail')[]): 'pass' | 'warn' | 'fail' {
  let worst: 'pass' | 'warn' | 'fail' = 'pass'
  for (const tier of tiers) {
    if (TIER_SEVERITY[tier] > TIER_SEVERITY[worst]) worst = tier
  }
  return worst
}

// ---- build confounders ----------------------------------------------------------------------

/**
 * Facts about the build that make a number describe something other than the shipped product: a
 * development bundle carries dev-only warnings and unminified code, and StrictMode double-invokes
 * every render and effect. Both roughly double the work being timed, so a row carrying either
 * measured a different program than the one the decision is about.
 *
 * Event Timing's absence is deliberately not here. No gating metric is read from it, so an engine
 * without it is still fully measurable.
 */
function buildConfounders(environment: EnvironmentFacts): readonly string[] {
  const found: string[] = []
  if (!environment.isProductionBuild) {
    found.push(
      'measured on a development build, which carries dev-only work the shipped product does not; ' +
        'the numbers do not describe the product',
    )
  }
  if (environment.strictModeDetected === true) {
    found.push(
      'React StrictMode was active, so renders and effects were double-invoked; the measured work ' +
        'is not the work the product does',
    )
  }
  if (environment.strictModeDetected === 'inconclusive') {
    found.push(
      'the StrictMode probe never reported, so double-invoked renders can be neither confirmed nor ' +
        'ruled out; an unverified negative is not a clean run',
    )
  }
  return found
}

// ---- collapse sub-gate --------------------------------------------------------------------

export interface CollapseSubGateResult {
  readonly ok: boolean
  readonly reasons: readonly string[]
}

/**
 * Independent of the percentile metrics on purpose: a browser tab that renders nothing can
 * still post a flawless frame histogram, because there is nothing expensive left to paint.
 * `noBlankRender` catches that case directly off `onScreen`, not off timing. `noFrameOverMs`
 * catches a frame so slow it reads as a stall regardless of how the rest of the run looked.
 * `noHang` is checked here too for this sub-gate's own report, even though in the normal
 * call path (`evaluateScenario`) a non-empty `aborts` has already short-circuited to
 * `'aborted'` before this function runs; it stays meaningful when this function is called
 * directly, which the test suite does.
 */
export function evaluateCollapseSubGate(result: RunResult, gate: CollapseSubGate): CollapseSubGateResult {
  const reasons: string[] = []

  if (!result.frames) {
    return {
      ok: false,
      reasons: ['collapse sub-gate: no frame stats were collected, cannot certify no-collapse'],
    }
  }

  if (result.frames.max > gate.noFrameOverMs) {
    reasons.push(
      `collapse sub-gate: worst frame ${result.frames.max.toFixed(2)}ms exceeded the ` +
        `${gate.noFrameOverMs}ms collapse ceiling`,
    )
  }

  if (gate.noBlankRender && result.elementCount > 0 && result.onScreen.elements === 0) {
    reasons.push(
      `collapse sub-gate: ${result.elementCount} elements expected on screen, 0 rendered; blank render`,
    )
  }

  if (gate.noHang) {
    const hangAbort = result.aborts.find((a) => /hang/i.test(a))
    if (hangAbort) {
      reasons.push(`collapse sub-gate: hang reported ("${hangAbort}")`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}

// ---- scenario config resolution ------------------------------------------------------------

interface ResolvedScenarioConfig {
  readonly gating: boolean
  readonly metrics: Readonly<Record<string, MetricThreshold>>
  readonly collapseSubGate?: CollapseSubGate
}

/**
 * `control` is not a key in `thresholds.scenarios`, it lives at `thresholds.controlMeasurement`
 * with its own shape, so it is special-cased here rather than forcing an artificial entry
 * into the scenarios map.
 */
/**
 * Turns `cadenceMultiples` into concrete millisecond bars using the run's own calibration.
 *
 * Frame-cadence thresholds cannot be absolute. A panel that calibrates at 59.88Hz has a true
 * frame period of 16.6999ms, and requestAnimationFrame deltas jitter to both sides of it, so a
 * renderer that delivers every single frame still reports a 95th percentile just above 16.7.
 * Judging that against a fixed 16.7 measures the display, not the arm.
 *
 * A multiple keeps the question strict and makes it the right question: a DROPPED frame lands
 * near twice the period, never a fraction above it, so 1.5x sits exactly halfway between every
 * frame delivered and every other frame dropped.
 */
function resolveCadenceMetrics(
  multiples: Readonly<Record<string, number>> | undefined,
  calibration: ClockCalibration,
): Readonly<Record<string, MetricThreshold>> {
  if (!multiples) return {}
  const period = calibration.medianFrameMs
  if (!Number.isFinite(period) || period <= 0) return {}

  const resolved: Record<string, MetricThreshold> = {}
  for (const [key, multiple] of Object.entries(multiples)) {
    resolved[key] = period * multiple
  }
  return resolved
}

/** Whether this scenario's bars are derived from the run's own calibrated frame period. */
function declaresCadenceMultiples(scenario: ScenarioId): boolean {
  if (scenario === 'control') return thresholds.controlMeasurement.cadenceMultiples !== undefined
  return thresholds.scenarios[scenario]?.cadenceMultiples !== undefined
}

function resolveScenarioConfig(
  scenario: ScenarioId,
  calibration: ClockCalibration,
): ResolvedScenarioConfig {
  if (scenario === 'control') {
    return {
      gating: true,
      metrics: {
        ...thresholds.controlMeasurement.metrics,
        ...resolveCadenceMetrics(thresholds.controlMeasurement.cadenceMultiples, calibration),
      },
    }
  }

  const entry: ScenarioThresholds | undefined = thresholds.scenarios[scenario]
  if (!entry) {
    throw new Error(`thresholds.json has no entry for scenario '${scenario}'; cannot compute a verdict`)
  }

  return {
    gating: entry.gating,
    metrics: { ...(entry.metrics ?? {}), ...resolveCadenceMetrics(entry.cadenceMultiples, calibration) },
    collapseSubGate: entry.collapseSubGate,
  }
}

// ---- scenario verdict -----------------------------------------------------------------------

/**
 * Evaluates one measured run. The order of checks is itself part of the contract: an
 * aborted run is caught before anything else is even read, and a non-gating engine is
 * caught before this function looks at thresholds.json at all, so neither a good number
 * nor a bad one from either source can ever surface as pass or fail.
 *
 * Everything after the metric tiers can only hold a pass back, never grant one. Each of those
 * checks names a way the row could look clean without having measured what it claims: too few
 * samples for a percentile to mean anything, frames summarized over an idle phase, dropped
 * inputs missing from a latency distribution, a build that is not the shipped one. All of them
 * withhold at 'warn' rather than fail, because none of them is the arm's fault, and the arm
 * verdict treats a warn on a gating scenario as inconclusive rather than as a weak pass.
 */
export function evaluateScenario(result: RunResult): ScenarioVerdict {
  if (result.aborts.length > 0) {
    return {
      scenario: result.scenario,
      verdict: 'aborted',
      reasons: [...result.aborts],
    }
  }

  if (result.engineFidelity !== 'gating') {
    return {
      scenario: result.scenario,
      verdict: 'not-gating',
      reasons: [
        `engineFidelity is '${result.engineFidelity}', not 'gating'; refusing to emit pass or ` +
          'fail from this row',
      ],
    }
  }

  const config = resolveScenarioConfig(result.scenario, result.calibration)
  const evaluations = evaluateMetrics(result, config.metrics)
  const metricReasons = evaluations.map(describeMetric)

  if (!config.gating) {
    return {
      scenario: result.scenario,
      verdict: 'not-gating',
      reasons: [
        `scenario '${result.scenario}' is marked non-gating in thresholds.json; numbers recorded ` +
          'as headroom only',
        ...metricReasons,
      ],
    }
  }

  const missing = evaluations.filter((e) => e.tier === 'missing')
  if (missing.length > 0) {
    return {
      scenario: result.scenario,
      verdict: 'fail',
      reasons: [
        ...metricReasons,
        `${missing.length} configured metric(s) had no matching measurement in the run; a ` +
          'missing measurement fails rather than being skipped',
      ],
    }
  }

  const unachievable = evaluations.filter((e) => e.tier === 'unachievable')
  const achievable = evaluations.filter((e) => e.tier !== 'unachievable')
  const reasons = [...metricReasons]

  let verdict: Verdict
  if (evaluations.length === 0) {
    // A gating scenario with nothing configured to compare against is not a scenario that passed,
    // it is one that was never evaluated. Passing by vacuity is the exact shape of wrong answer
    // this file exists to prevent.
    verdict = 'warn'
    reasons.push(
      `thresholds.json configures no metrics for gating scenario '${result.scenario}', so nothing ` +
        "was compared; verdict withheld at 'warn' rather than passed by vacuity",
    )
  } else if (achievable.length === 0) {
    verdict = 'warn'
    reasons.push(
      "every configured metric was unachievable given this run's clock calibration; verdict " +
        "withheld at 'warn' rather than assumed pass",
    )
  } else {
    verdict = worstTier(achievable.map((e) => e.tier as 'pass' | 'warn' | 'fail'))
  }

  // An unachievable metric must never be quietly dropped so the survivors can carry a pass.
  // The display could not have shown the difference the threshold asks about, so the scenario
  // was not actually evaluated, whatever the other metrics did. It is not the arm's fault, so
  // this is a withheld verdict rather than a failure, but it can never contribute to a Go.
  if (unachievable.length > 0 && verdict === 'pass') {
    verdict = 'warn'
    reasons.push(
      `${unachievable.length} metric(s) were unachievable at this run's calibrated cadence, so ` +
        "the remaining metrics cannot carry a pass; verdict withheld at 'warn'",
    )
  }

  // Percentiles collapse toward each other on a short window: below about 20 samples the 95th
  // percentile IS the maximum, so p95, p99 and max all become the same single observation and
  // three different thresholds silently reduce to the strictest one.
  if (result.frames && result.frames.count < MIN_FRAME_SAMPLES_FOR_PASS) {
    reasons.push(
      `only ${result.frames.count} driven frames were collected, below the ` +
        `${MIN_FRAME_SAMPLES_FOR_PASS} needed for p95 and p99 to be distinct from max; ` +
        'the distribution is one observation wearing three labels',
    )
    if (verdict === 'pass') verdict = 'warn'
  } else if (result.frames?.degraded) {
    reasons.push(
      `the frame summary is marked degraded at ${result.frames.count} samples, under what a ` +
        'gating gesture is designed to collect; the percentiles are thin and are labelled as such ' +
        'wherever they are reported',
    )
  }

  // A settle-phase or warmup-phase histogram is not a measurement of the gesture. Nothing
  // downstream of `summarizeFrames` can tell the difference from the numbers alone, which is why
  // the phase rides on the stats and is checked here rather than trusted at the call site.
  const framesGated = evaluations.some((e) => e.source === 'frames')
  if (framesGated && result.frames && result.frames.phase !== 'driven') {
    reasons.push(
      `the frame statistics were summarized over the '${result.frames.phase}' phase, not 'driven'; ` +
        'these are not frames the gesture produced and cannot be read as its cadence',
    )
    if (verdict === 'pass') verdict = 'warn'
  }

  // Not a downgrade: the measured numbers really did clear the absolute bars in thresholds.json.
  // But those bars were written for a 60Hz panel, and on a faster one an arm can miss every second
  // deadline and still land under 16.7ms, so a reader has to see which kind of clearance this was.
  if (result.calibration.regime === 'faster-than-60hz') {
    reasons.push(
      `calibrated at ${result.calibration.medianFrameMs.toFixed(2)}ms, faster than the 60Hz panel ` +
        'the thresholds were written for; an absolute 16.7ms bar is a weaker test here than it is ' +
        'on 60Hz hardware',
    )
  }

  // A cadence bar expressed as a multiple of the calibrated period assumes the calibration
  // measured the MACHINE. It does not: the clock is calibrated with the arm already mounted and
  // the scenario's camera applied, so an arm that is slow at rest calibrates its own slowness as
  // the ceiling, and bars derived from it move down to meet it. A2 produced exactly that, a run
  // calibrating at 83.3ms and then clearing bars of 125ms and 208ms, which reads as a pass and
  // is a renderer managing twelve frames a second. A1 never tripped this because its calibration
  // read 59.88Hz on every run, so no earlier verdict depends on the difference.
  const cadenceGated = declaresCadenceMultiples(result.scenario)
  if (
    cadenceGated &&
    result.calibration.regime !== '60hz' &&
    result.calibration.regime !== 'faster-than-60hz'
  ) {
    reasons.push(
      `the frame clock calibrated at ${result.calibration.medianFrameMs.toFixed(2)}ms ` +
        `(~${result.calibration.impliedHz.toFixed(1)}Hz, regime '${result.calibration.regime}'), and ` +
        'the cadence bars are multiples of that period; nothing here can tell a genuinely slow ' +
        "display from an arm that was already slow at rest, and in the second case the bars move " +
        'down to meet the arm, so this is reported rather than certified',
    )
    if (verdict === 'pass') verdict = 'warn'
  }

  // The dispatch-to-painted percentiles are computed over keystrokes, not frames, so the frame
  // count above says nothing about them. Without a reported sample count there is no way to know
  // whether a p99 stands on a hundred observations or on three, and an unknown-width distribution
  // cannot carry a pass.
  const dispatchMetricConfigured = Object.keys(config.metrics).some((key) =>
    FRAME_QUANTIZED_SCALAR_KEYS.has(key),
  )
  if (dispatchMetricConfigured) {
    const dispatchCount = result.scalars[DISPATCH_SAMPLE_COUNT_KEY]
    if (dispatchCount === undefined) {
      reasons.push(
        `the run reports dispatch-to-painted percentiles but no '${DISPATCH_SAMPLE_COUNT_KEY}', so ` +
          'the number of observations behind them is unknown; a pass cannot be certified on an ' +
          'unknown sample count',
      )
      if (verdict === 'pass') verdict = 'warn'
    } else if (dispatchCount < MIN_DISPATCH_SAMPLES_FOR_PASS) {
      reasons.push(
        `only ${dispatchCount} dispatch-to-painted observations were collected, below the ` +
          `${MIN_DISPATCH_SAMPLES_FOR_PASS} needed for p95 and p99 to be distinct from the worst ` +
          'single observation',
      )
      if (verdict === 'pass') verdict = 'warn'
    }

    // A dispatch whose effect never became observable is an input the arm dropped, and the
    // percentiles cannot see it: they are computed over the dispatches that did land, so dropping
    // the slow ones makes the distribution look better the worse the arm behaved.
    const droppedDispatches = result.scalars[DISPATCH_DROPPED_KEY]
    if (droppedDispatches !== undefined && droppedDispatches > 0) {
      reasons.push(
        `${droppedDispatches} dispatch(es) never became observable in the arm's own state; those ` +
          'inputs were dropped and are absent from the percentiles above',
      )
      if (verdict === 'pass') verdict = 'warn'
    }
  }

  // Read off the run rather than trusting a runner to have folded them into `aborts`, for the same
  // reason failed proofs are folded in where the result is built: a check that only runs when
  // somebody remembers to call it is not a guard. Neither confounder is the arm's fault, so this
  // withholds the verdict instead of failing the arm.
  const confounders = buildConfounders(result.environment)
  if (confounders.length > 0) {
    reasons.push(...confounders)
    if (verdict === 'pass') verdict = 'warn'
  }

  if (config.collapseSubGate) {
    const collapse = evaluateCollapseSubGate(result, config.collapseSubGate)
    reasons.push(...collapse.reasons)
    if (!collapse.ok) {
      // "Regardless of percentiles": a collapse failure overrides whatever the metric
      // tiers alone would have said, including a metric-driven pass.
      verdict = 'fail'
    }
  }

  return { scenario: result.scenario, verdict, reasons }
}

// ---- arm verdict ------------------------------------------------------------------------

export type ArmOutcome = 'go' | 'no-go' | 'invalid'

export interface ArmVerdict {
  readonly arm: ArmId
  readonly outcome: ArmOutcome
  readonly controlVerdict: ScenarioVerdict | null
  readonly scenarioVerdicts: readonly ScenarioVerdict[]
  readonly reasons: readonly string[]
}

const KNOWN_SCENARIO_IDS: ReadonlySet<string> = new Set([
  'S1',
  'S2',
  'S3',
  'S4a',
  'S4b',
  'S5',
  'S5x',
  'S6',
  'S7',
  'S8',
  'S9',
])

function isScenarioId(value: string): value is ScenarioId {
  return KNOWN_SCENARIO_IDS.has(value)
}

function isGatingScenario(id: ScenarioId): boolean {
  const entry: ScenarioThresholds | undefined = thresholds.scenarios[id]
  return entry?.gating ?? false
}

// ---- calibration coherence ------------------------------------------------------------------

/**
 * How far a gating run's calibrated cadence may sit from the control's before the two stop being
 * comparable. 20% is well inside one regime step (16.7ms to 33.3ms is 100%) but well outside the
 * jitter of a quiet machine.
 */
const CALIBRATION_DIVERGENCE_RATIO = 1.2

/** Absolute slack so a fast display, where 20% is a fraction of a millisecond, is not flagged for
 *  noise that no threshold in the file could resolve. */
const CALIBRATION_DIVERGENCE_GRACE_MS = 1

function describeCalibration(calibration: ClockCalibration): string {
  return (
    `${calibration.medianFrameMs.toFixed(2)}ms (regime ${calibration.regime}, ` +
    `~${calibration.impliedHz.toFixed(1)}Hz)`
  )
}

function isUsableCalibration(calibration: ClockCalibration): boolean {
  return Number.isFinite(calibration.medianFrameMs) && calibration.medianFrameMs > 0
}

/**
 * Calibration is measured per run, and every threshold in the file is an absolute millisecond
 * figure read against it. So two runs calibrated at different cadences were judged by different
 * yardsticks, and the control's clearance says nothing about the gating run's. The classic wrong
 * verdict is a control calibrated at 60Hz and a gating run calibrated at 30Hz: the control passes,
 * the gating run's own thresholds all fall below its floor, and the arm collects a decision from a
 * comparison that was never sound.
 */
function calibrationDiverges(reference: ClockCalibration, other: ClockCalibration): boolean {
  if (!isUsableCalibration(reference) || !isUsableCalibration(other)) return true
  if (reference.regime !== other.regime) return true
  if (Math.abs(reference.medianFrameMs - other.medianFrameMs) <= CALIBRATION_DIVERGENCE_GRACE_MS) {
    return false
  }
  const ratio = Math.max(
    reference.medianFrameMs / other.medianFrameMs,
    other.medianFrameMs / reference.medianFrameMs,
  )
  return ratio > CALIBRATION_DIVERGENCE_RATIO
}

/**
 * Compares every run that feeds the decision against the control's calibration. Non-gating rows
 * are left out on purpose: they are recorded as headroom and never contribute to the outcome, so
 * a different clock under them changes nothing.
 */
export function findCalibrationDivergences(
  control: ClockCalibration,
  results: readonly RunResult[],
): readonly string[] {
  const divergences: string[] = []
  for (const result of results) {
    if (result.scenario !== 'control' && !isGatingScenario(result.scenario)) continue
    if (!calibrationDiverges(control, result.calibration)) continue
    divergences.push(
      `scenario '${result.scenario}' calibrated at ${describeCalibration(result.calibration)} ` +
        `against the control's ${describeCalibration(control)}; the two runs were judged against ` +
        'different achievable cadences, so their comparison is not sound',
    )
  }
  return divergences
}

/**
 * "An arm PASSES only if it clears EVERY gating scenario... and the control measurement
 * must have passed or NO result from that arm is valid." Both halves of that rule are
 * structural guards, not judgement calls: a missing control, a failed control, a missing
 * gating scenario, an aborted gating scenario, a gating scenario measured on a non-gating
 * engine, or a gating scenario calibrated at a materially different cadence than the control
 * all produce `'invalid'` rather than a `'go'` reached by omission.
 */
export function evaluateArm(results: readonly RunResult[]): ArmVerdict {
  if (results.length === 0) {
    throw new Error('evaluateArm requires at least one RunResult; an empty array names no arm')
  }

  const arm = results[0].arm
  for (const r of results) {
    if (r.arm !== arm) {
      throw new Error(
        `evaluateArm received results from multiple arms ('${arm}' and '${r.arm}'); call it once per arm`,
      )
    }
  }

  const controlResults = results.filter((r) => r.scenario === 'control')
  if (controlResults.length === 0) {
    return {
      arm,
      outcome: 'invalid',
      controlVerdict: null,
      scenarioVerdicts: [],
      reasons: [
        `no control measurement present for arm '${arm}'; per the control-measurement rule, no ` +
          'result from this arm is valid without it',
      ],
    }
  }

  // Every supplied trial of the control must pass; one clean trial does not excuse another
  // that failed, the same "no trading one run against another" discipline as any scenario.
  const controlVerdicts = controlResults.map(evaluateScenario)
  const failedControl = controlVerdicts.find((v) => v.verdict !== 'pass')
  if (failedControl) {
    return {
      arm,
      outcome: 'invalid',
      controlVerdict: failedControl,
      scenarioVerdicts: [],
      reasons: [
        `control measurement did not pass ('${failedControl.verdict}') for arm '${arm}'; the arm ` +
          'is misbuilt and no result from it is valid',
        ...failedControl.reasons,
      ],
    }
  }

  const controlVerdict = controlVerdicts[0] ?? null
  const nonControl = results.filter((r) => r.scenario !== 'control')
  const scenarioVerdicts = nonControl.map(evaluateScenario)
  const reasons: string[] = []

  const gatingScenarioIds = Object.entries(thresholds.scenarios)
    .filter(([id, spec]) => spec.gating && isScenarioId(id))
    .map(([id]) => id as ScenarioId)

  const coveredGating = new Set(nonControl.filter((r) => isGatingScenario(r.scenario)).map((r) => r.scenario))
  const missingGating = gatingScenarioIds.filter((id) => !coveredGating.has(id))
  if (missingGating.length > 0) {
    reasons.push(
      `arm '${arm}' is missing a result for gating scenario(s): ${missingGating.join(', ')}; a ` +
        'go/no-go decision cannot be certified without every gating scenario measured',
    )
    return { arm, outcome: 'invalid', controlVerdict, scenarioVerdicts, reasons }
  }

  const abortedGating = scenarioVerdicts.filter((v) => isGatingScenario(v.scenario) && v.verdict === 'aborted')
  if (abortedGating.length > 0) {
    reasons.push(
      `arm '${arm}' has aborted run(s) for gating scenario(s): ` +
        `${abortedGating.map((v) => v.scenario).join(', ')}; these must be re-run before a decision`,
    )
    return { arm, outcome: 'invalid', controlVerdict, scenarioVerdicts, reasons }
  }

  const nonGatingFidelity = scenarioVerdicts.filter(
    (v) => isGatingScenario(v.scenario) && v.verdict === 'not-gating',
  )
  if (nonGatingFidelity.length > 0) {
    reasons.push(
      `arm '${arm}' has gating scenario(s) measured on a non-gating engine: ` +
        `${nonGatingFidelity.map((v) => v.scenario).join(', ')}; cannot certify go without a ` +
        'gating-fidelity measurement',
    )
    return { arm, outcome: 'invalid', controlVerdict, scenarioVerdicts, reasons }
  }

  // Checked before the fail branch, not after: a run measured against a different clock than the
  // control is unsound in both directions, and eliminating an arm on an unsound comparison is the
  // same mistake as passing one. Either way the answer is to re-run, which is what 'invalid' says.
  const divergences = findCalibrationDivergences(controlResults[0].calibration, results)
  if (divergences.length > 0) {
    reasons.push(
      `arm '${arm}' has run(s) whose clock calibration does not match the control's; the decision ` +
        'cannot rest on a comparison across two different achievable cadences',
      ...divergences,
    )
    return { arm, outcome: 'invalid', controlVerdict, scenarioVerdicts, reasons }
  }

  const failedGating = scenarioVerdicts.filter((v) => isGatingScenario(v.scenario) && v.verdict === 'fail')
  if (failedGating.length > 0) {
    reasons.push(`arm '${arm}' fails gating scenario(s): ${failedGating.map((v) => v.scenario).join(', ')}`)
    return { arm, outcome: 'no-go', controlVerdict, scenarioVerdicts, reasons }
  }

  // A warn on a gating scenario is not a weak pass, it is an absent one: the metric was
  // unachievable at the measured cadence, or too few frames were collected for the percentiles
  // to mean anything. Either way the scenario was never really evaluated, so the honest outcome
  // is inconclusive rather than a go the numbers do not support.
  const warnGating = scenarioVerdicts.filter((v) => isGatingScenario(v.scenario) && v.verdict === 'warn')
  if (warnGating.length > 0) {
    reasons.push(
      `arm '${arm}' has gating scenario(s) that could not be evaluated, only warned: ` +
        `${warnGating.map((v) => v.scenario).join(', ')}; a warn is an inconclusive measurement, ` +
        'never a pass',
    )
    return { arm, outcome: 'invalid', controlVerdict, scenarioVerdicts, reasons }
  }

  reasons.push(`arm '${arm}' clears every gating scenario and the control measurement`)
  return { arm, outcome: 'go', controlVerdict, scenarioVerdicts, reasons }
}
