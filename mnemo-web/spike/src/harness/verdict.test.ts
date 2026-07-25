/**
 * These tests weight the refusal rules heavily on purpose: a bug in a rule that turns an
 * unmeasurable or aborted row into 'pass' is a silent wrong verdict, and this file exists
 * to make that class of bug loud in CI instead of loud in the Go/no-go writeup.
 */

import { describe, expect, it } from 'vitest'

import type {
  ClockCalibration,
  EnvironmentFacts,
  FrameStats,
  OnScreenCounts,
  RunResult,
  ScenarioId,
} from './contract'
import { MIN_FRAMES_FOR_STABLE_PERCENTILES } from './measure'
import {
  MIN_FRAME_SAMPLES_FOR_PASS,
  assertMetricKeysKnown,
  evaluateArm,
  evaluateCollapseSubGate,
  evaluateScenario,
  findCalibrationDivergences,
  thresholds,
} from './verdict'
import type { ThresholdsFile } from './verdict'

// ---- fixtures -----------------------------------------------------------------------------

function frameStats(overrides: Partial<FrameStats> = {}): FrameStats {
  const count = overrides.count ?? 600
  return {
    phase: 'driven',
    count,
    // Derived rather than fixed, so a fixture cannot claim a wide distribution it does not have.
    degraded: count < MIN_FRAMES_FOR_STABLE_PERCENTILES,
    p50: 8,
    p95: 10,
    p99: 12,
    max: 20,
    pctOver16_7: 0,
    pctOver33_3: 0,
    ...overrides,
  }
}

function calibration(overrides: Partial<ClockCalibration> = {}): ClockCalibration {
  return { medianFrameMs: 16.7, impliedHz: 59.9, regime: '60hz', ...overrides }
}

function environment(overrides: Partial<EnvironmentFacts> = {}): EnvironmentFacts {
  return {
    userAgent: 'test-agent',
    hardwareConcurrency: 8,
    devicePixelRatio: 1,
    viewportWidth: 1600,
    viewportHeight: 900,
    isProductionBuild: true,
    strictModeDetected: false,
    eventTimingAvailable: true,
    supportedEntryTypes: ['event'],
    rasterizer: 'test-gpu',
    contentVisibilitySupported: true,
    heapUsedBytes: null,
    ...overrides,
  }
}

function onScreen(overrides: Partial<OnScreenCounts> = {}): OnScreenCounts {
  return { elements: 50, edges: 40, domNodes: 500, ...overrides }
}

function baseResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    arm: 'a1-reactflow',
    scenario: 'S2',
    fixtureLayout: 'forest',
    fixtureDigest: 'digest-abc',
    elementCount: 5000,
    edgeCount: 4580,
    lodEnabled: true,
    viewport: { x: 0, y: 0, zoom: 1 },
    onScreen: onScreen(),
    calibration: calibration(),
    frames: frameStats(),
    latency: null,
    scalars: {},
    proofs: [],
    aborts: [],
    environment: environment(),
    engineFidelity: 'gating',
    startedAt: 0,
    durationMs: 10_000,
    ...overrides,
  }
}

// ---- evaluateScenario: aborted runs -------------------------------------------------------

describe('the aborted-run guard', () => {
  it('is aborted whenever aborts is non-empty, regardless of how good the metrics look', () => {
    const result = baseResult({
      aborts: ['gesture proof failed: committed transform did not match state'],
      frames: frameStats({ p95: 1, p99: 1, max: 1 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('aborted')
    expect(verdict.reasons).toContain('gesture proof failed: committed transform did not match state')
  })

  it('can never be pass, even when every threshold clears', () => {
    const result = baseResult({ aborts: ['watchdog: window lost visibility mid-run'] })
    expect(evaluateScenario(result).verdict).not.toBe('pass')
  })

  it('takes priority over a non-gating engine, both are terminal but aborted is reported', () => {
    const result = baseResult({ aborts: ['hang detected'], engineFidelity: 'lead' })
    expect(evaluateScenario(result).verdict).toBe('aborted')
  })
})

// ---- evaluateScenario: engine fidelity ------------------------------------------------------

describe('the engine-fidelity refusal', () => {
  it.each(['lead', 'correctness-only'] as const)('refuses pass/fail for a %s row', (fidelity) => {
    const result = baseResult({ engineFidelity: fidelity, frames: frameStats({ p95: 1, p99: 1, max: 1 }) })
    expect(evaluateScenario(result).verdict).toBe('not-gating')
  })

  it('refuses even when the metrics would obviously fail', () => {
    const result = baseResult({
      engineFidelity: 'lead',
      frames: frameStats({ p95: 500, p99: 500, max: 500 }),
    })
    expect(evaluateScenario(result).verdict).toBe('not-gating')
  })
})

// ---- evaluateScenario: scenario-level non-gating --------------------------------------------

describe('a scenario marked non-gating in thresholds.json', () => {
  it('returns not-gating for S4b regardless of measured frames', () => {
    const result = baseResult({ scenario: 'S4b', frames: frameStats({ p95: 999, p99: 999, max: 999 }) })
    expect(evaluateScenario(result).verdict).toBe('not-gating')
  })

  it('does not crash when the scenario has no configured metrics at all', () => {
    const result = baseResult({ scenario: 'S4b', frames: null, scalars: {} })
    expect(() => evaluateScenario(result)).not.toThrow()
  })
})

// ---- evaluateScenario: frame-based metrics ---------------------------------------------------

describe('frame-based scenarios', () => {
  it('passes only when every configured metric clears', () => {
    const result = baseResult({ frames: frameStats({ p95: 10, p99: 20, max: 30 }) })
    expect(evaluateScenario(result).verdict).toBe('pass')
  })

  it('fails on a single metric miss even when the others clear comfortably', () => {
    const result = baseResult({ frames: frameStats({ p95: 10, p99: 20, max: 999 }) })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('fail')
    expect(verdict.reasons.some((r) => r.includes('[fail] max'))).toBe(true)
  })

  it('never averages: a single bad metric cannot be offset by two good ones', () => {
    const result = baseResult({ frames: frameStats({ p95: 1, p99: 1, max: 1000 }) })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })
})

// ---- evaluateScenario / evaluateCollapseSubGate: S4a collapse sub-gate -----------------------

describe('the S4a collapse sub-gate', () => {
  const gate = { noFrameOverMs: 250, noHang: true, noBlankRender: true }

  it('passes when nothing collapsed', () => {
    const result = baseResult({
      scenario: 'S4a',
      elementCount: 5000,
      onScreen: onScreen({ elements: 5000 }),
      frames: frameStats({ max: 60 }),
    })
    expect(evaluateCollapseSubGate(result, gate).ok).toBe(true)
  })

  it('fails on a frame over the collapse ceiling', () => {
    const result = baseResult({ frames: frameStats({ max: 400 }) })
    const outcome = evaluateCollapseSubGate(result, gate)
    expect(outcome.ok).toBe(false)
    expect(outcome.reasons.some((r) => r.includes('collapse ceiling'))).toBe(true)
  })

  it('fails on a blank render even when every frame is fast', () => {
    const result = baseResult({
      scenario: 'S4a',
      elementCount: 5000,
      onScreen: onScreen({ elements: 0 }),
      frames: frameStats({ p95: 2, p99: 3, max: 4 }),
    })
    const outcome = evaluateCollapseSubGate(result, gate)
    expect(outcome.ok).toBe(false)
    expect(outcome.reasons.some((r) => r.includes('blank render'))).toBe(true)
  })

  it('reports a hang carried in aborts when called directly', () => {
    const result = baseResult({ aborts: ['renderer hang, no frames for 4000ms'] })
    const outcome = evaluateCollapseSubGate(result, gate)
    expect(outcome.ok).toBe(false)
    expect(outcome.reasons.some((r) => r.includes('hang reported'))).toBe(true)
  })

  it('cannot be evaluated without frame stats, and that is reported as a failure, not skipped', () => {
    const result = baseResult({ frames: null })
    const outcome = evaluateCollapseSubGate(result, gate)
    expect(outcome.ok).toBe(false)
  })

  it('forces the whole S4a verdict to fail on a blank render, regardless of percentiles', () => {
    const result = baseResult({
      scenario: 'S4a',
      elementCount: 5000,
      onScreen: onScreen({ elements: 0, edges: 0, domNodes: 0 }),
      // Every percentile here would pass S4a's own p95/p99/max thresholds on its own.
      frames: frameStats({ p95: 2, p99: 3, max: 4 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('fail')
    expect(verdict.reasons.some((r) => r.includes('blank render'))).toBe(true)
  })
})

// ---- evaluateScenario: calibration-unachievable flag ------------------------------------------

describe('the calibration-unachievable flag', () => {
  it('cannot mark a cadence percentile unachievable, because it is derived from the calibration', () => {
    // p95 and p99 are resolved as multiples of the measured frame period, so on a clean 30Hz box
    // the bar moves with the machine instead of standing still at a number it can never reach.
    // A steady 33ms/frame arm on a 33.3ms display is delivering every frame, and says so.
    const result = baseResult({
      calibration: calibration({ medianFrameMs: 33.3, impliedHz: 30, regime: '30hz' }),
      frames: frameStats({ p95: 33, p99: 33, max: 33 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.reasons.some((r) => r.includes('[unachievable] p95'))).toBe(false)
    expect(verdict.verdict).not.toBe('fail')
  })

  it('never lets the surviving metrics carry a pass once one was unachievable', () => {
    // S8's dispatch-to-painted bars are frame-quantized but absolute, so a slow enough box still
    // makes one unachievable. The survivors clearing must not then be reported as a pass: that
    // would certify the scenario against a bar that was silently deleted.
    const result = baseResult({
      scenario: 'S8',
      calibration: calibration({ medianFrameMs: 60, impliedHz: 16.7, regime: 'other' }),
      frames: null,
      scalars: {
        dispatchToPaintedP95: 60,
        dispatchToPaintedP99: 60,
        dispatchToPaintedCount: 200,
        dispatchToPaintedTimeouts: 0,
      },
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
    expect(verdict.reasons.some((r) => r.includes('cannot carry a pass'))).toBe(true)
  })

  it('does not count an unachievable metric as a clear: still fails if an achievable one misses', () => {
    const result = baseResult({
      calibration: calibration({ medianFrameMs: 33.3, impliedHz: 30, regime: '30hz' }),
      // p95 unachievable and flagged; max is achievable (30ms floor is well under 50ms) and misses.
      frames: frameStats({ p95: 33, p99: 33, max: 999 }),
    })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })

  it('withholds a pass at warn, rather than assuming one, when every metric is unachievable', () => {
    const result = baseResult({
      calibration: calibration({ medianFrameMs: 1000, impliedHz: 1, regime: 'other' }),
      frames: frameStats({ p95: 900, p99: 900, max: 900 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
  })

  it('applies the flag to S8, whose dispatch-to-painted scalars resolve no finer than one frame', () => {
    const result = baseResult({
      scenario: 'S8',
      frames: null,
      calibration: calibration({ medianFrameMs: 1000, impliedHz: 1, regime: 'other' }),
      scalars: { dispatchToPaintedP95: 900, dispatchToPaintedP99: 900, dispatchToPaintedCount: 150 },
    })
    const verdict = evaluateScenario(result)
    expect(verdict.reasons.some((r) => r.includes('[unachievable] dispatchToPaintedP95'))).toBe(true)
    expect(verdict.verdict).toBe('warn')
  })

  it('does not apply the flag to a wall-clock scalar, which is not frame-quantized', () => {
    const result = baseResult({
      scenario: 'S1',
      frames: null,
      calibration: calibration({ medianFrameMs: 1000, impliedHz: 1, regime: 'other' }),
      scalars: { mountMs: 5000, longestBlockMs: 5000 },
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('fail')
    expect(verdict.reasons.some((r) => r.includes('unachievable'))).toBe(false)
  })
})

// ---- evaluateScenario: sample counts ----------------------------------------------------------

describe('the driven-sample-count floor', () => {
  it('refuses a pass below the floor, however clean every percentile looks', () => {
    const result = baseResult({
      frames: frameStats({ count: MIN_FRAME_SAMPLES_FOR_PASS - 1, p95: 2, p99: 3, max: 4 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
    expect(verdict.reasons.some((r) => r.includes('one observation wearing three labels'))).toBe(true)
  })

  it('still fails a short run that missed a threshold: too few samples is never a rescue', () => {
    const result = baseResult({ frames: frameStats({ count: 14, p95: 999, p99: 999, max: 999 }) })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })

  it('passes above the floor but reports a degraded summary as degraded', () => {
    const result = baseResult({
      frames: frameStats({ count: MIN_FRAMES_FOR_STABLE_PERCENTILES - 1, p95: 2, p99: 3, max: 4 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('pass')
    expect(verdict.reasons.some((r) => r.includes('degraded'))).toBe(true)
  })

  it('says nothing about sample width once the summary is no longer degraded', () => {
    const result = baseResult({ frames: frameStats({ count: MIN_FRAMES_FOR_STABLE_PERCENTILES }) })
    expect(evaluateScenario(result).reasons.some((r) => r.includes('degraded'))).toBe(false)
  })

  it('refuses a pass on frames summarized over a phase other than driven', () => {
    // A settle histogram is an idle histogram. Nothing in the percentiles themselves says so.
    const result = baseResult({ frames: frameStats({ phase: 'settle', p95: 2, p99: 3, max: 4 }) })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
    expect(verdict.reasons.some((r) => r.includes("'settle' phase"))).toBe(true)
  })

  it('does not complain about phase when the scenario gates on no frame metric', () => {
    const result = baseResult({
      scenario: 'S1',
      frames: frameStats({ phase: 'settle' }),
      scalars: { mountMs: 500, longestBlockMs: 50 },
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('pass')
  })

  it('refuses an S8 pass when the run never reported how many dispatches it measured', () => {
    // The percentiles are computed over keystrokes, so the frame count says nothing about them:
    // without a reported count, a p99 standing on three observations is indistinguishable from one
    // standing on three hundred.
    const result = baseResult({
      scenario: 'S8',
      frames: null,
      scalars: { dispatchToPaintedP95: 20, dispatchToPaintedP99: 40 },
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
    expect(verdict.reasons.some((r) => r.includes('dispatchToPaintedCount'))).toBe(true)
  })

  it('refuses an S8 pass on too few dispatch observations', () => {
    const result = baseResult({
      scenario: 'S8',
      frames: null,
      scalars: { dispatchToPaintedP95: 20, dispatchToPaintedP99: 40, dispatchToPaintedCount: 12 },
    })
    expect(evaluateScenario(result).verdict).toBe('warn')
  })

  it('refuses an S8 pass when any dispatch never became observable', () => {
    // Dropped inputs are absent from the percentiles by construction, so the distribution looks
    // better the more of them there were.
    const result = baseResult({
      scenario: 'S8',
      frames: null,
      scalars: {
        dispatchToPaintedP95: 20,
        dispatchToPaintedP99: 40,
        dispatchToPaintedCount: 150,
        dispatchToPaintedTimeouts: 3,
      },
    })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
    expect(verdict.reasons.some((r) => r.includes('never became observable'))).toBe(true)
  })
})

// ---- evaluateScenario: a clock faster than the thresholds were written for --------------------

describe('a faster-than-60hz panel', () => {
  it('says so in the reasons, since an absolute 16.7ms bar is a weaker test there', () => {
    const result = baseResult({
      calibration: calibration({ medianFrameMs: 8.3, impliedHz: 120.5, regime: 'faster-than-60hz' }),
      frames: frameStats({ p95: 16.6, p99: 16.6, max: 16.6 }),
    })
    const verdict = evaluateScenario(result)
    expect(verdict.reasons.some((r) => r.includes('faster than the 60Hz panel'))).toBe(true)
  })
})

// ---- evaluateScenario: build confounders ------------------------------------------------------

describe('the build-confounder refusal', () => {
  it('refuses a pass measured on a development build', () => {
    const result = baseResult({ environment: environment({ isProductionBuild: false }) })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('warn')
    expect(verdict.reasons.some((r) => r.includes('development build'))).toBe(true)
  })

  it('refuses a pass measured with StrictMode double-invoking every render', () => {
    const result = baseResult({ environment: environment({ strictModeDetected: true }) })
    expect(evaluateScenario(result).verdict).toBe('warn')
  })

  it('does not refuse an engine without Event Timing, which gates nothing', () => {
    const result = baseResult({
      environment: environment({ eventTimingAvailable: false, supportedEntryTypes: [] }),
    })
    expect(evaluateScenario(result).verdict).toBe('pass')
  })
})

// ---- evaluateScenario: missing measurements ---------------------------------------------------

describe('a missing measurement', () => {
  it('fails loudly rather than being silently skipped', () => {
    const result = baseResult({ frames: null })
    const verdict = evaluateScenario(result)
    expect(verdict.verdict).toBe('fail')
    expect(verdict.reasons.some((r) => r.includes('missing measurement'))).toBe(true)
  })

  it('fails S8 when the dispatch-to-painted scalars were never recorded', () => {
    const result = baseResult({ scenario: 'S8', frames: null, latency: null, scalars: {} })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })

  it('fails S8 when Event Timing latency was collected but the gating scalars were not', () => {
    // Event Timing entries are corroboration only. A row carrying them and nothing else has not
    // measured what S8 gates on, however complete the latency block looks.
    const result = baseResult({
      scenario: 'S8',
      frames: null,
      latency: { count: 50, p95: 20, p99: 30, max: 40 },
      scalars: {},
    })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })

  it('fails S1 when the scalar bag never received mountMs', () => {
    const result = baseResult({ scenario: 'S1', frames: null, scalars: { longestBlockMs: 10 } })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })
})

// ---- evaluateScenario: scalar pass/warn/fail tiers --------------------------------------------

describe('scalar pass/warn/fail metrics (S1)', () => {
  it('passes within the pass ceiling', () => {
    const result = baseResult({ scenario: 'S1', frames: null, scalars: { mountMs: 900, longestBlockMs: 100 } })
    expect(evaluateScenario(result).verdict).toBe('pass')
  })

  it('warns between pass and warn', () => {
    const result = baseResult({ scenario: 'S1', frames: null, scalars: { mountMs: 2000, longestBlockMs: 100 } })
    expect(evaluateScenario(result).verdict).toBe('warn')
  })

  it('fails beyond the warn ceiling', () => {
    const result = baseResult({ scenario: 'S1', frames: null, scalars: { mountMs: 5000, longestBlockMs: 100 } })
    expect(evaluateScenario(result).verdict).toBe('fail')
  })
})

// ---- thresholds.json loading --------------------------------------------------------------------

describe('loading thresholds.json', () => {
  it('loads the committed file with all eleven scenarios', () => {
    expect(thresholds.version).toBe(3)
    expect(Object.keys(thresholds.scenarios)).toHaveLength(11)
  })

  it('gates S8 on the dispatch-to-painted scalars, never on Event Timing', () => {
    const s8 = thresholds.scenarios.S8
    expect(Object.keys(s8.metrics ?? {})).toEqual(['dispatchToPaintedP95', 'dispatchToPaintedP99'])
  })

  it('rejects a metric key no reader exists for, rather than scoring it as a missing measurement', () => {
    // A config typo must surface as a broken threshold file at load, not as a failed arm: an
    // unreadable key reads as 'the renderer never produced this number'.
    const withTypo: ThresholdsFile = {
      ...thresholds,
      scenarios: { ...thresholds.scenarios, S2: { ...thresholds.scenarios.S2, metrics: { p95ms: 16.7 } } },
    }
    expect(() => assertMetricKeysKnown(withTypo)).toThrow(/p95ms/)
  })

  it('accepts every frame statistic as a gateable key, so tightening the file needs no code change', () => {
    const withBandCount: ThresholdsFile = {
      ...thresholds,
      scenarios: {
        ...thresholds.scenarios,
        S2: { ...thresholds.scenarios.S2, metrics: { pctOver16_7: 5, pctOver33_3: 1, p50: 16.7 } },
      },
    }
    expect(() => assertMetricKeysKnown(withBandCount)).not.toThrow()
  })

  it('evaluates the control measurement through thresholds.controlMeasurement, not thresholds.scenarios', () => {
    const passing = baseResult({ scenario: 'control', frames: frameStats({ p95: 10 }) })
    expect(evaluateScenario(passing).verdict).toBe('pass')

    const failing = baseResult({ scenario: 'control', frames: frameStats({ p95: 999 }) })
    expect(evaluateScenario(failing).verdict).toBe('fail')
  })
})

// ---- evaluateArm ----------------------------------------------------------------------------

const GATING_SCENARIOS: readonly ScenarioId[] = ['S1', 'S2', 'S3', 'S4a', 'S5', 'S5x', 'S6', 'S7', 'S8', 'S9']

function passingResultFor(scenario: ScenarioId): RunResult {
  switch (scenario) {
    case 'S1':
      return baseResult({ scenario, frames: null, scalars: { mountMs: 500, longestBlockMs: 50 } })
    case 'S4a':
      return baseResult({
        scenario,
        elementCount: 5000,
        onScreen: onScreen({ elements: 5000 }),
        frames: frameStats({ p95: 10, p99: 20, max: 30 }),
      })
    case 'S5x':
      return baseResult({ scenario, frames: null, scalars: { worstFrameAtCrossingMs: 50 } })
    case 'S8':
      return baseResult({
        scenario,
        frames: null,
        scalars: { dispatchToPaintedP95: 20, dispatchToPaintedP99: 40, dispatchToPaintedCount: 150 },
      })
    case 'S9':
      return baseResult({ scenario, frames: null, scalars: { timeToPaintedMs: 200, longestBlockMs: 50 } })
    default:
      return baseResult({ scenario, frames: frameStats({ p95: 10, p99: 20, max: 30 }) })
  }
}

function allGatingScenarioResults(): RunResult[] {
  return GATING_SCENARIOS.map(passingResultFor)
}

function passingControl(): RunResult {
  return baseResult({ scenario: 'control', frames: frameStats({ p95: 10 }) })
}

describe('evaluateArm: the control-measurement invalidation rule', () => {
  it('is invalid when no control measurement is present at all', () => {
    const verdict = evaluateArm([baseResult({ scenario: 'S2' })])
    expect(verdict.outcome).toBe('invalid')
  })

  it('is invalid when the control measurement fails, even though every gating scenario passes', () => {
    const control = baseResult({ scenario: 'control', frames: frameStats({ p95: 999 }) })
    const verdict = evaluateArm([control, ...allGatingScenarioResults()])
    expect(verdict.outcome).toBe('invalid')
    // No scenario result is valid once the control fails, so none are reported as usable.
    expect(verdict.scenarioVerdicts).toHaveLength(0)
  })

  it('is go when the control passes and every gating scenario clears', () => {
    const verdict = evaluateArm([passingControl(), ...allGatingScenarioResults()])
    expect(verdict.outcome).toBe('go')
  })

  it('is no-go when the control passes but one gating scenario fails', () => {
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S3' ? baseResult({ ...r, frames: frameStats({ p95: 999, p99: 999, max: 999 }) }) : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('no-go')
  })

  it('is invalid, not go by omission, when a gating scenario has no result at all', () => {
    const rest = allGatingScenarioResults().filter((r) => r.scenario !== 'S9')
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
    expect(verdict.reasons.some((r) => r.includes('S9'))).toBe(true)
  })

  it('is invalid when a gating scenario aborted', () => {
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S6' ? baseResult({ ...r, aborts: ['proof of execution failed'] }) : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
  })

  it('is invalid when a gating scenario was only measured on a non-gating engine', () => {
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S7' ? baseResult({ ...r, engineFidelity: 'lead' }) : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
  })

  it('is invalid, never go, when a gating scenario only reached warn', () => {
    // A warn is an absent evaluation, not a weak pass: the metric was unachievable, the sample
    // count was too thin, or the build was confounded. None of those support a decision.
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S1' ? baseResult({ ...r, scalars: { mountMs: 2000, longestBlockMs: 100 } }) : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
    expect(verdict.reasons.some((r) => r.includes('S1'))).toBe(true)
  })

  it('is invalid when a gating scenario collected too few driven frames to pass on', () => {
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S2'
        ? baseResult({ ...r, frames: frameStats({ count: 14, p95: 2, p99: 3, max: 4 }) })
        : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
  })

  it('is invalid when a gating run failed a proof of execution, which reaches it as an abort', () => {
    // buildRunResult folds a failed proof into aborts, so the gesture that never landed cannot
    // reach the verdict as a flawless idle histogram.
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S6'
        ? baseResult({
            ...r,
            proofs: [
              {
                gesture: 'drag 400px',
                stateMatched: false,
                committedMatched: false,
                expected: 'dx 400',
                actual: 'dx 0',
              },
            ],
            aborts: ["proof of execution failed for 'drag 400px': expected dx 400, actual dx 0"],
            frames: frameStats({ p95: 1, p99: 1, max: 1 }),
          })
        : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
  })

  it('throws if results come from more than one arm', () => {
    const control = baseResult({ scenario: 'control', arm: 'a1-reactflow' })
    const other = baseResult({ scenario: 'S2', arm: 'a2-dom' })
    expect(() => evaluateArm([control, other])).toThrow()
  })

  it('throws on an empty result list rather than returning an unattributed verdict', () => {
    expect(() => evaluateArm([])).toThrow()
  })
})

// ---- evaluateArm: calibration coherence -------------------------------------------------------

describe('the control-versus-gating calibration cross-check', () => {
  // The default fixture clock, which every result below shares unless it is deliberately moved.
  const sixtyHz = calibration()
  const thirtyHz = calibration({ medianFrameMs: 33.3, impliedHz: 30, regime: '30hz' })
  const oneTwentyHz = calibration({ medianFrameMs: 8.3, impliedHz: 120.5, regime: 'faster-than-60hz' })

  it('is invalid when the control calibrated at 60Hz and a gating run at 30Hz', () => {
    // The wrong verdict this exists to prevent: the control clears its 16.7ms p95 on a fast clock,
    // every gating scenario is then measured on a slow one where its own thresholds sit below the
    // floor, and the arm collects a decision without one frame number ever being compared.
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S4a' ? baseResult({ ...r, calibration: thirtyHz }) : r,
    )
    const verdict = evaluateArm([passingControl(), ...rest])
    expect(verdict.outcome).toBe('invalid')
    expect(verdict.reasons.some((r) => r.includes('S4a') && r.includes('not sound'))).toBe(true)
  })

  it('is invalid when a gating run drifted materially inside one regime', () => {
    // Same regime label, a quarter faster than the control. Every threshold is an absolute
    // millisecond figure, so the two runs were held to bars that do not mean the same thing.
    const drifted = calibration({ medianFrameMs: 13.4, impliedHz: 74.6, regime: '60hz' })
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S7' ? baseResult({ ...r, calibration: drifted }) : r,
    )
    expect(evaluateArm([passingControl(), ...rest]).outcome).toBe('invalid')
  })

  it('tolerates the jitter of a quiet machine', () => {
    const jittered = calibration({ medianFrameMs: 16.2, impliedHz: 61.7, regime: '60hz' })
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S3' ? baseResult({ ...r, calibration: jittered }) : r,
    )
    expect(evaluateArm([passingControl(), ...rest]).outcome).toBe('go')
  })

  it('flags a gating run that calibrated materially faster than the control, not only slower', () => {
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S5' ? baseResult({ ...r, calibration: oneTwentyHz }) : r,
    )
    expect(evaluateArm([passingControl(), ...rest]).outcome).toBe('invalid')
  })

  it('does not let a diverged clock eliminate an arm either: unsound is invalid, not no-go', () => {
    const rest = allGatingScenarioResults().map((r) =>
      r.scenario === 'S2'
        ? baseResult({ ...r, calibration: thirtyHz, frames: frameStats({ p95: 999, p99: 999, max: 999 }) })
        : r,
    )
    expect(evaluateArm([passingControl(), ...rest]).outcome).toBe('invalid')
  })

  it('ignores a non-gating row measured on a different clock, since it never feeds the outcome', () => {
    const headroom = baseResult({ scenario: 'S4b', calibration: thirtyHz, frames: frameStats({ p95: 900 }) })
    expect(evaluateArm([passingControl(), headroom, ...allGatingScenarioResults()]).outcome).toBe('go')
  })

  it('treats an unusable calibration reading as a divergence rather than trusting it', () => {
    const broken = calibration({ medianFrameMs: 0, impliedHz: Infinity, regime: 'other' })
    expect(findCalibrationDivergences(sixtyHz, [baseResult({ calibration: broken })])).toHaveLength(1)
  })

  it('reports every diverged run, not just the first', () => {
    const divergences = findCalibrationDivergences(sixtyHz, [
      baseResult({ scenario: 'S2', calibration: thirtyHz }),
      baseResult({ scenario: 'S3', calibration: thirtyHz }),
      baseResult({ scenario: 'S6', calibration: sixtyHz }),
    ])
    expect(divergences).toHaveLength(2)
  })
})
