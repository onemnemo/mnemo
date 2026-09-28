export interface ColorControl {
  slot: number | null
  color: string | undefined
  /** Whether the node has no colour of its own and takes the one Auto gives. */
  inherited: boolean
  /** The colour Auto hands back, or undefined when nothing would colour it. */
  inheritedColor: string | undefined
  hasSubtree: boolean
  /** How many nodes sit under the selected one. */
  below: number
  branching: boolean
  onPick: (token: string | null, subtree: boolean) => void
}
