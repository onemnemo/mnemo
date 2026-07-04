using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Updates;
using Mnemo.UI.Modules.Updates.Services;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class SettingsViewModel : ViewModelBase
{
    public const string DeveloperModeKey = "App.DeveloperMode";
    public const string DeveloperModeGateUnlockedKey = "App.DeveloperModeGateUnlocked";
    private const string SearchResultsCategoryId = "SearchResults";

    private readonly ISettingsService _settingsService;
    private readonly IThemeService _themeService;
    private readonly ILocalizationService _localizationService;
    private readonly IChatHistoryClearService _chatHistoryClearService;
    private readonly IOverlayService _overlayService;
    private readonly IMainThreadDispatcher _mainThreadDispatcher;
    private readonly IUpdateService _updateService;
    private readonly UpdateOrchestrator _updateOrchestrator;
    private readonly IKeyMap _keyMap;
    private readonly IPerfDiagnostics _perf;

    private bool _developerGateUnlocked;
    private bool _developerMode;
    private int _secretTitleTapCount;
    private DateTime _lastSecretTitleTapUtc;
    private bool _settingsHandlersAttached;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CategorySubtitleText))]
    private SettingsCategoryViewModel? _selectedCategory;

    [ObservableProperty]
    private string _searchText = string.Empty;

    /// <summary>Category the user was on before typing a search, restored when the query is cleared.</summary>
    private SettingsCategoryViewModel? _categoryBeforeSearch;

    /// <summary>Set while clearing the query programmatically so the filter does not re-run.</summary>
    private bool _suppressSearchFilter;

    [ObservableProperty]
    private string _userName = "John Doe";

    [ObservableProperty]
    private string _profilePicturePath = "avares://Mnemo.UI/Assets/ProfilePictures/img2.png";

    public ObservableCollection<SettingsCategoryViewModel> Categories { get; } = new();

    /// <summary>Subtitle under the category title; default blurb when the category has no custom subtitle.</summary>
    public string CategorySubtitleText =>
        !string.IsNullOrEmpty(SelectedCategory?.Subtitle)
            ? SelectedCategory!.Subtitle!
            : T("CategoryDescription");

    [RelayCommand]
    private void SelectCategory(SettingsCategoryViewModel category)
    {
        _categoryBeforeSearch = null;
        if (SearchText.Length > 0)
            SearchText = string.Empty;

        if (SelectedCategory != null) SelectedCategory.IsSelected = false;
        SelectedCategory = category;
        SelectedCategory.IsSelected = true;
    }

    partial void OnSearchTextChanged(string value)
    {
        if (!_suppressSearchFilter)
            ApplySearchFilter(value.Trim());
    }

    /// <summary>
    /// Cross-category search: while a query is active, the content area shows a transient
    /// "Search results" category whose groups are labelled "Category › Group". Clearing the
    /// query restores the category the user was on.
    /// </summary>
    private void ApplySearchFilter(string query)
    {
        if (query.Length == 0)
        {
            if (_categoryBeforeSearch != null && Categories.Contains(_categoryBeforeSearch))
                SelectCategory(_categoryBeforeSearch);
            _categoryBeforeSearch = null;
            return;
        }

        if (SelectedCategory?.CategoryId != SearchResultsCategoryId)
            _categoryBeforeSearch = SelectedCategory;

        var compare = System.Globalization.CultureInfo.CurrentCulture.CompareInfo;
        bool Matches(ISettingsSearchable item) =>
            compare.IndexOf(item.Title ?? string.Empty, query, System.Globalization.CompareOptions.IgnoreCase) >= 0 ||
            compare.IndexOf(item.Description ?? string.Empty, query, System.Globalization.CompareOptions.IgnoreCase) >= 0;

        var resultGroups = Categories
            .SelectMany(category => category.Groups.Select(group => (category, group)))
            .Select(pair => (pair.category, pair.group,
                matches: pair.group.Items.OfType<ISettingsSearchable>().Where(Matches).Cast<ViewModelBase>().ToList()))
            .Where(t => t.matches.Count > 0)
            .ToList();

        var totalMatches = resultGroups.Sum(t => t.matches.Count);
        var results = new SettingsCategoryViewModel(T("SearchResults"), "avares://Mnemo.UI/Icons/Common/search.svg", SearchResultsCategoryId)
        {
            Subtitle = totalMatches > 0
                ? string.Format(T("SearchResultsSubtitleFormat"), totalMatches, query)
                : string.Format(T("SearchNoResultsFormat"), query)
        };

        foreach (var (category, group, matches) in resultGroups)
        {
            var resultGroup = new SettingsGroupViewModel($"{category.Name} › {group.Name}");
            foreach (var match in matches)
                resultGroup.Items.Add(match);
            results.Groups.Add(resultGroup);
        }

        foreach (var c in Categories)
            c.IsSelected = false;
        SelectedCategory = results;
    }

    [RelayCommand]
    private void SecretSettingsTitleTap()
    {
        var now = DateTime.UtcNow;
        if ((now - _lastSecretTitleTapUtc).TotalSeconds > 2)
            _secretTitleTapCount = 0;
        _lastSecretTitleTapUtc = now;
        _secretTitleTapCount++;
        if (_secretTitleTapCount < 7)
            return;
        _secretTitleTapCount = 0;
        _ = UnlockDeveloperGateAsync();
    }

    private async Task UnlockDeveloperGateAsync()
    {
        if (_developerGateUnlocked)
            return;
        await _settingsService.SetAsync(DeveloperModeGateUnlockedKey, true).ConfigureAwait(false);
    }

    public SettingsViewModel(
        ISettingsService settingsService,
        IThemeService themeService,
        ILocalizationService localizationService,
        IChatHistoryClearService chatHistoryClearService,
        IOverlayService overlayService,
        IMainThreadDispatcher mainThreadDispatcher,
        IUpdateService updateService,
        UpdateOrchestrator updateOrchestrator,
        IKeyMap keyMap,
        IPerfDiagnostics perf)
    {
        _settingsService = settingsService;
        _themeService = themeService;
        _localizationService = localizationService;
        _chatHistoryClearService = chatHistoryClearService;
        _overlayService = overlayService;
        _mainThreadDispatcher = mainThreadDispatcher;
        _updateService = updateService;
        _updateOrchestrator = updateOrchestrator;
        _keyMap = keyMap;
        _perf = perf;

        AttachSettingsHandlers();
        _ = LoadInitialSettingsAsync();

        _localizationService.LanguageChanged += OnLanguageChanged;
        RebuildCategories();
    }

    private void AttachSettingsHandlers()
    {
        if (_settingsHandlersAttached)
            return;
        _settingsHandlersAttached = true;
        _settingsService.SettingChanged += OnSettingChanged;
    }

    private async void OnSettingChanged(object? sender, string key)
    {
        if (key is "User.DisplayName" or "User.ProfilePicture")
        {
            await LoadUserProfileAsync().ConfigureAwait(false);
            return;
        }

        if (key is DeveloperModeKey or DeveloperModeGateUnlockedKey)
        {
            _developerGateUnlocked = await _settingsService.GetAsync(DeveloperModeGateUnlockedKey, false).ConfigureAwait(false);
            _developerMode = await _settingsService.GetAsync(DeveloperModeKey, false).ConfigureAwait(false);
            await RebuildCategoriesOnMainThreadAsync().ConfigureAwait(false);
        }
    }

    private async void OnLanguageChanged(object? sender, EventArgs e)
    {
        await RebuildCategoriesOnMainThreadAsync().ConfigureAwait(false);
    }

    private async Task LoadInitialSettingsAsync()
    {
        await LoadUserProfileAsync().ConfigureAwait(false);
        _developerGateUnlocked = await _settingsService.GetAsync(DeveloperModeGateUnlockedKey, false).ConfigureAwait(false);
        _developerMode = await _settingsService.GetAsync(DeveloperModeKey, false).ConfigureAwait(false);
        await RebuildCategoriesOnMainThreadAsync().ConfigureAwait(false);
    }

    private Task RebuildCategoriesOnMainThreadAsync(string? preserveCategoryId = null)
    {
        return _mainThreadDispatcher.InvokeAsync(() =>
        {
            RebuildCategories(preserveCategoryId ?? SelectedCategory?.CategoryId);
            OnPropertyChanged(nameof(CategorySubtitleText));
            return Task.CompletedTask;
        });
    }

    private async Task LoadUserProfileAsync()
    {
        UserName = await _settingsService.GetAsync("User.DisplayName", "John Doe").ConfigureAwait(false);
        ProfilePicturePath = await _settingsService.GetAsync("User.ProfilePicture", "avares://Mnemo.UI/Assets/ProfilePictures/img2.png").ConfigureAwait(false);
    }

    private string T(string key) => _localizationService.T(key, "Settings");

    private void RebuildCategories(string? preserveCategoryId = null)
    {
        // Rebuilding replaces all category/item instances, so any active search is stale.
        _categoryBeforeSearch = null;
        if (SearchText.Length > 0)
        {
            _suppressSearchFilter = true;
            try { SearchText = string.Empty; }
            finally { _suppressSearchFilter = false; }
        }

        var account = new SettingsCategoryViewModel(T("Account"), "avares://Mnemo.UI/Icons/Common/user.svg", "Account");
        var profileGroup = new SettingsGroupViewModel(T("Profile"), isCollapsible: true);
        profileGroup.Items.Add(new ProfilePictureSettingViewModel(_settingsService, T("ProfilePicture"), T("ProfilePictureDescription")));
        profileGroup.Items.Add(new NameSettingViewModel(_settingsService, T("DisplayName"), T("DisplayNameDescription")));
        account.Groups.Add(profileGroup);

        var general = new SettingsCategoryViewModel(T("General"), "avares://Mnemo.UI/Icons/Sidebar/settings.svg", "General") { IsSelected = true };

        var appGroup = new SettingsGroupViewModel(T("Application"), isCollapsible: true);
        appGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "App.LaunchAtStartup", T("LaunchAtStartup"), T("LaunchAtStartupDescription")));
        appGroup.Items.Add(new ToggleSettingViewModel(_settingsService, ToastService.EnableToastsSettingKey, T("EnableToasts"), T("EnableToastsDescription"), true));
        appGroup.Items.Add(new LanguageSettingViewModel(_localizationService, _settingsService));
        appGroup.Items.Add(new ActionSettingViewModel(T("ClearCache"), T("ClearCacheDescription"), T("ClearNow")));

        var expGroup = new SettingsGroupViewModel(T("Experience"), isCollapsible: true);
        expGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "App.EnableGamification", T("EnableGamification"), T("EnableGamificationDescription"), true));
        if (_developerGateUnlocked)
            expGroup.Items.Add(new ToggleSettingViewModel(_settingsService, DeveloperModeKey, "Developer mode", "Shows a Developer section in Settings. Tap the Settings title seven times within two seconds to reveal this switch."));

        general.Groups.Add(appGroup);
        general.Groups.Add(expGroup);

        var editor = new SettingsCategoryViewModel(T("Editor"), "avares://Mnemo.UI/Icons/Common/file-description-filled.svg", "Editor");

        var editorGroup = new SettingsGroupViewModel(T("WritingExperience"), isCollapsible: true);
        editorGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "Editor.AutoSave", T("AutoSave"), T("AutoSaveDescription"), true));
        editorGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "Editor.SpellCheck", T("SpellCheck"), T("SpellCheckDescription"), true));
        editorGroup.Items.Add(new DropdownSettingViewModel(
            _settingsService,
            "Editor.SpellCheckLanguages",
            T("SpellCheckLanguages"),
            T("SpellCheckLanguagesDescription"),
            new[] { "en", "de", "es", "nb" },
            new[] { T("SpellCheckLanguageEnglish"), T("SpellCheckLanguageGerman"), T("SpellCheckLanguageSpanish"), T("SpellCheckLanguageNorwegianBokmal") },
            "en"));
        editorGroup.Items.Add(new StepSliderSettingViewModel(_settingsService, "Editor.Width", T("EditorWidth"), T("EditorWidthDescription"), new[] { T("SuperCompact"), T("Compact"), T("Wide"), T("SuperWide") }, T("Wide")));

        var markdownGroup = new SettingsGroupViewModel(T("MarkdownRendering"), isCollapsible: true);
        markdownGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Markdown.BlockSpacing", T("BlockSpacing"), T("BlockSpacingDescription"), new[] { T("Normal"), T("Compact"), T("Relaxed") }));
        markdownGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Markdown.LineHeight", T("LineSpacing"), T("LineSpacingDescription"), new[] { "1.0", "1.2", "1.4", "1.45", "1.5", "1.6", "1.8", "2.0" }, null, "1.5"));
        markdownGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Markdown.LetterSpacing", T("LetterSpacing"), T("LetterSpacingDescription"), new[] { "0", "0.2", "0.3", "0.4", "0.5", "0.8", "1.0", "1.5" }, null, "0.3"));
        markdownGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Markdown.FontSize", T("BaseFontSize"), T("BaseFontSizeDescription"), new[] { "12px", "13px", "14px", "15px", "16px", "17px", "18px" }, null, "16px"));
        markdownGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Markdown.CodeFontSize", T("CodeFontSize"), T("CodeFontSizeDescription"), new[] { "12px", "13px", "14px", "15px", "16px" }, null, "16px"));
        markdownGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Markdown.MathFontSize", T("MathFontSize"), T("MathFontSizeDescription"), new[] { "14px", "16px", "18px", "20px" }, null, "16px"));
        markdownGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "Markdown.RenderMath", T("RenderLatexMath"), T("RenderLatexMathDescription"), true));

        editor.Groups.Add(editorGroup);
        editor.Groups.Add(markdownGroup);

        var aiTools = new SettingsCategoryViewModel(T("AITools"), "avares://Mnemo.UI/Icons/Common/chart-bubble.svg", "AITools");

        // Assistant group
        var aiGroup = new SettingsGroupViewModel(T("Intelligence"), isCollapsible: true);
        aiGroup.Items.Add(new EnableAiAssistantToggleSettingViewModel(
            _settingsService,
            _overlayService,
            _localizationService,
            "AI.EnableAssistant",
            T("EnableAIAssistant"),
            T("EnableAIAssistantDescription"),
            false));
        aiGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "AI.AgentMode", T("AgentMode"), T("AgentModeDescription"), true));
        aiGroup.Items.Add(new DropdownSettingViewModel(
            _settingsService,
            "Chat.StreamingReveal",
            T("ChatStreamingReveal"),
            T("ChatStreamingRevealDescription"),
            new[] { "instant", "balanced", "smooth" },
            new[] { T("StreamingInstant"), T("StreamingBalanced"), T("StreamingSmooth") },
            "balanced"));
        var clearChatLabel = T("ClearAllChatHistory");
        aiGroup.Items.Add(new AsyncActionSettingViewModel(
            T("ClearChatHistory"),
            T("ClearChatHistoryDescription"),
            clearChatLabel,
            async vm =>
            {
                var confirm = await _overlayService.CreateDialogAsync(
                    T("ClearChatHistoryConfirmTitle"),
                    T("ClearChatHistoryConfirmMessage"),
                    clearChatLabel,
                    _localizationService.T("Cancel", "Common"),
                    severity: DialogSeverity.Destructive);
                if (confirm != clearChatLabel)
                    return;
                var result = await _chatHistoryClearService.ClearAllAsync();
                vm.StatusText = result.IsSuccess
                    ? T("ClearChatHistoryDone")
                    : result.ErrorMessage ?? "Failed";
            }));

        // Web search group. Enabled by default via DuckDuckGo (no key/signup
        // required) so the assistant has a working tool out of the box — a
        // model with zero tools available otherwise has no way to answer
        // current-events questions except by hallucinating one.
        var webSearchGroup = new SettingsGroupViewModel(T("WebSearch"), isCollapsible: true);
        webSearchGroup.Items.Add(new ToggleSettingViewModel(_settingsService, "AI.WebSearch.Enabled", T("WebSearchEnabled"), T("WebSearchEnabledDescription"), true));
        webSearchGroup.Items.Add(new DropdownSettingViewModel(
            _settingsService,
            "AI.WebSearch.Provider",
            T("WebSearchProvider"),
            T("WebSearchProviderDescription"),
            new[] { "None", "DuckDuckGo", "SearXNG", "Brave" },
            defaultStorageValue: "DuckDuckGo"));
        webSearchGroup.Items.Add(new TextSettingViewModel(_settingsService, "AI.WebSearch.SearxngUrl", T("SearxngUrl"), T("SearxngUrlDescription"), "http://localhost:8888"));
        webSearchGroup.Items.Add(new TextSettingViewModel(_settingsService, "AI.WebSearch.BraveApiKey", T("BraveApiKey"), T("BraveApiKeyDescription"), ""));

        aiTools.Groups.Add(aiGroup);
        aiTools.Groups.Add(webSearchGroup);

        var appearance = new SettingsCategoryViewModel(T("Appearance"), "avares://Mnemo.UI/Icons/Common/template.svg", "Appearance");

        var themeGroup = new SettingsGroupViewModel(T("ThemeVisuals"), isCollapsible: true);
        themeGroup.Items.Add(new ThemeSettingViewModel(_themeService, T("AppTheme"), T("AppThemeDescription")));
        themeGroup.Items.Add(new AppIconSettingViewModel(_settingsService, T("AppIcon"), T("AppIconDescription")));

        appearance.Groups.Add(themeGroup);

        var updatesCategory = new SettingsCategoryViewModel(T("UpdatesCategoryTitle"), "avares://Mnemo.UI/Icons/Common/refresh-filled.svg", "Updates");
        var updatesGroup = new SettingsGroupViewModel(T("UpdatesGroupTitle"), isCollapsible: true);
        updatesGroup.Items.Add(new ToggleSettingViewModel(_settingsService, UpdateSettingsKeys.AutoCheck, T("AutoCheckUpdates"), T("AutoCheckUpdatesDescription"), true));
        var versionLine = string.Format(T("CurrentVersionLabelFormat"), _updateService.CurrentDisplayVersion);
        updatesGroup.Items.Add(new AsyncActionSettingViewModel(
            T("CheckForUpdatesNow"),
            versionLine,
            T("CheckNow"),
            async vm =>
            {
                await _updateOrchestrator.RequestManualCheckAsync().ConfigureAwait(false);
                vm.StatusText = _updateOrchestrator.LastManualCheckMessage ?? string.Empty;
            }));
        updatesCategory.Groups.Add(updatesGroup);

        var mindmap = new SettingsCategoryViewModel(T("Mindmap"), "avares://Mnemo.UI/Icons/Common/sitemap.svg", "Mindmap");

        var gridGroup = new SettingsGroupViewModel(T("GridBackground"), isCollapsible: true);
        gridGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Mindmap.GridType", T("GridType"), T("GridTypeDescription"), new[] { "None", "Dotted", "Lines" }, null, "Dotted"));
        gridGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Mindmap.GridSize", T("GridSize"), T("GridSizeDescription"), new[] { "20", "40", "60", "80", "100" }, null, "40"));
        gridGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Mindmap.GridDotSize", T("GridDotSize"), T("GridDotSizeDescription"), new[] { "0.5", "1.0", "1.5", "2.0", "2.5", "3.0" }, null, "1.5"));
        gridGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Mindmap.GridOpacity", T("GridOpacity"), T("GridOpacityDescription"), new[] { "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.8", "1.0" }, null, "0.2"));

        var behaviourGroup = new SettingsGroupViewModel(T("Interaction"), isCollapsible: true);
        behaviourGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Mindmap.MinimapVisibility", T("ShowMinimap"), T("ShowMinimapDescription"), new[] { "Auto", "On", "Off" }, null, "Auto"));
        behaviourGroup.Items.Add(new DropdownSettingViewModel(_settingsService, "Mindmap.ModifierBehaviour", T("ShiftBehaviour"), T("ShiftBehaviourDescription"), new[] { T("Selecting"), T("Panning") }, null, T("Selecting")));

        mindmap.Groups.Add(gridGroup);
        mindmap.Groups.Add(behaviourGroup);

        var hotkeys = new SettingsCategoryViewModel(T("Hotkeys"), "avares://Mnemo.UI/Icons/Common/link.svg", "Hotkeys");
        var hotkeysGroup = new SettingsGroupViewModel(T("Shortcuts"), isCollapsible: true);
        hotkeysGroup.Items.Add(new AsyncActionSettingViewModel(
            T("KeybindManager"),
            T("KeybindManagerDescription"),
            T("OpenManager"),
            async _ =>
            {
                await _mainThreadDispatcher.InvokeAsync(() =>
                {
                    KeybindManagerUi.TryOpen(_overlayService, _keyMap);
                    return Task.CompletedTask;
                }).ConfigureAwait(false);
            }));
        hotkeysGroup.Items.Add(new ActionSettingViewModel(T("NewNote"), T("NewNoteDescription"), T("ChangeBind")));
        hotkeys.Groups.Add(hotkeysGroup);

        Categories.Clear();
        Categories.Add(account);
        Categories.Add(general);
        Categories.Add(editor);
        Categories.Add(aiTools);
        Categories.Add(mindmap);
        Categories.Add(appearance);
        Categories.Add(updatesCategory);
        Categories.Add(hotkeys);

        if (_developerMode)
        {
            var developer = new SettingsCategoryViewModel("Developer", "avares://Mnemo.UI/Icons/Common/layout.svg", "Developer")
            {
                Subtitle = "Internal tools and experimental options for development builds."
            };
            var devGroup = new SettingsGroupViewModel("Developer tools", isCollapsible: true);
            devGroup.Items.Add(new SettingsNoticeViewModel("Reserved for developers", "This page holds developer-only preferences and diagnostics. More options will appear here over time."));
            devGroup.Items.Add(new ToggleSettingViewModel(
                _settingsService,
                IPerfDiagnostics.EnabledSettingKey,
                "Performance diagnostics",
                "Records module load, overlay, markdown render, notes editor (load/save/keystroke/find), chat list metrics, and memory snapshots. Startup timings are always buffered; when enabled, entries also go to the debug log file and console.",
                false));
            devGroup.Items.Add(new AsyncActionSettingViewModel(
                "View performance log",
                "Opens a scrollable report of the last ~500 diagnostic entries.",
                "Open log",
                async _ =>
                {
                    var overlay = new Components.Overlays.PerfDiagnosticsOverlay(_perf);
                    _overlayService.CreateOverlay(overlay, new OverlayOptions
                    {
                        HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
                        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
                        ShowBackdrop = true,
                        CloseOnOutsideClick = true
                    }, "PerfDiagnostics");
                    await Task.CompletedTask;
                }));
            devGroup.Items.Add(new AsyncActionSettingViewModel(
                "Capture memory snapshot",
                "Records managed heap and working set into the performance log.",
                "Snapshot",
                async _ =>
                {
                    _perf.CaptureMemorySnapshot("manual (settings)");
                    await Task.CompletedTask;
                }));
            developer.Groups.Add(devGroup);
            Categories.Add(developer);
        }

        var targetId = preserveCategoryId;
        if (targetId == "Developer" && !_developerMode)
            targetId = "General";

        var pick = !string.IsNullOrEmpty(targetId)
            ? Categories.FirstOrDefault(c => c.CategoryId == targetId)
            : null;
        pick ??= Categories.FirstOrDefault(c => c.CategoryId == "General") ?? Categories.FirstOrDefault();

        foreach (var c in Categories)
            c.IsSelected = false;
        if (pick != null)
        {
            pick.IsSelected = true;
            SelectedCategory = pick;
        }
    }

}
