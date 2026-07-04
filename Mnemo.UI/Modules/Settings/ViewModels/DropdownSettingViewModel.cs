using System;
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class DropdownSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private readonly string _settingsKey;
    private readonly string[] _storageValues;
    private readonly string[] _displayLabels;
    private readonly Func<string, string?>? _normalizeStoredValue;

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private string _selectedOption;
    [ObservableProperty] private bool _isInteractionEnabled = true;
    public ObservableCollection<string> Options { get; }

    /// <summary>
    /// <paramref name="storageValues"/> are persisted. When <paramref name="displayLabels"/> is null, the same strings are shown in the UI.
    /// </summary>
    /// <param name="normalizeStoredValue">Optional: map legacy saved strings to a storage key.</param>
    public DropdownSettingViewModel(
        ISettingsService settingsService,
        string settingsKey,
        string title,
        string description,
        string[] storageValues,
        string[]? displayLabels = null,
        string? defaultStorageValue = null,
        Func<string, string?>? normalizeStoredValue = null,
        bool isInteractionEnabled = true)
    {
        if (storageValues.Length == 0)
            throw new ArgumentException("At least one option is required.");

        var display = displayLabels ?? storageValues;
        if (storageValues.Length != display.Length)
            throw new ArgumentException("Storage and display option counts must match.");

        _settingsService = settingsService;
        _settingsKey = settingsKey;
        _storageValues = storageValues;
        _displayLabels = display;
        _normalizeStoredValue = normalizeStoredValue;

        _title = title;
        _description = description;
        _isInteractionEnabled = isInteractionEnabled;
        Options = new ObservableCollection<string>(display);

        var defaultStorage = defaultStorageValue ?? storageValues[0];
        var saved = _settingsService.GetAsync(_settingsKey, defaultStorage).GetAwaiter().GetResult() ?? defaultStorage;
        var index = ResolveSelectedIndex(saved, defaultStorage);
        _selectedOption = display[index];
    }

    private int ResolveSelectedIndex(string saved, string defaultStorage)
    {
        var idx = Array.FindIndex(_storageValues, x => string.Equals(x, saved, StringComparison.OrdinalIgnoreCase));
        if (idx >= 0)
            return idx;

        var normalized = _normalizeStoredValue?.Invoke(saved);
        if (!string.IsNullOrEmpty(normalized))
        {
            idx = Array.FindIndex(_storageValues, x => string.Equals(x, normalized, StringComparison.OrdinalIgnoreCase));
            if (idx >= 0)
                return idx;
        }

        idx = Array.FindIndex(_storageValues, x => string.Equals(x, defaultStorage, StringComparison.OrdinalIgnoreCase));
        return idx >= 0 ? idx : 0;
    }

    partial void OnSelectedOptionChanged(string value)
    {
        var idx = Array.IndexOf(_displayLabels, value);
        if (idx < 0 || idx >= _storageValues.Length)
            return;

        _ = _settingsService.SetAsync(_settingsKey, _storageValues[idx]);
    }
}
