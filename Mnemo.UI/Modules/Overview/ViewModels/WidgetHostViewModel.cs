using System.Collections.Generic;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>
/// Host ViewModel for one widget tile on the board: wraps the draft <see cref="WidgetInstance"/>,
/// the resolved manifest, and the widget's content ViewModel. A null <see cref="Content"/> means
/// the widget type is unavailable (e.g. its extension was uninstalled); the tile renders a
/// placeholder with a remove affordance instead of crashing the board.
/// </summary>
public partial class WidgetHostViewModel : ObservableObject
{
    private readonly IWidgetBoardHost _board;

    /// <summary>Draft instance this tile edits; committed to storage when the edit session ends.</summary>
    public WidgetInstance Instance { get; }

    /// <summary>Manifest of the widget type, or null when no descriptor is registered for it.</summary>
    public WidgetManifest? Manifest { get; }

    /// <summary>The widget's content ViewModel (resolved to a view by the ViewLocator); null when unavailable.</summary>
    public IWidgetViewModel? Content { get; }

    /// <summary>True when the widget type has no registered descriptor.</summary>
    public bool IsUnavailable => Content == null;

    /// <summary>Translation namespace for the tile title; empty for unavailable widgets.</summary>
    public string TranslationNamespace => Manifest?.TranslationNamespace ?? string.Empty;

    /// <summary>Localization key for the tile title within <see cref="TranslationNamespace"/>.</summary>
    public string DisplayNameKey => Manifest?.DisplayNameKey ?? string.Empty;

    /// <summary>Raw fallback title (the widget id) shown for unavailable widgets.</summary>
    public string FallbackTitle => Instance.WidgetId;

    /// <summary>Size chips offered in edit mode.</summary>
    public IReadOnlyList<WidgetSizeOptionViewModel> SizeOptions { get; }

    /// <summary>True when the gear should show: the widget declares settings and is present.</summary>
    public bool IsConfigurable => Manifest?.IsConfigurable == true && Content is IWidgetConfigurable;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SizeLabel))]
    private WidgetSize _size;

    /// <summary>Canonical grid column; the panel binds this to place the tile. Writes through to <see cref="Instance"/>.</summary>
    [ObservableProperty]
    private int _column;

    /// <summary>Canonical grid row; the panel binds this to place the tile. Writes through to <see cref="Instance"/>.</summary>
    [ObservableProperty]
    private int _row;

    [ObservableProperty]
    private bool _isEditMode;

    [ObservableProperty]
    private bool _isDragging;

    /// <summary>Current size as a chip/drop label, e.g. "2×1".</summary>
    public string SizeLabel => $"{Size.Columns}×{Size.Rows}";

    public WidgetHostViewModel(WidgetInstance instance, WidgetManifest? manifest, IWidgetViewModel? content, IWidgetBoardHost board)
    {
        Instance = instance;
        Manifest = manifest;
        Content = content;
        _board = board;
        _size = instance.Size;
        _column = instance.Column;
        _row = instance.Row;

        var options = new List<WidgetSizeOptionViewModel>();
        if (manifest != null)
        {
            foreach (var size in manifest.SupportedSizes)
                options.Add(new WidgetSizeOptionViewModel(size, size == instance.Size));
        }
        SizeOptions = options;
    }

    partial void OnSizeChanged(WidgetSize value)
    {
        Instance.Size = value;
        if (Content != null)
            Content.CurrentSize = value;
        foreach (var option in SizeOptions)
            option.IsSelected = option.Size == value;
    }

    partial void OnColumnChanged(int value) => Instance.Column = value;

    partial void OnRowChanged(int value) => Instance.Row = value;

    partial void OnIsEditModeChanged(bool value)
    {
        if (Content != null)
            Content.IsEditing = value;
    }

    [RelayCommand]
    private void Remove() => _board.RequestRemove(this);

    [RelayCommand]
    private void SelectSize(WidgetSizeOptionViewModel? option)
    {
        if (option != null)
            _board.RequestResize(this, option.Size);
    }

    [RelayCommand]
    private Task ConfigureAsync() => _board.RequestConfigureAsync(this);
}
