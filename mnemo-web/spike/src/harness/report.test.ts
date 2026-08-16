// @vitest-environment jsdom

/**
 * `publishResult` is the one function here worth testing hard: it promises four independent
 * delivery paths and promises that a failure in any one of them cannot take down the others.
 * jsdom does not implement Blob URLs, which is used below rather than worked around, since it
 * doubles as a live test of the "download path itself fails" case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProofOfExecution, RunResult, ScenarioVerdict } from './contract'
import { type BuildRunResultInput, buildRunResult, publishFailure, publishResult, summarizeToMarkdown } from './report'
import type { MindmapEdge, MindmapElement, MindmapFixture } from '../fixture/model'

// ---- fixtures -----------------------------------------------------------------------------

function tinyFixture(overrides: Partial<MindmapFixture> = {}): MindmapFixture {
  const elements: MindmapElement[] = [
    { id: 'e1', kind: 'node', content: { kind: 'text', text: 'a' }, x: 0, y: 0, width: 132, height: 40 },
    { id: 'e2', kind: 'node', content: { kind: 'text', text: 'b' }, x: 200, y: 0, width: 132, height: 40 },
  ]
  const edges: MindmapEdge[] = [{ id: 'ed1', fromId: 'e1', toId: 'e2', kind: 'hierarchy' }]
  return {
    id: 'fixture-1',
    layout: 'forest',
    elements,
    edges,
    clusterRoots: ['e1'],
    parentOf: { e2: 'e1' },
    bounds: { minX: 0, minY: 0, maxX: 332, maxY: 40 },
    digest: 'digest-xyz',
    ...overrides,
  }
}

function buildInput(overrides: Partial<BuildRunResultInput> = {}): BuildRunResultInput {
  return {
    arm: 'a1-reactflow',
    scenario: 'S2',
    fixture: tinyFixture(),
    lodEnabled: true,
    viewport: { x: 0, y: 0, zoom: 1 },
    onScreen: { elements: 2, edges: 1, domNodes: 20 },
    calibration: { medianFrameMs: 8, impliedHz: 125, regime: '60hz' },
    frames: {
      phase: 'driven',
      count: 600,
      degraded: false,
      p50: 8,
      p95: 10,
      p99: 12,
      max: 20,
      pctOver16_7: 0,
      pctOver33_3: 0,
    },
    latency: null,
    scalars: {},
    proofs: [],
    aborts: [],
    environment: {
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
    },
    engineFidelity: 'gating',
    startedAt: 1_700_000_000_000,
    durationMs: 10_000,
    ...overrides,
  }
}

function scenarioVerdict(
  result: RunResult,
  verdict: ScenarioVerdict['verdict'],
  reasons: string[] = [],
): ScenarioVerdict {
  return { scenario: result.scenario, verdict, reasons }
}

// ---- buildRunResult -------------------------------------------------------------------------

describe('buildRunResult', () => {
  it('derives elementCount, edgeCount, fixtureLayout and fixtureDigest from the fixture, never from separate input', () => {
    const fixture = tinyFixture()
    const result = buildRunResult(buildInput({ fixture }))
    expect(result.elementCount).toBe(fixture.elements.length)
    expect(result.edgeCount).toBe(fixture.edges.length)
    expect(result.fixtureLayout).toBe(fixture.layout)
    expect(result.fixtureDigest).toBe(fixture.digest)
  })

  it('rejects a negative duration', () => {
    expect(() => buildRunResult(buildInput({ durationMs: -1 }))).toThrow()
  })

  it('rejects a result with no frames, no latency, no scalars and no aborts: nothing was measured', () => {
    expect(() =>
      buildRunResult(buildInput({ frames: null, latency: null, scalars: {}, aborts: [] })),
    ).toThrow()
  })

  it('accepts a scalar-only result, the S1/S9 shape, with no frames or latency required', () => {
    const result = buildRunResult(
      buildInput({ frames: null, latency: null, scalars: { mountMs: 500, longestBlockMs: 40 } }),
    )
    expect(result.frames).toBeNull()
    expect(result.scalars.mountMs).toBe(500)
  })

  it('accepts an aborted result with nothing else measured: the abort itself is the record', () => {
    const result = buildRunResult(
      buildInput({ frames: null, latency: null, scalars: {}, aborts: ['proof of execution failed'] }),
    )
    expect(result.aborts).toEqual(['proof of execution failed'])
  })
})

describe('buildRunResult and proofs of execution', () => {
  const landedProof: ProofOfExecution = {
    gesture: 'pan 400px',
    stateMatched: true,
    committedMatched: true,
    expected: 'dx 400',
    actual: 'dx 400',
  }

  it('folds a gesture the arm never received into aborts, so it cannot report a clean histogram', () => {
    // The single most likely route to a confident wrong pass: a synthetic gesture that silently
    // failed leaves an idle frame histogram, which is indistinguishable from a fast one.
    const result = buildRunResult(
      buildInput({
        proofs: [
          { gesture: 'pan 400px', stateMatched: false, committedMatched: false, expected: 'dx 400', actual: 'dx 0' },
        ],
      }),
    )
    expect(result.aborts).toHaveLength(1)
    expect(result.aborts[0]).toContain('pan 400px')
    expect(result.aborts[0]).toContain('arm state did not change')
  })

  it('folds a state change that was never committed, which is a different failure from no change', () => {
    const result = buildRunResult(
      buildInput({
        proofs: [
          { gesture: 'zoom 0.1 to 1.0', stateMatched: true, committedMatched: false, expected: 'zoom 1', actual: 'zoom 1' },
        ],
      }),
    )
    expect(result.aborts[0]).toContain('committed transform did not agree')
    expect(result.aborts[0]).not.toContain('arm state did not change')
  })

  it('keeps the caller-supplied aborts alongside the folded ones', () => {
    const result = buildRunResult(
      buildInput({
        aborts: ['watchdog: window lost visibility mid-run'],
        proofs: [
          { gesture: 'drag', stateMatched: false, committedMatched: true, expected: 'dx 120', actual: 'dx 0' },
        ],
      }),
    )
    expect(result.aborts).toHaveLength(2)
    expect(result.aborts[0]).toContain('watchdog')
  })

  it('leaves a run with only landed proofs clean', () => {
    expect(buildRunResult(buildInput({ proofs: [landedProof] })).aborts).toEqual([])
  })

  it('records a failed proof as the whole record when nothing else was measured, rather than throwing', () => {
    // The proof failure is the reason the run produced nothing, so it must survive as the record
    // instead of being lost to the 'nothing was measured' guard.
    const result = buildRunResult(
      buildInput({
        frames: null,
        latency: null,
        scalars: {},
        aborts: [],
        proofs: [
          { gesture: 'pan', stateMatched: false, committedMatched: false, expected: 'dx 400', actual: 'dx 0' },
        ],
      }),
    )
    expect(result.aborts).toHaveLength(1)
  })
})

// ---- publishResult --------------------------------------------------------------------------

describe('publishResult', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    document.body.innerHTML = ''
    URL.createObjectURL = vi.fn(() => 'blob:mock-url') as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    delete window.__spikeResult
  })

  it('takes all four paths on a clean POST', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetchMock)

    const result = buildRunResult(buildInput())
    const outcome = await publishResult(result)

    expect(outcome).toEqual({
      postedResult: true,
      renderedToDom: true,
      storedOnWindow: true,
      downloadOffered: true,
      errors: [],
    })
    expect(fetchMock).toHaveBeenCalledWith('/__probe/result', expect.objectContaining({ method: 'POST' }))
    expect(document.getElementById('result')?.textContent).toContain('"arm"')
    expect(window.__spikeResult).toEqual(result)
    expect(document.getElementById('result-download')).toBeInstanceOf(HTMLAnchorElement)
  })

  it('does not throw when fetch rejects, and still renders, stores and offers the download', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))

    const result = buildRunResult(buildInput())
    const outcome = await publishResult(result)

    expect(outcome.postedResult).toBe(false)
    expect(outcome.renderedToDom).toBe(true)
    expect(outcome.storedOnWindow).toBe(true)
    expect(outcome.downloadOffered).toBe(true)
    expect(outcome.errors.some((e) => e.includes('network down'))).toBe(true)
  })

  it('records a non-2xx response as an error rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))))

    const result = buildRunResult(buildInput())
    const outcome = await publishResult(result)

    expect(outcome.postedResult).toBe(false)
    expect(outcome.errors.some((e) => e.includes('500'))).toBe(true)
  })

  it('records the download path failing, without throwing, when Blob URLs are unavailable', async () => {
    Reflect.deleteProperty(URL, 'createObjectURL')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))

    const result = buildRunResult(buildInput())
    const outcome = await publishResult(result)

    expect(outcome.downloadOffered).toBe(false)
    expect(outcome.errors.length).toBeGreaterThan(0)
    // The other three paths do not need Blob URLs and must still succeed.
    expect(outcome.postedResult).toBe(true)
    expect(outcome.renderedToDom).toBe(true)
    expect(outcome.storedOnWindow).toBe(true)
  })

  it('reuses the existing #result element from index.html rather than creating a second one', async () => {
    const pre = document.createElement('pre')
    pre.id = 'result'
    document.body.appendChild(pre)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))

    await publishResult(buildRunResult(buildInput()))

    expect(document.querySelectorAll('#result')).toHaveLength(1)
  })
})

// ---- publishFailure -------------------------------------------------------------------------

describe('publishFailure', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the message and reports success', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await publishFailure('S4a aborted: hang watchdog fired')

    expect(outcome).toEqual({ posted: true })
    expect(fetchMock).toHaveBeenCalledWith('/__probe/fail', expect.objectContaining({ method: 'POST' }))
  })

  it('does not throw when fetch rejects, and reports the failure instead', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const outcome = await publishFailure('anything')

    expect(outcome.posted).toBe(false)
    expect(outcome.error).toContain('offline')
  })
})

// ---- summarizeToMarkdown --------------------------------------------------------------------

describe('summarizeToMarkdown', () => {
  it('throws when results and verdicts have different lengths', () => {
    const result = buildRunResult(buildInput())
    expect(() => summarizeToMarkdown([result], [])).toThrow()
  })

  it('throws when a result and verdict are paired for different scenarios', () => {
    const s2 = buildRunResult(buildInput({ scenario: 'S2' }))
    const s3 = buildRunResult(buildInput({ scenario: 'S3' }))
    expect(() => summarizeToMarkdown([s2], [scenarioVerdict(s3, 'pass')])).toThrow()
  })

  it('prints the engineFidelity of every row', () => {
    const gatingResult = buildRunResult(buildInput({ engineFidelity: 'gating' }))
    const leadResult = buildRunResult(buildInput({ scenario: 'S3', engineFidelity: 'lead' }))
    const table = summarizeToMarkdown(
      [gatingResult, leadResult],
      [scenarioVerdict(gatingResult, 'pass'), scenarioVerdict(leadResult, 'not-gating')],
    )
    expect(table).toContain('| a1-reactflow | S2 | gating | pass |')
    expect(table).toContain('| a1-reactflow | S3 | lead | not-gating |')
  })

  it('never prints a mean anywhere', () => {
    const result = buildRunResult(buildInput())
    const table = summarizeToMarkdown([result], [scenarioVerdict(result, 'pass')])
    expect(table.toLowerCase()).not.toContain('mean')
  })

  it('prints the driven sample count behind the percentiles', () => {
    const result = buildRunResult(buildInput())
    const table = summarizeToMarkdown([result], [scenarioVerdict(result, 'pass')])
    expect(table).toContain('| 600 driven |')
  })

  it('marks a degraded frame summary in the row itself, not only in the reasons', () => {
    const result = buildRunResult(
      buildInput({
        frames: {
          phase: 'driven',
          count: 14,
          degraded: true,
          p50: 8,
          p95: 20,
          p99: 20,
          max: 20,
          pctOver16_7: 7.1,
          pctOver33_3: 0,
        },
      }),
    )
    const table = summarizeToMarkdown([result], [scenarioVerdict(result, 'warn')])
    expect(table).toContain('| 14 driven, degraded |')
  })

  it('prints the phase the summary was taken over, so a settle histogram is visible as one', () => {
    const result = buildRunResult(
      buildInput({
        frames: {
          phase: 'settle',
          count: 600,
          degraded: false,
          p50: 8,
          p95: 10,
          p99: 12,
          max: 20,
          pctOver16_7: 0,
          pctOver33_3: 0,
        },
      }),
    )
    const table = summarizeToMarkdown([result], [scenarioVerdict(result, 'warn')])
    expect(table).toContain('| 600 settle |')
  })

  it('prints the on-screen counts, so an arm that scored well by drawing less is visible', () => {
    const result = buildRunResult(buildInput({ onScreen: { elements: 0, edges: 0, domNodes: 3 } }))
    const table = summarizeToMarkdown([result], [scenarioVerdict(result, 'fail')])
    expect(table).toContain('| 0el/0e/3dom |')
  })

  it('keeps every row the same width as the header', () => {
    const withFrames = buildRunResult(buildInput())
    const scalarOnly = buildRunResult(
      buildInput({ scenario: 'S1', frames: null, latency: null, scalars: { mountMs: 900 } }),
    )
    const lines = summarizeToMarkdown(
      [withFrames, scalarOnly],
      [scenarioVerdict(withFrames, 'pass'), scenarioVerdict(scalarOnly, 'pass')],
    ).split('\n')
    const cellCounts = lines.map((line) => line.split('|').length)
    expect(new Set(cellCounts).size).toBe(1)
  })

  it('renders scalar-only rows (no frames, no latency) without crashing', () => {
    const result = buildRunResult(
      buildInput({ scenario: 'S1', frames: null, latency: null, scalars: { mountMs: 900 } }),
    )
    const table = summarizeToMarkdown([result], [scenarioVerdict(result, 'pass')])
    expect(table).toContain('mountMs=900.0')
  })
})
