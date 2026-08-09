import { useT } from "@/i18n/useT"

import {
  APP_ICONS,
  DEFAULT_APP_ICON,
  DEFAULT_PROFILE_PICTURE,
  PROFILE_PICTURES,
  appIconName,
} from "../assets"
import { rowDescription, rowTitle } from "../labels"
import type { CustomRow as CustomRowSchema } from "../types"
import { CheckForUpdatesRow } from "./custom/CheckForUpdatesRow"
import { ClearChatHistoryRow } from "./custom/ClearChatHistoryRow"
import { ImageGalleryRow } from "./custom/ImageGalleryRow"
import { KeybindManagerRow } from "./custom/KeybindManagerRow"
import { LanguageRow } from "./custom/LanguageRow"
import { ModelPickerRow } from "./custom/ModelPickerRow"
import { ReduceMotionRow } from "./custom/ReduceMotionRow"
import { TestConnectionRow } from "./custom/TestConnectionRow"
import { ThemeGalleryRow } from "./custom/ThemeGalleryRow"

/**
 * Rows that need bespoke rendering. The schema keeps their position, labels and
 * searchability; only the control is special.
 */
export function CustomRow({ row, divider }: { row: CustomRowSchema; divider: boolean }) {
  const t = useT()
  const title = rowTitle(row, t)
  const description = rowDescription(row, t) || undefined
  const shared = { title, description, divider }

  switch (row.id) {
    case "language":
      return <LanguageRow {...shared} />

    case "theme-gallery":
      return <ThemeGalleryRow {...shared} />

    case "reduce-motion":
      return <ReduceMotionRow {...shared} />

    case "app-icon-gallery":
      return (
        <ImageGalleryRow
          {...shared}
          settingKey="App.Icon"
          options={APP_ICONS}
          defaultValue={DEFAULT_APP_ICON}
          shape="rounded"
          size={52}
          labelFor={appIconName}
        />
      )

    case "profile-picture-gallery":
      return (
        <ImageGalleryRow
          {...shared}
          settingKey="User.ProfilePicture"
          options={PROFILE_PICTURES}
          defaultValue={DEFAULT_PROFILE_PICTURE}
          labelFor={(stored) => stored.split("/").pop() ?? stored}
        />
      )

    case "assistant-model":
      return <ModelPickerRow {...shared} settingKey="AI.OpenRouter.AssistantModel" />

    case "utility-model":
      return <ModelPickerRow {...shared} settingKey="AI.OpenRouter.UtilityModel" />

    case "test-connection":
      return <TestConnectionRow {...shared} />

    case "clear-chat-history":
      return <ClearChatHistoryRow {...shared} />

    case "keybind-manager":
      return <KeybindManagerRow {...shared} />

    case "check-for-updates":
      return <CheckForUpdatesRow title={title} divider={divider} />
  }
}
