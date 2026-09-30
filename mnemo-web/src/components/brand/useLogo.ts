import { DEFAULT_LOGO, resolveLogo, type LogoId } from "@/lib/brand/marks"
import { useSettingValue } from "@/settings/store"

export const LOGO_SETTING_KEY = "Appearance.Logo"

export function useLogo(): LogoId {
  return resolveLogo(useSettingValue(LOGO_SETTING_KEY, DEFAULT_LOGO))
}
