/**
 * The spike's entry point: one page load measures one scenario against one arm.
 *
 * The order of operations here is the measurement protocol, not a convenience. Setup is
 * fenced off from measurement by the `/__probe/measure-ready` POST so a five-thousand element
 * mount is not charged to a frame budget. The clock is calibrated after the arm is mounted and
 * settled, because the number that matters is what this machine can do in the state the
 * scenario runs in. Confounders are asserted before anything is driven, and every one of them
 * lands in `aborts` rather than in a console message nobody reads.
 *
 * Nothing here decides a verdict. It assembles a `RunResult` and hands it to the threshold
 * file's own evaluator, which is what keeps a softened bar a visible commit rather than a
 * quiet edit to the runner.
 *
 * Every failure path still publishes. A run that dies silently is indistinguishable from a run
 * that was never started, and the operator driving this from a host process has no console.
 */

import type {
  ArmHandle,
  ArmId,
  ArmModule,
  ArmMountArgs,
  ClockCalibration,
  EngineFidelity,
  EnvironmentFacts,
  FrameStats,
  LatencyStats,
  ProofOfExecution,
  RunResult,
  ScenarioId,
  ScenarioVerdict,
} from './harness/contract'
import type { MindmapFixture } from './fixture/model'
import { generateFixtureWithRoles, type FixtureRoles } from './fixture/generate'
import { assertConfounders, captureEnvironment, watchVisibility } from './harness/env'
import { StrictModeProbe } from './harness/strict-mode-probe'
import {
  GestureDriver,
  ProofLedger,
  awaitFrames,
  awaitSettled,
} from './harness/driver'
import {
  calibrateClock,
  createEventTimingObserver,
  createFrameSampler,
  type EventTimingObserver,
} from './harness/measure'
import { buildRunResult, publishFailure, publishResult, summarizeToMarkdown } from './harness/report'
import { evaluateScenario } from './harness/verdict'
import {
  SCENARIO_PLANS,
  applyScenarioViewport,
  createOccupancyTest,
  resolveScenarioId,
  worstFrameDeltaMs,
  type ScenarioContext,
  type ScenarioOutcome,
  type ScenarioPlan,
} from './scenarios'

/** Long enough for the cadence probe's median to be a median rather than a handful of frames. */
const CLOCK_CALIBRATION_MS = 3000

/** Frames to let a fresh mount quiet down before the clock is calibrated against it. */
const POST_MOUNT_FRAMES = 10

// ---- run configuration ---------------------------------------------------------------------

interface RunConfig {
  readonly scenario: ScenarioId
  readonly armId: ArmId
  readonly elementCount: number
  readonly seed: number
  readonly repeat: number
  readonly engineFidelity: EngineFidelity
  /** Why that fidelity was chosen, carried into the run so a reader never has to guess. */
  readonly engineFidelityReason: string
}

const ARM_ALIASES: Readonly<Record<string, ArmId>> = {
  a1: 'a1-reactflow',
  'a1-reactflow': 'a1-reactflow',
  a2: 'a2-dom',
  'a2-dom': 'a2-dom',
  a3: 'a3-canvas',
  'a3-canvas': 'a3-canvas',
}

function parsePositiveInt(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key)
  if (raw === null || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`query parameter '${key}' must be a positive integer, got "${raw}"`)
  }
  return value
}

/**
 * Chromium and its embeddings, which is what WebView2 is. Matched from the user agent because
 * that is the only signal available in the page, and it is only ever used to reach the SAFE
 * default faster; a real run states its box explicitly.
 */
function isChromiumFamily(userAgent: string): boolean {
  return /\b(?:Chrome|Chromium|Edg)\/\d/.test(userAgent)
}

const ENGINE_FIDELITIES: readonly EngineFidelity[] = ['gating', 'lead', 'correctness-only']

function isEngineFidelity(value: string): value is EngineFidelity {
  return (ENGINE_FIDELITIES as readonly string[]).includes(value)
}

/**
 * How much this run's numbers may claim.
 *
 * An explicit `fidelity` or `box` parameter always wins: only the operator knows whether a
 * WebKitGTK page is running on bare metal or under WSL, and that difference is the whole
 * reason the field exists. Detection covers the one case a page can be sure of, a
 * Chromium-family engine, and everything else falls to 'correctness-only'. Guessing 'gating'
 * from an unrecognized engine is the one mistake that cannot be corrected downstream: the
 * verdict generator trusts this field completely.
 */
function resolveEngineFidelity(
  params: URLSearchParams,
  userAgent: string,
): { readonly fidelity: EngineFidelity; readonly reason: string } {
  const explicit = params.get('fidelity')
  if (explicit !== null && explicit !== '') {
    if (!isEngineFidelity(explicit)) {
      throw new Error(
        `query parameter 'fidelity' must be one of ${ENGINE_FIDELITIES.join(', ')}, got "${explicit}"`,
      )
    }
    return { fidelity: explicit, reason: `stated by the 'fidelity' query parameter` }
  }

  const box = params.get('box') ?? ''
  if (box === 'webkitgtk-wsl' || params.get('wsl') === '1') {
    return {
      fidelity: 'lead',
      reason:
        'declared as the WSL WebKitGTK box: a strictly weaker machine, so a pass is evidence ' +
        'toward a go and a fail decides nothing',
    }
  }
  if (box === 'webview2-baremetal' || box === 'webkitgtk-baremetal') {
    return { fidelity: 'gating', reason: `declared as the bare-metal box '${box}'` }
  }

  if (isChromiumFamily(userAgent)) {
    return { fidelity: 'gating', reason: 'Chromium-family engine identified from the user agent' }
  }

  return {
    fidelity: 'correctness-only',
    reason:
      'the engine could not be identified and no box was declared, so this run defaults to the ' +
      'non-gating choice; pass box= or fidelity= to claim more',
  }
}

function parseRunConfig(params: URLSearchParams): RunConfig {
  const scenarioParam = params.get('scenario') ?? 'S2'
  const scenario = resolveScenarioId(scenarioParam)
  if (!scenario) {
    throw new Error(
      `query parameter 'scenario' must be one of ${Object.keys(SCENARIO_PLANS).join(', ')}, ` +
        `got "${scenarioParam}"`,
    )
  }

  const modeParam = params.get('mode') ?? 'a1'
  const armId = ARM_ALIASES[modeParam]
  if (!armId) {
    throw new Error(
      `query parameter 'mode' must name an arm (${Object.keys(ARM_ALIASES).join(', ')}), got "${modeParam}"`,
    )
  }

  const plan = SCENARIO_PLANS[scenario]
  const { fidelity, reason } = resolveEngineFidelity(params, navigator.userAgent)

  return {
    scenario,
    armId,
    elementCount: parsePositiveInt(params, 'n', plan.spec.elementCount),
    seed: parsePositiveInt(params, 'seed', 1),
    repeat: parsePositiveInt(params, 'repeat', 1),
    engineFidelity: fidelity,
    engineFidelityReason: reason,
  }
}

// ---- host probe ------------------------------------------------------------------------------

/**
 * Fire and forget. Running with no host attached, a plain browser tab with the dev server, is a
 * supported way to use this page, so a refused connection must not stop the run it was
 * announcing.
 */
async function postProbe(path: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // No host is listening. The DOM, the console and the download link still carry the result.
  }
}

// ---- arm loading and mounting ------------------------------------------------------------------

/**
 * Arms are built and measured sequentially: A2 exists only if A1 fails, A3 only if both do. A
 * name that has no module yet fails here rather than resolving to a stub, because a stub arm
 * would produce numbers and numbers get quoted.
 */
async function loadArm(id: ArmId): Promise<ArmModule> {
  if (id === 'a1-reactflow') {
    const imported = await import('./arms/a1')
    return imported.a1Module
  }
  throw new Error(
    `arm '${id}' is named in the contract but has no module in this build; arms are built ` +
      'sequentially and this one has not been reached',
  )
}

/**
 * An arm that can render a React node inside its own tree.
 *
 * StrictMode's double invocation is scoped to the tree that wraps it, and every arm creates its
 * own root inside `mount`, so a probe this file renders would sit in an unrelated tree and could
 * only ever report on itself. Reporting that as a verified negative is precisely the confounder
 * the check exists to catch, so the probe is only mounted into a tree that would actually
 * observe the arm's StrictMode, and when no arm offers one the read is left to come back
 * 'inconclusive' and say so.
 */
interface ProbeHostingArmModule {
  mountWithProbe(args: ArmMountArgs, probe: React.ReactNode): Promise<ArmHandle>
}

function asProbeHosting(module: ArmModule): ProbeHostingArmModule | null {
  const candidate = module as unknown as Partial<ProbeHostingArmModule>
  return typeof candidate.mountWithProbe === 'function' ? (candidate as ProbeHostingArmModule) : null
}

interface MountedArm {
  readonly arm: ArmHandle
  readonly container: HTMLElement
  readonly mountMs: number
  readonly mountLongestBlockMs: number
  readonly probeMounted: boolean
}

/**
 * Mounts the arm while sampling animation frames, so S1 gets both halves of its metric from one
 * pass: total wall clock, and the worst frame gap inside it. The gap is the portable stand-in
 * for a long task, since the Long Tasks API does not exist on WebKit and a cross-engine gate
 * cannot depend on a Chromium-only entry type.
 */
async function mountArm(
  module: ArmModule,
  args: Omit<ArmMountArgs, 'container'>,
  host: HTMLElement,
): Promise<MountedArm> {
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;inset:0;overflow:hidden'
  host.appendChild(container)

  const hosting = asProbeHosting(module)
  const sampler = createFrameSampler()
  sampler.start()
  sampler.setPhase('driven')

  const startedAt = performance.now()
  let arm: ArmHandle
  try {
    arm = hosting
      ? await hosting.mountWithProbe({ ...args, container }, <StrictModeProbe />)
      : await module.mount({ ...args, container })
  } finally {
    sampler.stop()
  }
  const mountMs = performance.now() - startedAt

  return {
    arm,
    container,
    mountMs,
    mountLongestBlockMs: worstFrameDeltaMs(sampler.collect(), 'driven'),
    probeMounted: hosting !== null,
  }
}

// ---- one trial -----------------------------------------------------------------------------------

interface TrialInput {
  readonly config: RunConfig
  readonly plan: ScenarioPlan
  readonly fixture: MindmapFixture
  readonly roles: FixtureRoles
  readonly mounted: MountedArm
  readonly environment: EnvironmentFacts
  readonly setupAborts: readonly string[]
  readonly win: Window
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * The proofs a `RunResult` is built from, sealed against the scenario's own declared minimum.
 *
 * The minimum is applied on every path, including runs that already carry a setup abort: a
 * short ledger means a gesture never ran, and that has to be recorded whatever else went
 * wrong, or a scenario could quietly report a histogram nobody proved was driven. The
 * fallback still keeps everything that did land, because on the runs that failed that
 * evidence is worth the most.
 */
function sealProofs(ledger: ProofLedger, minimum: number, aborts: string[]): readonly ProofOfExecution[] {
  try {
    return ledger.seal(minimum)
  } catch (error) {
    aborts.push(describeError(error))
  }
  try {
    return ledger.seal(1)
  } catch {
    // Nothing was proven at all, which the empty array states plainly and the abort above names.
    return []
  }
}

/**
 * Runs the scenario and assembles its `RunResult`.
 *
 * A thrown gesture is caught here rather than allowed to escape, because the ledger holds
 * evidence of everything that did land before the throw and that evidence is worth the most on
 * exactly the runs that failed. The abort is recorded, the proofs are kept, and the result is
 * still published: `buildRunResult` folds failed proofs into `aborts`, and the verdict refuses
 * to certify a row that carries any.
 */
async function runTrial(input: TrialInput): Promise<RunResult> {
  const { config, plan, fixture, roles, mounted, environment, win } = input
  const aborts: string[] = [...input.setupAborts]

  const stopVisibilityWatch = watchVisibility((state) => {
    const message =
      `the window left 'visible' (state '${state}') during the run; a hidden or occluded window ` +
      'is throttled by the compositor and its frame timing is fiction'
    if (!aborts.includes(message)) aborts.push(message)
  })

  const eventTiming: EventTimingObserver = createEventTimingObserver()
  const sampler = createFrameSampler()
  const ledger = new ProofLedger()
  const startedAt = Date.now()
  const startedAtHighRes = performance.now()

  let calibration: ClockCalibration | undefined
  let outcome: ScenarioOutcome | null = null
  let frames: FrameStats | null = null
  let latency: LatencyStats | null = null
  let scalars: Readonly<Record<string, number>> = {}

  try {
    await awaitFrames(POST_MOUNT_FRAMES, win)
    calibration = await calibrateClock(CLOCK_CALIBRATION_MS)
    await awaitSettled(calibration, { win })

    const driver = new GestureDriver(mounted.arm, {
      ledger,
      win,
      setPhase: (phase) => sampler.setPhase(phase),
      isCanvasPointOccupied: createOccupancyTest(fixture),
    })

    const ctx: ScenarioContext = {
      spec: plan.spec,
      arm: mounted.arm,
      fixture,
      roles,
      driver,
      ledger,
      sampler,
      win,
      seed: config.seed,
      viewportWidth: environment.viewportWidth,
      viewportHeight: environment.viewportHeight,
      mountMs: mounted.mountMs,
      mountLongestBlockMs: mounted.mountLongestBlockMs,
      eventTiming,
    }

    sampler.start()
    await applyScenarioViewport(ctx, plan)
    outcome = await plan.run(ctx)
  } catch (error) {
    aborts.push(`${config.scenario} aborted: ${describeError(error)}`)
  } finally {
    sampler.stop()
    eventTiming.disconnect()
    stopVisibilityWatch()
  }

  if (outcome) {
    frames = outcome.frames
    latency = outcome.latency
    scalars = outcome.scalars
  }

  const proofs = sealProofs(ledger, plan.minimumProofs, aborts)

  if (!calibration) {
    // Never fabricated: a zero would read as an infinitely fast display and would mark every
    // absolute threshold achievable.
    calibration = { medianFrameMs: Number.NaN, impliedHz: Number.NaN, regime: 'other' as const }
    aborts.push('the frame clock was never calibrated, so no threshold can be read against it')
  }

  return buildRunResult({
    arm: config.armId,
    scenario: config.scenario,
    fixture,
    lodEnabled: mounted.arm.isLodEnabled(),
    viewport: mounted.arm.getViewport(),
    onScreen: mounted.arm.getOnScreenCounts(),
    calibration,
    frames,
    latency,
    scalars,
    proofs,
    aborts,
    environment,
    engineFidelity: config.engineFidelity,
    startedAt,
    durationMs: performance.now() - startedAtHighRes,
  })
}

// ---- reporting ------------------------------------------------------------------------------------

function renderIntoPre(id: string, body: string): void {
  let element = document.getElementById(id)
  if (!element) {
    element = document.createElement('pre')
    element.id = id
    element.style.cssText =
      'position:fixed;inset:0 0 auto 0;max-height:40vh;overflow:auto;margin:0;padding:8px 12px;' +
      'background:rgba(0,0,0,0.85);font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;' +
      'z-index:2147483647'
    document.body.appendChild(element)
  }
  element.textContent = body
}

function renderSummary(config: RunConfig, results: readonly RunResult[], verdicts: readonly ScenarioVerdict[]): void {
  const header =
    `${config.armId} / ${config.scenario} / ${config.elementCount} elements / seed ${config.seed} / ` +
    `${results.length} trial(s)\nengine fidelity '${config.engineFidelity}': ${config.engineFidelityReason}\n\n`
  renderIntoPre('summary', header + summarizeToMarkdown(results, verdicts))
}

// ---- main ------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const config = parseRunConfig(params)
  const plan = SCENARIO_PLANS[config.scenario]

  // Before any setup work: the host's liveness watchdog starts from this POST, so a run that
  // hangs later is reported as a hang rather than as a page that never loaded.
  await postProbe('/__probe/ready', {
    scenario: config.scenario,
    arm: config.armId,
    elementCount: config.elementCount,
    seed: config.seed,
    repeat: config.repeat,
    engineFidelity: config.engineFidelity,
  })

  const host = document.getElementById('root')
  if (!host) throw new Error('#root is missing from the document, so the arm has nowhere to mount')

  const { fixture, roles } = generateFixtureWithRoles({
    layout: plan.spec.layout,
    elementCount: config.elementCount,
    seed: config.seed,
  })

  const results: RunResult[] = []
  const verdicts: ScenarioVerdict[] = []
  let environment: EnvironmentFacts | null = null
  let setupAborts: readonly string[] = []
  let measureReadyPosted = false

  for (let trial = 0; trial < config.repeat; trial++) {
    const initialViewport = plan.planViewport({
      fixture,
      roles,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })

    const mounted = await mountArm(
      await loadArm(config.armId),
      {
        fixture,
        initialViewport,
        lodEnabled: plan.spec.lodEnabled,
        label: `${config.armId}/${config.scenario}/trial${trial + 1}`,
      },
      host,
    )

    try {
      if (!environment) {
        // Captured after the first mount because the StrictMode probe, when an arm hosts it,
        // can only report from inside that arm's tree. The generous timeout is spent only when
        // there is actually a probe to wait for.
        environment = await captureEnvironment({ strictModeTimeoutMs: mounted.probeMounted ? 2000 : 250 })
        const violations = assertConfounders(environment)
        if (!mounted.probeMounted) {
          violations.push(
            `arm '${config.armId}' does not render StrictModeProbe inside its own React tree, so ` +
              'StrictMode could not be observed for the tree that was measured; add a ' +
              'mountWithProbe(args, probe) entry point to the arm module to make this checkable',
          )
        }
        setupAborts = violations
      }

      if (!measureReadyPosted) {
        // Setup is over. Everything after this POST is the measurement the host is timing.
        await postProbe('/__probe/measure-ready', { scenario: config.scenario, arm: config.armId })
        measureReadyPosted = true
      }

      const result = await runTrial({
        config,
        plan,
        fixture,
        roles,
        mounted,
        environment,
        setupAborts,
        win: window,
      })
      results.push(result)
      const verdict = evaluateScenario(result)
      verdicts.push(verdict)
      // The verdict travels with the result rather than living only in the page. A summary
      // assembled later from the written files must not re-derive thresholds for itself: two
      // implementations of the same rules is two chances to disagree, and the one that decides
      // the phase should be the one that ran beside the measurement.
      await publishResult({ ...result, verdict })
    } finally {
      mounted.arm.dispose()
      mounted.container.remove()
    }
  }

  renderSummary(config, results, verdicts)
}

main().catch(async (error: unknown) => {
  const message = `spike run failed before it could produce a result: ${describeError(error)}`
  renderIntoPre('result', message)
  await publishFailure(message)
})
