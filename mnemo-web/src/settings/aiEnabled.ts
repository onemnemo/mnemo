import { getSettingValue, useSettingValue } from "./store"

/**
 * Whether the assistant exists for this install.
 *
 * Two switches rather than one. The AI is still being built, so the whole of it sits
 * behind developer mode: the AI & Tools page that carries the assistant's own switch is
 * only listed once developer mode is on, which means nobody reaches that switch by
 * wandering through settings. Turning developer mode back off takes every AI surface
 * with it, whatever the assistant switch was left on.
 *
 * Every surface asks here instead of reading `AI.EnableAssistant` directly, so one of
 * them cannot quietly keep showing an assistant the rest of the app has hidden.
 */
export function useAiEnabled(): boolean {
  const developerMode = useSettingValue("App.DeveloperMode", false)
  const assistant = useSettingValue("AI.EnableAssistant", false)
  return developerMode && assistant
}

/** Non-reactive read, for callers outside React. */
export function getAiEnabled(): boolean {
  return getSettingValue("App.DeveloperMode", false) && getSettingValue("AI.EnableAssistant", false)
}
