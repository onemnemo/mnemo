/**
 * Per-frame record of what the arm did, kept so a single catastrophic frame can be explained.
 *
 * The zoom sweep drops two or three frames out of about 590 and hits 133ms on the worst of them,
 * and it does that with every edge configuration including none at all. An average over the sweep
 * cannot find that: 587 good frames bury it. What is needed is the work done on the bad frame and
 * on the one immediately before it, since a synchronous stall is usually charged to the frame
 * after the work that caused it.
 *
 * The probe must not create the stall it is looking for. So:
 *
 *   - a ring buffer of fixed size, allocated once, never grown
 *   - plain number fields written into preallocated arrays, so a frame allocates nothing
 *   - no logging, no string building and no object creation in the hot path
 *   - everything derived only when the run asks for it, after the last frame
 *
 * A rAF gap is quantised to the frame period whatever the cause, so the gap alone cannot classify
 * a stall. It is here to LOCATE the bad frame; the other columns are what explain it.
 */

/** Two sweeps of ~600 frames fit comfortably, so nothing interesting is overwritten. */
const CAPACITY = 2048

export interface FrameProbeSample {
  readonly gapMs: number
  readonly zoom: number
  readonly cullerMs: number
  readonly cullerDid: boolean
  readonly scanned: number
  readonly shown: number
  readonly hidden: number
  readonly rendered: number
}

export interface FrameProbe {
  /** Called once per committed camera. Allocation-free. */
  record(sample: FrameProbeSample): void
  /**
   * Discards everything recorded so far.
   *
   * Called when the measured window opens. Without it the worst gap in the buffer is the pause
   * around clock calibration, which is idle time rather than a dropped frame, and it buries the
   * real hitch three thousand milliseconds down.
   */
  beginWindow(): void
  /**
   * The worst frame by gap, and the frame before it, flattened into scalars.
   *
   * Flattened because the result carries arm counters as a flat number map, and because these
   * are the only rows anyone reads: the decision rule is "was the culler doing unusual work on or
   * just before the bad frame", and that is two rows, not six hundred.
   */
  summary(): Readonly<Record<string, number>>
}

export function createFrameProbe(): FrameProbe {
  const gapMs = new Float64Array(CAPACITY)
  const zoom = new Float64Array(CAPACITY)
  const cullerMs = new Float64Array(CAPACITY)
  const cullerDid = new Uint8Array(CAPACITY)
  const scanned = new Int32Array(CAPACITY)
  const shown = new Int32Array(CAPACITY)
  const hidden = new Int32Array(CAPACITY)
  const rendered = new Int32Array(CAPACITY)

  let count = 0

  return {
    record(sample) {
      const i = count % CAPACITY
      gapMs[i] = sample.gapMs
      zoom[i] = sample.zoom
      cullerMs[i] = sample.cullerMs
      cullerDid[i] = sample.cullerDid ? 1 : 0
      scanned[i] = sample.scanned
      shown[i] = sample.shown
      hidden[i] = sample.hidden
      rendered[i] = sample.rendered
      count += 1
    },

    beginWindow() {
      count = 0
    },

    summary() {
      if (count === 0) return {} as Readonly<Record<string, number>>
      const n = Math.min(count, CAPACITY)

      let worst = 0
      // The first sample's gap is measured from an arbitrary origin rather than from a previous
      // frame, so it is not a frame time and must not be allowed to win.
      for (let i = 1; i < n; i++) {
        if (gapMs[i] > gapMs[worst]) worst = i
      }
      const before = worst > 0 ? worst - 1 : worst

      // Totals, so "the culler did no work on the bad frame" can be told apart from "the culler
      // did no work all run because the range never moved".
      let cullerFrames = 0
      let cullerTotalMs = 0
      for (let i = 0; i < n; i++) {
        if (cullerDid[i]) cullerFrames += 1
        cullerTotalMs += cullerMs[i]
      }

      return {
        probeFrames: n,
        worstGapMs: gapMs[worst],
        worstZoom: zoom[worst],
        worstCullerMs: cullerMs[worst],
        worstCullerDid: cullerDid[worst],
        worstScanned: scanned[worst],
        worstShown: shown[worst],
        worstHidden: hidden[worst],
        worstRendered: rendered[worst],
        beforeGapMs: gapMs[before],
        beforeCullerMs: cullerMs[before],
        beforeCullerDid: cullerDid[before],
        beforeScanned: scanned[before],
        beforeShown: shown[before],
        beforeHidden: hidden[before],
        beforeRendered: rendered[before],
        cullerActiveFrames: cullerFrames,
        cullerTotalMs,
      }
    },
  }
}
