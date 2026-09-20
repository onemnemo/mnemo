export interface ColorControl {
  slot: number | null
  color: string | undefined
  hasSubtree: boolean
  branching: boolean
  onPick: (token: string | null, subtree: boolean) => void
}
