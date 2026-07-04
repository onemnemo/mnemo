using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>
/// A titled section of setting rows within a category. When constructed with a
/// master toggle it becomes a progressive-disclosure block: the toggle renders
/// as the section's header row, the rows show on an inset rail while the toggle
/// is on, and collapse to a hidden-count hint (plus an optional notice) while off.
/// </summary>
public partial class SettingsGroupViewModel : ViewModelBase
{
    private readonly string? _hiddenSummaryFormat;

    [ObservableProperty] private string _name;

    public ObservableCollection<ViewModelBase> Items { get; } = new();

    /// <summary>Master switch gating this group's rows; null for plain groups.</summary>
    public IToggleSetting? MasterToggle { get; }

    /// <summary>Quiet notice shown instead of the rows while the master toggle is off.</summary>
    public SettingsNoticeViewModel? OffNotice { get; init; }

    public bool HasMasterToggle => MasterToggle != null;

    public bool IsContentVisible => MasterToggle?.Value ?? true;

    public bool IsOffNoticeVisible => OffNotice != null && !IsContentVisible;

    /// <summary>
    /// Description under the master row: the toggle's own description while on,
    /// a "N settings hidden" hint while off (subheaders don't count as settings).
    /// </summary>
    public string? MasterDescription =>
        MasterToggle == null
            ? null
            : IsContentVisible || _hiddenSummaryFormat == null
                ? MasterToggle.Description
                : string.Format(_hiddenSummaryFormat, Items.Count(item => item is not SettingsSubheaderViewModel));

    public SettingsGroupViewModel(string name)
    {
        _name = name;
    }

    public SettingsGroupViewModel(string name, IToggleSetting masterToggle, string hiddenSummaryFormat)
        : this(name)
    {
        MasterToggle = masterToggle;
        _hiddenSummaryFormat = hiddenSummaryFormat;
        masterToggle.PropertyChanged += OnMasterToggleChanged;
    }

    private void OnMasterToggleChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not nameof(IToggleSetting.Value))
            return;
        OnPropertyChanged(nameof(IsContentVisible));
        OnPropertyChanged(nameof(IsOffNoticeVisible));
        OnPropertyChanged(nameof(MasterDescription));
    }
}
