// The tier a menu takes when it is opened from inside a modal. Kept out of the component
// files so both stay fast-refreshable, and spelled out because Tailwind reads class names
// from the source. lib/z-layers.test.ts fails if this and Z_LAYERS.modalMenu drift apart.
export const MODAL_MENU_CLASS = "z-[150]"
