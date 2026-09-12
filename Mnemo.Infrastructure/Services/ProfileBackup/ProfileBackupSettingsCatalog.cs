namespace Mnemo.Infrastructure.Services.ProfileBackup;

internal enum ProfileSettingClassification
{
    Portable,
    Secret,
    Derived,
    MachineSpecific,
}

/// <summary>
/// Classifies every setting and storage document the current profile can persist. Unknown keys are
/// excluded so a future credential cannot silently enter an older backup implementation.
/// </summary>
internal static class ProfileBackupSettingsCatalog
{
    private static readonly IReadOnlyDictionary<string, ProfileSettingClassification> Exact =
        new Dictionary<string, ProfileSettingClassification>(StringComparer.Ordinal)
        {
            ["User.DisplayName"] = ProfileSettingClassification.Portable,
            ["User.ProfilePicture"] = ProfileSettingClassification.Portable,
            ["User.ProfileColour"] = ProfileSettingClassification.Portable,
            ["App.Language"] = ProfileSettingClassification.Portable,
            ["Appearance.Theme"] = ProfileSettingClassification.Portable,
            ["App.OpenTo"] = ProfileSettingClassification.Portable,
            ["App.ConfirmExit"] = ProfileSettingClassification.Portable,
            ["App.EnableToasts"] = ProfileSettingClassification.Portable,
            ["App.EnableGamification"] = ProfileSettingClassification.Portable,
            ["App.Icon"] = ProfileSettingClassification.Portable,
            ["App.ReduceMotion"] = ProfileSettingClassification.Portable,
            ["App.DeveloperMode"] = ProfileSettingClassification.Portable,
            ["Editor.AutoSave"] = ProfileSettingClassification.Portable,
            ["Editor.Width"] = ProfileSettingClassification.Portable,
            ["Proofing.Enabled"] = ProfileSettingClassification.Portable,
            ["Proofing.Language"] = ProfileSettingClassification.Portable,
            ["Proofing.Languages"] = ProfileSettingClassification.Portable,
            ["Proofing.NoteLanguages"] = ProfileSettingClassification.Portable,
            ["Proofing.NoteIgnores"] = ProfileSettingClassification.Portable,
            ["Proofing.PersonalWords"] = ProfileSettingClassification.Portable,
            ["Editor.SpellCheckLanguages"] = ProfileSettingClassification.Portable,
            ["Editor.SpellCheckCustomWordsByLanguage"] = ProfileSettingClassification.Portable,
            ["Markdown.BlockSpacing"] = ProfileSettingClassification.Portable,
            ["Markdown.LineHeight"] = ProfileSettingClassification.Portable,
            ["Markdown.LetterSpacing"] = ProfileSettingClassification.Portable,
            ["Markdown.FontSize"] = ProfileSettingClassification.Portable,
            ["Markdown.CodeFontSize"] = ProfileSettingClassification.Portable,
            ["Markdown.MathFontSize"] = ProfileSettingClassification.Portable,
            ["Markdown.RenderMath"] = ProfileSettingClassification.Portable,
            ["AI.EnableAssistant"] = ProfileSettingClassification.Portable,
            ["AI.Provider.Mode"] = ProfileSettingClassification.Portable,
            ["AI.OpenRouter.AssistantModel"] = ProfileSettingClassification.Portable,
            ["AI.OpenRouter.UtilityModel"] = ProfileSettingClassification.Portable,
            ["AI.AgentMode"] = ProfileSettingClassification.Portable,
            ["AI.WebSearch.Enabled"] = ProfileSettingClassification.Portable,
            ["AI.WebSearch.Provider"] = ProfileSettingClassification.Portable,
            ["AI.WebSearch.SearxngUrl"] = ProfileSettingClassification.Portable,
            ["Chat.StreamingReveal"] = ProfileSettingClassification.Portable,
            ["Mindmap.MinimapVisibility"] = ProfileSettingClassification.Portable,
            ["Mindmap.GridType"] = ProfileSettingClassification.Portable,
            ["Mindmap.GridSize"] = ProfileSettingClassification.Portable,
            ["Mindmap.GridDotSize"] = ProfileSettingClassification.Portable,
            ["Mindmap.GridOpacity"] = ProfileSettingClassification.Portable,
            ["Collection.Id"] = ProfileSettingClassification.Portable,
            ["overview_layout_v2"] = ProfileSettingClassification.Portable,
            ["overview_dashboard_layout"] = ProfileSettingClassification.Portable,
            ["chat_module_history"] = ProfileSettingClassification.Portable,
            ["flashcards.state.v2"] = ProfileSettingClassification.Portable,
            ["Updates.AutoCheck"] = ProfileSettingClassification.Portable,
            ["Updates.Channel"] = ProfileSettingClassification.Portable,

            ["AI.OpenRouter.ApiKey"] = ProfileSettingClassification.Secret,
            ["AI.WebSearch.BraveApiKey"] = ProfileSettingClassification.Secret,

            ["notes_sid_migration"] = ProfileSettingClassification.Derived,
            ["flashcards.state.v2.migrated-backup"] = ProfileSettingClassification.Derived,
            ["flashcards.factless-card-repair"] = ProfileSettingClassification.Derived,
            ["App.DeveloperModeGateUnlocked"] = ProfileSettingClassification.Derived,
            ["App.BetaNoticeSeenVersion"] = ProfileSettingClassification.Derived,
            ["Onboarding.Completed"] = ProfileSettingClassification.Derived,
            ["Updates.RemindAtUtc"] = ProfileSettingClassification.Derived,
            ["Updates.SnoozeLaunchesRemaining"] = ProfileSettingClassification.Derived,
            ["Updates.SkippedVersion"] = ProfileSettingClassification.Derived,
            ["Updates.LastCheckedUtc"] = ProfileSettingClassification.Derived,
            ["Updates.PromptCountByVersion"] = ProfileSettingClassification.Derived,
            ["Updates.PendingOfferJson"] = ProfileSettingClassification.Derived,
            ["Updates.PendingPostUpdateToastVersion"] = ProfileSettingClassification.Derived,

            ["App.LaunchAtStartup"] = ProfileSettingClassification.MachineSpecific,
            ["App.PerformanceDiagnostics"] = ProfileSettingClassification.MachineSpecific,
            ["App.ExportFolders"] = ProfileSettingClassification.MachineSpecific,
            ["App.LegacyInstallWarningShown"] = ProfileSettingClassification.MachineSpecific,
        };

    public static ProfileSettingClassification Classify(string key)
    {
        if (Exact.TryGetValue(key, out var classification))
            return classification;

        if (key is "notes_index" or "note_folders_index" or "notes_trash" or "note_folders_trash")
            return ProfileSettingClassification.Portable;

        if (key.StartsWith("note_", StringComparison.Ordinal) ||
            key.StartsWith("note_folder_", StringComparison.Ordinal))
        {
            return ProfileSettingClassification.Portable;
        }

        return ProfileSettingClassification.MachineSpecific;
    }

    public static IReadOnlyDictionary<string, ProfileSettingClassification> All => Exact;
}
