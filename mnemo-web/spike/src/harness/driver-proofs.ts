/**
 * Proof-of-execution bookkeeping.
 *
 * A synthetic gesture that silently fails to reach the arm produces a flawless idle frame
 * histogram, and an idle histogram is indistinguishable from a fast one unless something
 * asserts the gesture actually landed. That makes the proof trail the load-bearing part of
 * the harness, so it is collected mechanically rather than left to a call site to remember:
 * the driver writes every proof into a `ProofLedger` it is constructed with, and the array a
 * `RunResult` needs can only be obtained by sealing that ledger against a caller-stated
 * minimum. An empty proof list can therefore never reach a verdict as "nothing disproved".
 */

import type { ProofOfExecution } from './contract'

export function buildProof(
  gesture: string,
  stateMatched: boolean,
  committedMatched: boolean,
  expected: string,
  actual: string,
): ProofOfExecution {
  return { gesture, stateMatched, committedMatched, expected, actual }
}

/** A proof fails if either dimension failed: the arm's own state, or what actually committed. */
export function failedProofs(proofs: readonly ProofOfExecution[]): readonly ProofOfExecution[] {
  return proofs.filter((proof) => !proof.stateMatched || !proof.committedMatched)
}

function describeFailures(failed: readonly ProofOfExecution[]): string {
  return failed
    .map((proof) => `  - ${proof.gesture}: expected ${proof.expected}; actual ${proof.actual}`)
    .join('\n')
}

/**
 * Every proof produced by one run, in the order the gestures produced them.
 *
 * The ledger is handed to the driver rather than returned by it so that proofs survive a
 * gesture that throws: an abort path is exactly when the evidence of what did land is worth
 * the most, and a gesture that threw its result away would take that evidence with it.
 */
export class ProofLedger {
  private readonly entries: ProofOfExecution[] = []

  record(proof: ProofOfExecution): ProofOfExecution {
    this.entries.push(proof)
    return proof
  }

  recordAll(proofs: readonly ProofOfExecution[]): readonly ProofOfExecution[] {
    for (const proof of proofs) this.entries.push(proof)
    return proofs
  }

  get size(): number {
    return this.entries.length
  }

  failures(): readonly ProofOfExecution[] {
    return failedProofs(this.entries)
  }

  /**
   * The proofs a `RunResult` is built from. `minimumProofs` is required and must be met:
   * a scenario states up front how many proofs its gestures owe, so a scenario that skipped
   * a gesture, or that collected nothing at all, fails here rather than evaluating to a pass
   * on an unproven histogram.
   */
  seal(minimumProofs: number): readonly ProofOfExecution[] {
    if (minimumProofs < 1) {
      throw new Error(
        `ProofLedger.seal requires a minimum of at least 1 proof; got ${minimumProofs}. ` +
          'A run that proves nothing must not be reportable.',
      )
    }
    if (this.entries.length < minimumProofs) {
      throw new Error(
        `ProofLedger.seal: this run recorded ${this.entries.length} proof(s) but the scenario ` +
          `declared it owed at least ${minimumProofs}; a gesture did not run or did not report.`,
      )
    }
    return this.entries.slice()
  }
}

/**
 * Throws if fewer than `minimumProofs` were collected, or if any of them failed. A run built
 * on a gesture that never landed is worse than no run: it produces a clean-looking histogram
 * for a frame that was never actually driven. The minimum is a required argument because an
 * empty list used to pass this check, making "no gesture was ever proven" and "every gesture
 * was proven" the same input.
 */
export function abortIfProofsFailed(
  proofs: readonly ProofOfExecution[],
  minimumProofs: number,
): void {
  if (minimumProofs < 1) {
    throw new Error(
      `abortIfProofsFailed requires a minimum of at least 1 proof; got ${minimumProofs}.`,
    )
  }
  if (proofs.length < minimumProofs) {
    throw new Error(
      `only ${proofs.length} proof(s) of execution were collected but at least ${minimumProofs} ` +
        'were required; this run must be discarded, not reported',
    )
  }
  const failed = failedProofs(proofs)
  if (failed.length === 0) return
  throw new Error(
    `${failed.length} of ${proofs.length} proof(s) of execution failed; ` +
      `this run must be discarded, not reported:\n${describeFailures(failed)}`,
  )
}
