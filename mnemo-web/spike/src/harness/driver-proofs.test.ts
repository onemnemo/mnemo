import { describe, expect, it } from 'vitest'

import type { ProofOfExecution } from './contract'
import { ProofLedger, abortIfProofsFailed, buildProof, failedProofs } from './driver-proofs'

function proof(overrides: Partial<ProofOfExecution> = {}): ProofOfExecution {
  return { gesture: 'test', stateMatched: true, committedMatched: true, expected: 'e', actual: 'a', ...overrides }
}

describe('ProofLedger', () => {
  it('accumulates proofs in the order the gestures produced them', () => {
    const ledger = new ProofLedger()
    ledger.record(buildProof('pan', true, true, 'e', 'a'))
    ledger.recordAll([buildProof('dragElement:n1', true, true, 'e', 'a'), buildProof('x', true, true, 'e', 'a')])

    expect(ledger.size).toBe(3)
    expect(ledger.seal(3).map((p) => p.gesture)).toEqual(['pan', 'dragElement:n1', 'x'])
  })

  it('refuses to seal a run that proved nothing, so an empty list can never reach a verdict', () => {
    const ledger = new ProofLedger()
    expect(() => ledger.seal(1)).toThrow(/recorded 0 proof/)
  })

  it('refuses a minimum below one, because "no gesture was proven" is not a pass', () => {
    const ledger = new ProofLedger()
    ledger.record(proof())
    expect(() => ledger.seal(0)).toThrow(/at least 1 proof/)
  })

  it('refuses to seal when a scenario collected fewer proofs than it declared it owed', () => {
    const ledger = new ProofLedger()
    ledger.record(proof())
    expect(() => ledger.seal(3)).toThrow(/declared it owed at least 3/)
  })

  it('seals a failing run: the failure travels with the result rather than blocking it', () => {
    const ledger = new ProofLedger()
    ledger.record(proof({ gesture: 'pan', stateMatched: false }))
    expect(ledger.seal(1)).toHaveLength(1)
    expect(ledger.failures().map((p) => p.gesture)).toEqual(['pan'])
  })

  it('hands out a copy, so a caller cannot mutate the record after the fact', () => {
    const ledger = new ProofLedger()
    ledger.record(proof())
    const sealed = ledger.seal(1) as ProofOfExecution[]
    sealed.push(proof({ gesture: 'invented' }))
    expect(ledger.size).toBe(1)
  })
})

describe('failedProofs', () => {
  it('counts a proof as failed if either dimension failed', () => {
    const proofs = [
      proof({ gesture: 'ok' }),
      proof({ gesture: 'state', stateMatched: false }),
      proof({ gesture: 'commit', committedMatched: false }),
    ]
    expect(failedProofs(proofs).map((p) => p.gesture)).toEqual(['state', 'commit'])
  })
})

describe('abortIfProofsFailed', () => {
  it('does nothing when every proof matched and the minimum was met', () => {
    expect(() => abortIfProofsFailed([proof(), proof({ gesture: 'other' })], 2)).not.toThrow()
  })

  it('throws naming every failed gesture when state or commit did not match', () => {
    const proofs = [
      proof({ gesture: 'pan', stateMatched: false }),
      proof({ gesture: 'zoomSweep' }),
      proof({ gesture: 'dragElement:n1', committedMatched: false }),
    ]
    try {
      abortIfProofsFailed(proofs, 3)
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('pan')
      expect(message).toContain('dragElement:n1')
      expect(message).not.toContain('zoomSweep') // it matched; only failures are named
    }
  })

  it('treats an empty proof list as a failure, not as nothing to disprove', () => {
    expect(() => abortIfProofsFailed([], 1)).toThrow(/only 0 proof/)
  })

  it('refuses a minimum below one, so the check cannot be disarmed by passing zero', () => {
    expect(() => abortIfProofsFailed([], 0)).toThrow(/at least 1 proof/)
  })
})
