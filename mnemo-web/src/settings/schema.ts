import type { SettingsCategory } from "./types"

// The settings tree. Mirrors SettingsViewModel.RebuildCategories: same categories in
// the same order, same storage keys, same defaults, same option lists.
//
// Keys named here must also be registered in Mnemo.Host/Settings/SettingsKeyRegistry —
// that allowlist is what makes them readable and writable over the API.

/** Every category, in nav order. Filter with `visibleCategories` before rendering. */
export const SETTINGS_SCHEMA: SettingsCategory[] = [
  {
    id: "Account",
    title: "Account",
    subtitle: "AccountSubtitle",
    section: "account",
    groups: [
      {
        id: "Profile",
        title: "Profile",
        rows: [
          {
            kind: "custom",
            id: "profile-picture-gallery",
            title: "ProfilePicture",
            description: "ProfilePictureDescription",
          },
          {
            kind: "text",
            key: "User.DisplayName",
            title: "DisplayName",
            description: "DisplayNameDescription",
            defaultValue: "John Doe",
          },
        ],
      },
    ],
  },

  {
    id: "General",
    title: "General",
    subtitle: "GeneralSubtitle",
    section: "app",
    groups: [
      {
        id: "Application",
        title: "Application",
        rows: [
          {
            kind: "toggle",
            key: "App.LaunchAtStartup",
            title: "LaunchAtStartup",
            description: "LaunchAtStartupDescription",
            defaultValue: false,
          },
          {
            kind: "toggle",
            key: "App.EnableToasts",
            title: "EnableToasts",
            description: "EnableToastsDescription",
            defaultValue: true,
          },
          { kind: "custom", id: "language", title: "Language", description: "LanguageDescription" },
          {
            kind: "custom",
            id: "keybind-manager",
            title: "KeybindManager",
            description: "KeybindManagerDescription",
          },
        ],
      },
      {
        id: "Storage",
        title: "Storage",
        rows: [
          // The desktop renders this button with no command behind it. Kept in place so
          // the category matches, but rendered disabled rather than silently inert.
          {
            kind: "action",
            id: "clear-cache",
            title: "ClearCache",
            description: "ClearCacheDescription",
            buttonLabel: "ClearNow",
          },
        ],
      },
      {
        id: "Experience",
        title: "Experience",
        rows: [
          {
            kind: "toggle",
            key: "App.EnableGamification",
            title: "EnableGamification",
            description: "EnableGamificationDescription",
            defaultValue: true,
          },
          // Untranslated in the desktop too; the literals are carried over verbatim.
          {
            kind: "toggle",
            key: "App.DeveloperMode",
            titleText: "Developer mode",
            descriptionText:
              "Shows a Developer section in Settings. Tap the Settings title seven times within two seconds to reveal this switch.",
            defaultValue: false,
          },
        ],
      },
    ],
  },

  {
    id: "Editor",
    title: "Editor",
    subtitle: "EditorSubtitle",
    section: "modules",
    groups: [
      {
        id: "WritingExperience",
        title: "WritingExperience",
        rows: [
          {
            kind: "toggle",
            key: "Editor.AutoSave",
            title: "AutoSave",
            description: "AutoSaveDescription",
            defaultValue: true,
          },
          {
            kind: "toggle",
            key: "Editor.SpellCheck",
            title: "SpellCheck",
            description: "SpellCheckDescription",
            defaultValue: true,
          },
          {
            kind: "dropdown",
            key: "Editor.SpellCheckLanguages",
            title: "SpellCheckLanguages",
            description: "SpellCheckLanguagesDescription",
            defaultValue: "en",
            options: [
              { value: "en", label: "SpellCheckLanguageEnglish" },
              { value: "de", label: "SpellCheckLanguageGerman" },
              { value: "es", label: "SpellCheckLanguageSpanish" },
              { value: "nb", label: "SpellCheckLanguageNorwegianBokmal" },
            ],
          },
          {
            kind: "slider",
            key: "Editor.Width",
            title: "EditorWidth",
            description: "EditorWidthDescription",
            localizedValues: true,
            defaultValue: "Wide",
            options: [
              { label: "SuperCompact" },
              { label: "Compact" },
              { label: "Wide" },
              { label: "SuperWide" },
            ],
          },
        ],
      },
      {
        id: "MarkdownRendering",
        title: "MarkdownRendering",
        rows: [
          {
            kind: "dropdown",
            key: "Markdown.BlockSpacing",
            title: "BlockSpacing",
            description: "BlockSpacingDescription",
            localizedValues: true,
            defaultValue: "Normal",
            options: [{ label: "Normal" }, { label: "Compact" }, { label: "Relaxed" }],
          },
          {
            kind: "dropdown",
            key: "Markdown.LineHeight",
            title: "LineSpacing",
            description: "LineSpacingDescription",
            defaultValue: "1.5",
            options: ["1.0", "1.2", "1.4", "1.45", "1.5", "1.6", "1.8", "2.0"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.LetterSpacing",
            title: "LetterSpacing",
            description: "LetterSpacingDescription",
            defaultValue: "0.3",
            options: ["0", "0.2", "0.3", "0.4", "0.5", "0.8", "1.0", "1.5"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.FontSize",
            title: "BaseFontSize",
            description: "BaseFontSizeDescription",
            defaultValue: "16px",
            options: ["12px", "13px", "14px", "15px", "16px", "17px", "18px"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.CodeFontSize",
            title: "CodeFontSize",
            description: "CodeFontSizeDescription",
            defaultValue: "16px",
            options: ["12px", "13px", "14px", "15px", "16px"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Markdown.MathFontSize",
            title: "MathFontSize",
            description: "MathFontSizeDescription",
            defaultValue: "16px",
            options: ["14px", "16px", "18px", "20px"].map((v) => ({ value: v })),
          },
          {
            kind: "toggle",
            key: "Markdown.RenderMath",
            title: "RenderLatexMath",
            description: "RenderLatexMathDescription",
            defaultValue: true,
          },
        ],
      },
    ],
  },

  {
    id: "AITools",
    title: "AITools",
    subtitle: "AIToolsSubtitle",
    section: "modules",
    groups: [
      {
        // One unnamed group: everything AI lives behind the master switch.
        id: "AI",
        offNotice: "AIOffNotice",
        confirmEnable: {
          title: "EnableAIAssistantWarningTitle",
          message: "EnableAIAssistantWarningMessage",
          confirm: "EnableAIAssistantWarningConfirm",
        },
        master: {
          kind: "toggle",
          key: "AI.EnableAssistant",
          title: "EnableAIAssistant",
          description: "EnableAIAssistantDescription",
          defaultValue: false,
        },
        rows: [
          { kind: "subheader", id: "sub-model-provider", title: "ModelProvider" },
          {
            kind: "dropdown",
            key: "AI.Provider.Mode",
            title: "ProviderMode",
            description: "ProviderModeDescription",
            defaultValue: "Cloud",
            // Visible but not selectable, mirroring the desktop: local models are not shipped yet.
            disabled: true,
            options: [
              { value: "Cloud", label: "ProviderModeCloud" },
              { value: "Local", label: "ProviderModeLocal" },
              { value: "Auto", label: "ProviderModeAuto" },
            ],
          },
          {
            kind: "text",
            key: "AI.OpenRouter.ApiKey",
            title: "OpenRouterApiKey",
            description: "OpenRouterApiKeyDescription",
            defaultValue: "",
            secret: true,
          },
          {
            kind: "custom",
            id: "test-connection",
            title: "TestConnection",
            description: "TestConnectionDescription",
          },
          {
            kind: "custom",
            id: "assistant-model",
            title: "AssistantModel",
            description: "AssistantModelDescription",
          },
          {
            kind: "custom",
            id: "utility-model",
            title: "UtilityModel",
            description: "UtilityModelDescription",
          },

          { kind: "subheader", id: "sub-intelligence", title: "Intelligence" },
          {
            kind: "toggle",
            key: "AI.AgentMode",
            title: "AgentMode",
            description: "AgentModeDescription",
            defaultValue: true,
          },
          {
            kind: "dropdown",
            key: "Chat.StreamingReveal",
            title: "ChatStreamingReveal",
            description: "ChatStreamingRevealDescription",
            defaultValue: "balanced",
            options: [
              { value: "instant", label: "StreamingInstant" },
              { value: "balanced", label: "StreamingBalanced" },
              { value: "smooth", label: "StreamingSmooth" },
            ],
          },
          {
            kind: "custom",
            id: "clear-chat-history",
            title: "ClearChatHistory",
            description: "ClearChatHistoryDescription",
          },

          { kind: "subheader", id: "sub-web-search", title: "WebSearch" },
          {
            kind: "toggle",
            key: "AI.WebSearch.Enabled",
            title: "WebSearchEnabled",
            description: "WebSearchEnabledDescription",
            defaultValue: true,
          },
          {
            kind: "dropdown",
            key: "AI.WebSearch.Provider",
            title: "WebSearchProvider",
            description: "WebSearchProviderDescription",
            defaultValue: "DuckDuckGo",
            options: ["None", "DuckDuckGo", "SearXNG", "Brave"].map((v) => ({ value: v })),
          },
          {
            kind: "text",
            key: "AI.WebSearch.SearxngUrl",
            title: "SearxngUrl",
            description: "SearxngUrlDescription",
            defaultValue: "http://localhost:8888",
          },
          {
            kind: "text",
            key: "AI.WebSearch.BraveApiKey",
            title: "BraveApiKey",
            description: "BraveApiKeyDescription",
            defaultValue: "",
            // Plaintext in the desktop's field, but every stored credential is
            // write-only across the process boundary the port introduces.
            secret: true,
          },
        ],
      },
    ],
  },

  {
    id: "Mindmap",
    title: "Mindmap",
    subtitle: "MindmapSubtitle",
    section: "modules",
    groups: [
      {
        id: "GridBackground",
        title: "GridBackground",
        rows: [
          {
            kind: "dropdown",
            key: "Mindmap.GridType",
            title: "GridType",
            description: "GridTypeDescription",
            defaultValue: "Dotted",
            options: ["None", "Dotted", "Lines"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Mindmap.GridSize",
            title: "GridSize",
            description: "GridSizeDescription",
            defaultValue: "40",
            options: ["20", "40", "60", "80", "100"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Mindmap.GridDotSize",
            title: "GridDotSize",
            description: "GridDotSizeDescription",
            defaultValue: "1.5",
            options: ["0.5", "1.0", "1.5", "2.0", "2.5", "3.0"].map((v) => ({ value: v })),
          },
          {
            kind: "dropdown",
            key: "Mindmap.GridOpacity",
            title: "GridOpacity",
            description: "GridOpacityDescription",
            defaultValue: "0.2",
            options: ["0.05", "0.1", "0.15", "0.2", "0.3", "0.5", "0.7", "1.0"].map((v) => ({ value: v })),
          },
        ],
      },
      {
        id: "Interaction",
        title: "Interaction",
        rows: [
          {
            kind: "dropdown",
            key: "Mindmap.MinimapVisibility",
            title: "ShowMinimap",
            description: "ShowMinimapDescription",
            defaultValue: "Auto",
            options: ["Auto", "On", "Off"].map((v) => ({ value: v })),
          },
        ],
      },
    ],
  },

  {
    id: "Appearance",
    title: "Appearance",
    subtitle: "AppearanceSubtitle",
    section: "app",
    groups: [
      {
        id: "ThemeVisuals",
        title: "ThemeVisuals",
        rows: [
          { kind: "custom", id: "theme-gallery", title: "AppTheme", description: "AppThemeDescription" },
          { kind: "custom", id: "app-icon-gallery", title: "AppIcon", description: "AppIconDescription" },
        ],
      },
    ],
  },

  {
    id: "Updates",
    title: "UpdatesCategoryTitle",
    subtitle: "UpdatesSubtitle",
    section: "app",
    groups: [
      {
        id: "Updates",
        title: "UpdatesGroupTitle",
        rows: [
          {
            kind: "toggle",
            key: "Updates.AutoCheck",
            title: "AutoCheckUpdates",
            description: "AutoCheckUpdatesDescription",
            defaultValue: true,
          },
          { kind: "custom", id: "check-for-updates", title: "CheckForUpdatesNow" },
        ],
      },
    ],
  },

  {
    id: "Developer",
    // Untranslated in the desktop; carried over as-is.
    title: "Developer",
    section: "app",
    visible: (context) => context.developerMode,
    groups: [
      {
        id: "DeveloperTools",
        title: "Developer tools",
        rows: [
          {
            kind: "notice",
            id: "developer-notice",
            titleText: "Reserved for developers",
            descriptionText: "These settings are diagnostic tools, not product features.",
          },
          {
            kind: "toggle",
            key: "App.PerformanceDiagnostics",
            titleText: "Performance diagnostics",
            descriptionText: "Record timings for navigation, rendering and storage operations.",
            defaultValue: false,
          },
        ],
      },
    ],
  },
]

/** The categories to list, given the current developer-gate state. */
export function visibleCategories(context: {
  developerGateUnlocked: boolean
  developerMode: boolean
}): SettingsCategory[] {
  return SETTINGS_SCHEMA.filter((c) => c.visible?.(context) ?? true)
}

/**
 * True when a row should be hidden outright. Only the Developer-mode switch behaves
 * this way: it stays invisible until the 7-tap gate is unlocked.
 */
export function isRowHidden(rowKey: string | undefined, context: { developerGateUnlocked: boolean }): boolean {
  return rowKey === "App.DeveloperMode" && !context.developerGateUnlocked
}

/** The Developer category's title is untranslated, so the nav renders it literally. */
export const UNTRANSLATED_CATEGORY_TITLES: Record<string, string> = {
  Developer: "Developer",
}
