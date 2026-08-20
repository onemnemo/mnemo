using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.UI.Modules.Settings.ViewModels;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Components.Overlays;

public partial class KeybindManagerOverlayViewModel : ViewModelBase
{
    private const string KeybindNs = "Keybinds";
    private const string ShortcutEditorSuppressionScope = "keybind-manager.shortcut-editor";

    private readonly IKeyMap _keyMap;
    private readonly ILocalizationService _localization;
    private readonly ISettingsService _settings;
    private bool _rebuilding;
    private bool _refreshingModuleFilter;
    private bool _shortcutEditorSuppressionPushed;

    public ObservableCollection<KeybindModuleSectionVm> ModuleSections { get; } = new();
    public ObservableCollection<KeybindConflictRowVm> Conflicts { get; } = new();
    public ObservableCollection<KeybindModuleFilterOption> ModuleFilterOptions { get; } = new();

    [ObservableProperty]
    private bool _showDeveloperActionIds;

    [ObservableProperty]
    private string _searchQuery = string.Empty;

    [ObservableProperty]
    private bool _showConflictsOnly;

    [ObservableProperty]
    private KeybindModuleFilterOption? _selectedModuleFilter;

    [ObservableProperty]
    private string _footerStatusText = string.Empty;

    [ObservableProperty]
    private bool _hasConflicts;

    [ObservableProperty]
    private bool _isShortcutEditorOpen;

    [ObservableProperty]
    private string _editorActionTitle = string.Empty;

    [ObservableProperty]
    private bool _editorDisableShortcut;

    [ObservableProperty]
    private bool _editorCanDisableShortcut;

    [ObservableProperty]
    private string? _pendingGestureCanonical;

    public ObservableCollection<ShortcutDisplayPieceVm> EditorCurrentShortcutStrip { get; } = new();
    public ObservableCollection<ShortcutDisplayPieceVm> EditorPendingShortcutStrip { get; } = new();

    /// <summary>Shows the dashed-area placeholder until a chord is captured (or seeded from the current binding).</summary>
    public bool EditorAwaitingCapture =>
        IsShortcutEditorOpen && !EditorDisableShortcut && string.IsNullOrEmpty(PendingGestureCanonical);

    public bool EditorCaptureEnabled => !EditorDisableShortcut;

    public string OverlayTitle => _localization.T("keybindManager.title", KeybindNs);
    public string OverlaySubtitle => _localization.T("keybindManager.subtitle", KeybindNs);
    public string SearchWatermark => _localization.T("keybindManager.searchPlaceholder", KeybindNs);
    public string ConflictsOnlyLabel => _localization.T("keybindManager.conflictsOnly", KeybindNs);
    public string ConflictsHeader => _localization.T("keybindManager.conflictsHeader", KeybindNs);
    public string CloseLabel => _localization.T("keybindManager.close", KeybindNs);
    public string ResetAllLabel => _localization.T("keybindManager.resetAll", KeybindNs);

    public string EditShortcutToolTip => _localization.T("keybindManager.editShortcut", KeybindNs);
    public string EditorPressSubtitle => _localization.T("keybindManager.editorPressShortcut", KeybindNs);
    public string EditorCaptureHint => _localization.T("keybindManager.editorCaptureHint", KeybindNs);
    public string EditorCurrentShortcutLabel => _localization.T("keybindManager.editorCurrentShortcut", KeybindNs);
    public string EditorDisableLabel => _localization.T("keybindManager.editorDisable", KeybindNs);
    public string EditorCancelLabel => _localization.T("keybindManager.editorCancel", KeybindNs);
    public string EditorRestoreDefaultLabel => _localization.T("keybindManager.editorRestoreDefault", KeybindNs);
    public string EditorSaveLabel => _localization.T("keybindManager.editorSave", KeybindNs);
    public string EditorWaitingForInput => _localization.T("keybindManager.editorWaiting", KeybindNs);

    public KeybindManagerOverlayViewModel(IKeyMap keyMap, ILocalizationService localization, ISettingsService settings)
    {
        _keyMap = keyMap;
        _localization = localization;
        _settings = settings;
        _localization.LanguageChanged += OnLanguageChanged;
        _settings.SettingChanged += OnSettingChanged;
        RebuildAll();
    }

    private void OnSettingChanged(object? sender, string key)
    {
        if (key == SettingsViewModel.DeveloperModeKey)
            _ = LoadAsync();
    }

    public async Task LoadAsync()
    {
        ShowDeveloperActionIds = await _settings.GetAsync(SettingsViewModel.DeveloperModeKey, false).ConfigureAwait(true);
    }

    private void OnLanguageChanged(object? sender, EventArgs e) => RebuildAll();

    [RelayCommand]
    private async Task ResetAllAsync()
    {
        await _keyMap.ResetAllOverridesAsync().ConfigureAwait(true);
        RebuildAll();
    }

    [RelayCommand]
    private void CancelShortcutEditor()
    {
        CloseShortcutEditor();
    }

    [RelayCommand(CanExecute = nameof(CanSaveShortcutEditor))]
    private async Task SaveShortcutEditorAsync()
    {
        if (string.IsNullOrEmpty(_editingActionId))
            return;

        if (EditorDisableShortcut)
        {
            if (!EditorCanDisableShortcut)
                return;
            await _keyMap.ApplyUserOverrideAsync(
                _editingActionId,
                new KeybindOverrideDocument { Enabled = false },
                CancellationToken.None).ConfigureAwait(true);
        }
        else
        {
            if (string.IsNullOrEmpty(PendingGestureCanonical))
                return;
            await _keyMap.ApplyUserOverrideAsync(
                _editingActionId,
                new KeybindOverrideDocument
                {
                    Enabled = true,
                    Bindings =
                    [
                        new KeybindOverrideBindingDto { Kind = "chord", Gesture = PendingGestureCanonical }
                    ]
                },
                CancellationToken.None).ConfigureAwait(true);
        }

        CloseShortcutEditor();
        RebuildAll();
    }

    [RelayCommand]
    private async Task RestoreDefaultInEditorAsync()
    {
        if (string.IsNullOrEmpty(_editingActionId))
            return;
        await _keyMap.ApplyUserOverrideAsync(_editingActionId, null, CancellationToken.None).ConfigureAwait(true);
        CloseShortcutEditor();
        RebuildAll();
    }

    private string? _editingActionId;

    private bool CanSaveShortcutEditor() =>
        (EditorCanDisableShortcut && EditorDisableShortcut) || !string.IsNullOrEmpty(PendingGestureCanonical);

    partial void OnPendingGestureCanonicalChanged(string? value)
    {
        SaveShortcutEditorCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(EditorAwaitingCapture));
    }

    partial void OnEditorDisableShortcutChanged(bool value)
    {
        if (value)
        {
            PendingGestureCanonical = null;
            EditorPendingShortcutStrip.Clear();
        }
        else if (!string.IsNullOrEmpty(_editingActionId))
        {
            var def = _keyMap.GetAllStaticDefinitionsMerged().FirstOrDefault(d => d.ActionId == _editingActionId);
            if (def != null)
                SeedPendingFromDefinition(def);
        }

        SaveShortcutEditorCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(EditorAwaitingCapture));
        OnPropertyChanged(nameof(EditorCaptureEnabled));
    }

    partial void OnEditorCanDisableShortcutChanged(bool value) =>
        SaveShortcutEditorCommand.NotifyCanExecuteChanged();

    partial void OnIsShortcutEditorOpenChanged(bool value)
    {
        OnPropertyChanged(nameof(EditorAwaitingCapture));
        OnPropertyChanged(nameof(EditorCaptureEnabled));
    }

    /// <summary>Opens the chord editor; called from the view (avoid binding <see cref="Button.Command"/> to generic RelayCommand, Avalonia can NRE).</summary>
    public void RequestBeginEditShortcut(string? actionId) => BeginEditShortcut(actionId);

    private void BeginEditShortcut(string? actionId)
    {
        if (string.IsNullOrEmpty(actionId))
            return;

        var def = _keyMap.GetAllStaticDefinitionsMerged().FirstOrDefault(d => d.ActionId == actionId);
        if (def == null || !IsShortcutCatalogEntryEditable(def))
            return;

        _editingActionId = actionId;
        EditorActionTitle = ActionTitle(def);
        EditorCanDisableShortcut = def.Scope == KeybindScope.Global;
        EditorDisableShortcut = EditorCanDisableShortcut && !def.Enabled;
        PendingGestureCanonical = null;
        EditorPendingShortcutStrip.Clear();

        EditorCurrentShortcutStrip.Clear();
        foreach (var piece in BuildShortcutStripPieces(def))
            EditorCurrentShortcutStrip.Add(piece);

        if (!EditorDisableShortcut)
            SeedPendingFromDefinition(def);

        IsShortcutEditorOpen = true;
        PushShortcutEditorSuppression();
        SaveShortcutEditorCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(EditorAwaitingCapture));
        OnPropertyChanged(nameof(EditorCaptureEnabled));
    }

    /// <summary>Records a normalized chord from the editor capture zone (modifiers-only keys should be filtered by the view).</summary>
    public void ApplyCapturedChord(LogicalChord chord)
    {
        if (!IsShortcutEditorOpen || EditorDisableShortcut)
            return;

        string canonical;
        try
        {
            canonical = CanonicalKeyGestureCodec.ToCanonicalString(chord);
            _ = CanonicalKeyGestureCodec.ParseChord(canonical);
        }
        catch (FormatException)
        {
            return;
        }

        PendingGestureCanonical = canonical;
        EditorPendingShortcutStrip.Clear();
        foreach (var piece in ChordToDisplayPieces(chord))
            EditorPendingShortcutStrip.Add(piece);
    }

    private void CloseShortcutEditor()
    {
        PopShortcutEditorSuppression();
        _editingActionId = null;
        PendingGestureCanonical = null;
        EditorPendingShortcutStrip.Clear();
        EditorCurrentShortcutStrip.Clear();
        IsShortcutEditorOpen = false;
        SaveShortcutEditorCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(EditorAwaitingCapture));
        OnPropertyChanged(nameof(EditorCaptureEnabled));
    }

    private void PushShortcutEditorSuppression()
    {
        if (_shortcutEditorSuppressionPushed)
            return;
        _keyMap.PushSuppression(
            ShortcutEditorSuppressionScope,
            new KeybindSuppressionPolicy { SuppressAll = true });
        _shortcutEditorSuppressionPushed = true;
    }

    private void PopShortcutEditorSuppression()
    {
        if (!_shortcutEditorSuppressionPushed)
            return;
        _keyMap.PopSuppression(ShortcutEditorSuppressionScope);
        _shortcutEditorSuppressionPushed = false;
    }

    private void SeedPendingFromDefinition(KeybindActionDefinition def)
    {
        if (!TryGetFirstChord(def, out var chord))
        {
            PendingGestureCanonical = null;
            EditorPendingShortcutStrip.Clear();
            return;
        }

        PendingGestureCanonical = CanonicalKeyGestureCodec.ToCanonicalString(chord);
        EditorPendingShortcutStrip.Clear();
        foreach (var piece in ChordToDisplayPieces(chord))
            EditorPendingShortcutStrip.Add(piece);
    }

    private static bool TryGetFirstChord(KeybindActionDefinition def, out LogicalChord chord)
    {
        foreach (var b in def.Bindings)
        {
            if (b.Kind == KeybindBindingKind.Chord && b.Chord is { } c)
            {
                chord = c;
                return true;
            }
        }

        chord = default;
        return false;
    }

    private static bool IsShortcutCatalogEntryEditable(KeybindActionDefinition def) =>
        !def.Bindings.Any(b => b.Kind == KeybindBindingKind.Sequence);

    private IEnumerable<ShortcutDisplayPieceVm> BuildShortcutStripPieces(KeybindActionDefinition def)
    {
        var strip = new ObservableCollection<ShortcutDisplayPieceVm>();
        FillShortcutStrip(def, strip);
        return strip;
    }

    private void FillShortcutStrip(KeybindActionDefinition def, ObservableCollection<ShortcutDisplayPieceVm> strip)
    {
        if (def.Bindings.Count == 0)
        {
            strip.Add(new ShortcutDisplayPieceVm(ShortcutStripPieceKind.KeyPill, "—"));
            return;
        }

        var thenText = _localization.T("keybindManager.then", KeybindNs);
        for (var bi = 0; bi < def.Bindings.Count; bi++)
        {
            if (bi > 0)
                strip.Add(new ShortcutDisplayPieceVm(ShortcutStripPieceKind.AlternativeSeparator, "·"));
            foreach (var pill in KeybindGestureDisplayFormatter.FormatBindingDisplayPills(def.Bindings[bi]))
            {
                if (pill.IsThenSeparator)
                    strip.Add(new ShortcutDisplayPieceVm(ShortcutStripPieceKind.ThenLabel, thenText));
                else
                    strip.Add(new ShortcutDisplayPieceVm(ShortcutStripPieceKind.KeyPill, pill.Text));
            }
        }
    }

    private static IEnumerable<ShortcutDisplayPieceVm> ChordToDisplayPieces(LogicalChord chord)
    {
        var entry = new KeybindBindingEntry { Kind = KeybindBindingKind.Chord, Chord = chord };
        foreach (var pill in KeybindGestureDisplayFormatter.FormatBindingDisplayPills(entry))
        {
            if (pill.IsThenSeparator)
                continue;
            yield return new ShortcutDisplayPieceVm(ShortcutStripPieceKind.KeyPill, pill.Text);
        }
    }

    partial void OnSearchQueryChanged(string value) => RebuildListCore();

    partial void OnShowConflictsOnlyChanged(bool value) => RebuildListCore();

    partial void OnSelectedModuleFilterChanged(KeybindModuleFilterOption? value)
    {
        if (_refreshingModuleFilter)
            return;
        RebuildListCore();
    }

    partial void OnShowDeveloperActionIdsChanged(bool value) => RebuildListCore();

    private void RebuildAll()
    {
        if (_rebuilding)
            return;
        _rebuilding = true;
        try
        {
            RefreshModuleFilterOptions();
            RebuildListCore();
            NotifyOverlayStringsChanged();
        }
        finally
        {
            _rebuilding = false;
        }
    }

    /// <summary>Rebuilds the shortcut list, conflicts, and footer. Does not replace <see cref="ModuleFilterOptions"/> (ComboBox loses selection visuals if ItemsSource is cleared on every selection change).</summary>
    private void RebuildListCore()
    {
        var conflictIds = new HashSet<string>(StringComparer.Ordinal);
        Conflicts.Clear();
        foreach (var c in _keyMap.CheckConflictsAllStatic())
        {
            Conflicts.Add(new KeybindConflictRowVm(c.Severity.ToString(), c.Message, c.ActionIdA, c.ActionIdB));
            if (!string.IsNullOrEmpty(c.ActionIdA))
                conflictIds.Add(c.ActionIdA);
            if (!string.IsNullOrEmpty(c.ActionIdB))
                conflictIds.Add(c.ActionIdB);
        }

        HasConflicts = Conflicts.Count > 0;

        var allDefs = _keyMap.GetAllStaticDefinitionsMerged().ToList();
        var totalCount = allDefs.Count;

        var q = SearchQuery.Trim();
        var moduleId = SelectedModuleFilter?.ModuleId;

        IEnumerable<KeybindActionDefinition> filtered = allDefs;
        if (ShowConflictsOnly)
            filtered = filtered.Where(d => conflictIds.Contains(d.ActionId));
        if (!string.IsNullOrEmpty(moduleId))
            filtered = filtered.Where(d => string.Equals(d.Module, moduleId, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(q))
        {
            filtered = filtered.Where(d =>
                ActionTitle(d).Contains(q, StringComparison.OrdinalIgnoreCase) ||
                d.ActionId.Contains(q, StringComparison.OrdinalIgnoreCase));
        }

        var list = filtered
            .OrderBy(d => BuiltinModuleSortIndex(d.Module))
            .ThenBy(d => d.Module ?? "core", StringComparer.OrdinalIgnoreCase)
            .ThenBy(d => d.DisplayCategoryKey ?? "")
            .ThenBy(d => d.ActionId, StringComparer.Ordinal)
            .ToList();

        ModuleSections.Clear();
        foreach (var moduleGroup in list.GroupBy(d => d.Module ?? "core"))
        {
            var moduleKey = moduleGroup.Key;
            var moduleLabel = _localization.T("module." + moduleKey, KeybindNs);
            var section = new KeybindModuleSectionVm(
                moduleLabel,
                new ObservableCollection<KeybindCategorySectionVm>());

            foreach (var catGroup in moduleGroup.GroupBy(d => d.DisplayCategoryKey ?? "category.general"))
            {
                var catKey = catGroup.Key;
                var catLabel = _localization.T(catKey, KeybindNs);
                var catSection = new KeybindCategorySectionVm(
                    catLabel,
                    new ObservableCollection<KeybindActionRowVm>());

                foreach (var def in catGroup.OrderBy(d => ActionTitle(d), StringComparer.OrdinalIgnoreCase))
                    catSection.Rows.Add(BuildRow(def));

                section.Categories.Add(catSection);
            }

            ModuleSections.Add(section);
        }

        var shown = list.Count;
        FooterStatusText = string.Format(
            _localization.T("keybindManager.footerCount", KeybindNs),
            shown,
            totalCount);
    }

    private void NotifyOverlayStringsChanged()
    {
        OnPropertyChanged(nameof(OverlayTitle));
        OnPropertyChanged(nameof(OverlaySubtitle));
        OnPropertyChanged(nameof(SearchWatermark));
        OnPropertyChanged(nameof(ConflictsOnlyLabel));
        OnPropertyChanged(nameof(ConflictsHeader));
        OnPropertyChanged(nameof(CloseLabel));
        OnPropertyChanged(nameof(ResetAllLabel));
        OnPropertyChanged(nameof(EditShortcutToolTip));
        OnPropertyChanged(nameof(EditorPressSubtitle));
        OnPropertyChanged(nameof(EditorCaptureHint));
        OnPropertyChanged(nameof(EditorCurrentShortcutLabel));
        OnPropertyChanged(nameof(EditorDisableLabel));
        OnPropertyChanged(nameof(EditorCancelLabel));
        OnPropertyChanged(nameof(EditorRestoreDefaultLabel));
        OnPropertyChanged(nameof(EditorSaveLabel));
        OnPropertyChanged(nameof(EditorWaitingForInput));
    }

    private void RefreshModuleFilterOptions()
    {
        var all = _keyMap.GetAllStaticDefinitionsMerged();
        var distinct = all
            .Select(d => d.Module ?? "core")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(m => BuiltinModuleSortIndex(m))
            .ThenBy(m => m, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var prevId = SelectedModuleFilter?.ModuleId;
        _refreshingModuleFilter = true;
        try
        {
            ModuleFilterOptions.Clear();
            ModuleFilterOptions.Add(new KeybindModuleFilterOption(
                null,
                _localization.T("keybindManager.filterAllModules", KeybindNs)));
            foreach (var m in distinct)
            {
                ModuleFilterOptions.Add(new KeybindModuleFilterOption(
                    m,
                    _localization.T("module." + m, KeybindNs)));
            }

            SelectedModuleFilter = ModuleFilterOptions.FirstOrDefault(o => o.ModuleId == prevId)
                ?? ModuleFilterOptions[0];
        }
        finally
        {
            _refreshingModuleFilter = false;
        }
    }

    private string ActionTitle(KeybindActionDefinition def)
    {
        var labelKey = def.DisplayLabelKey ?? def.ActionId;
        return _localization.T(labelKey, KeybindNs);
    }

    private KeybindActionRowVm BuildRow(KeybindActionDefinition def)
    {
        var title = ActionTitle(def);
        string? detail = null;
        if (!string.IsNullOrEmpty(def.DisplayDescriptionKey))
        {
            var desc = _localization.T(def.DisplayDescriptionKey, KeybindNs);
            if (!string.Equals(desc, def.DisplayDescriptionKey, StringComparison.Ordinal))
                detail = desc;
        }

        var strip = new ObservableCollection<ShortcutDisplayPieceVm>();
        FillShortcutStrip(def, strip);

        return new KeybindActionRowVm(
            title,
            detail,
            strip,
            def.ActionId,
            def.Enabled,
            ShowDeveloperActionIds,
            IsShortcutCatalogEntryEditable(def),
            _localization.T("keybindManager.editShortcut", KeybindNs));
    }

    /// <summary>
    /// Shipped modules get a stable, readable order in the overlay. Any other <see cref="KeybindActionDefinition.Module"/>
    /// (extensions, future features) shares one tier and sorts alphabetically by module id after these.
    /// </summary>
    private static readonly string[] BuiltinModuleDisplayOrder =
    [
        "core",
        "editor",
        "mindmap",
        "flashcards",
    ];

    private static int BuiltinModuleSortIndex(string? moduleId)
    {
        var key = (moduleId ?? "core").ToLowerInvariant();
        for (var i = 0; i < BuiltinModuleDisplayOrder.Length; i++)
        {
            if (string.Equals(BuiltinModuleDisplayOrder[i], key, StringComparison.Ordinal))
                return i;
        }
        return BuiltinModuleDisplayOrder.Length;
    }
}

public sealed record KeybindModuleFilterOption(string? ModuleId, string Label)
{
    public override string ToString() => Label;
}

public sealed class KeybindModuleSectionVm(string moduleTitle, ObservableCollection<KeybindCategorySectionVm> categories)
{
    public string ModuleTitle { get; } = moduleTitle;
    public string ModuleHeaderUpper => ModuleTitle.ToUpperInvariant();
    public ObservableCollection<KeybindCategorySectionVm> Categories { get; } = categories;
}

public sealed class KeybindCategorySectionVm(string categoryTitle, ObservableCollection<KeybindActionRowVm> rows)
{
    public string CategoryTitle { get; } = categoryTitle;
    public ObservableCollection<KeybindActionRowVm> Rows { get; } = rows;
}

public sealed class KeybindActionRowVm(
    string title,
    string? detailLine,
    ObservableCollection<ShortcutDisplayPieceVm> shortcutStrip,
    string actionId,
    bool enabled,
    bool showDeveloperActionId,
    bool isShortcutEditable,
    string editShortcutToolTip)
{
    public string Title { get; } = title;
    public string? DetailLine { get; } = detailLine;
    public bool HasDetailLine => !string.IsNullOrEmpty(DetailLine);
    public ObservableCollection<ShortcutDisplayPieceVm> ShortcutStrip { get; } = shortcutStrip;
    public string ActionId { get; } = actionId;
    public bool Enabled { get; } = enabled;
    public bool ShowDeveloperActionId { get; } = showDeveloperActionId;
    public bool IsShortcutEditable => isShortcutEditable;
    public string EditShortcutToolTip => editShortcutToolTip;
}

public enum ShortcutStripPieceKind
{
    KeyPill,
    ThenLabel,
    AlternativeSeparator,
}

public sealed class ShortcutDisplayPieceVm(ShortcutStripPieceKind kind, string text)
{
    public ShortcutStripPieceKind Kind { get; } = kind;
    public string Text { get; } = text;
    public bool IsKeyPill => Kind == ShortcutStripPieceKind.KeyPill;
    public bool IsThenLabel => Kind == ShortcutStripPieceKind.ThenLabel;
    public bool IsAlternativeSeparator => Kind == ShortcutStripPieceKind.AlternativeSeparator;
}

public sealed record KeybindConflictRowVm(string Severity, string Message, string? ActionIdA, string? ActionIdB);
