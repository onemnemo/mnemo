/**
 * The label editor's chunk, fetched on the first label that opens and then answered from memory.
 *
 * Kept apart from the field so the field's file exports only the component, and so a test can
 * settle the load before it renders and drive the editor rather than the textarea that stands in
 * for it.
 */

export type LabelEditorModule = typeof import("../edit/label-editor")

let loaded: LabelEditorModule | null = null
let loading: Promise<LabelEditorModule> | null = null

export function loadLabelEditor(): Promise<LabelEditorModule> {
  loading ??= import("../edit/label-editor").then((module) => {
    loaded = module
    return module
  })
  return loading
}

/** The chunk, once it has arrived, so a field that opens after the first mounts the editor at once. */
export function loadedLabelEditor(): LabelEditorModule | null {
  return loaded
}
