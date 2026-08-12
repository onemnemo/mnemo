import { useT } from "@/i18n/useT"

import { APP_ICONS, DEFAULT_APP_ICON, appIconName } from "../assets"
import { rowDescription, rowTitle } from "../labels"
import type { CustomRow as CustomRowSchema } from "../types"
import { AboutIdentityRow } from "./custom/AboutIdentityRow"
import { AvatarPicker } from "./custom/AvatarPicker"
import { CheckForUpdatesRow } from "./custom/CheckForUpdatesRow"
import { ClearChatHistoryRow } from "./custom/ClearChatHistoryRow"
import { ImageGalleryRow } from "./custom/ImageGalleryRow"
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
      return <AvatarPicker {...shared} />

    case "assistant-model":
      return <ModelPickerRow {...shared} settingKey="AI.OpenRouter.AssistantModel" />

    case "utility-model":
      return <ModelPickerRow {...shared} settingKey="AI.OpenRouter.UtilityModel" />

    case "test-connection":
      return <TestConnectionRow {...shared} />

    case "clear-chat-history":
      return <ClearChatHistoryRow {...shared} />

    case "check-for-updates":
      return <CheckForUpdatesRow title={title} divider={divider} />

    case "about-identity":
      return <AboutIdentityRow />
  }

  // A new CustomRowId with no case above would otherwise return undefined, which React
  // rejects at render with an error naming this component rather than the row. The
  // annotation is what makes that a build failure instead: an unhandled id is not `never`.
  const unhandled: never = row.id
  throw new Error(`[settings] no renderer for custom row "${String(unhandled)}"`)
}
