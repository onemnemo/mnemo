/**
 * "Are you sure you want to close Mnemo?"
 *
 * The desktop app asked this from the topbar's close command, which meant it
 * only ever guarded its own button: Alt+F4, the taskbar's close item and the
 * window gesture all quit without a word. Registering the question as a shutdown
 * guard instead puts it on the one path every close already goes through, so
 * there is no way out of the app that skips it.
 *
 * Autosave and the shutdown flush mean nothing is lost either way, so this is
 * about the click nobody meant to make rather than about unsaved work. That is
 * why it can be switched off.
 */

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { getSettingValue } from "@/settings/store"
import { dialog } from "@/stores/dialog"

import { onShutdownGuard } from "./shutdown"

/** Matches the row's `defaultValue` in the settings schema. */
const CONFIRM_EXIT_DEFAULT = true

/**
 * Installs the exit prompt. Returns the disposer, which nothing in the app calls:
 * the question outlives every screen that could unregister it.
 */
export function installExitConfirm(): () => void {
  return onShutdownGuard(async () => {
    if (!getSettingValue<boolean>("App.ConfirmExit", CONFIRM_EXIT_DEFAULT)) return true

    // Read at call time rather than closed over, so the prompt follows a language
    // change made after startup.
    const t = createTranslate(useI18nStore.getState().bundle)
    return dialog.confirm({
      title: t("Topbar", "ConfirmExitTitle"),
      message: t("Topbar", "ConfirmExitMessage"),
      confirmLabel: t("Topbar", "ConfirmExitButton"),
      cancelLabel: t("Common", "Cancel"),
    })
  })
}
