using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>One selectable option of a choice setting, with its localized label.</summary>
public sealed class WidgetConfigChoiceOption
{
    public string Value { get; }
    public string Label { get; }

    public WidgetConfigChoiceOption(string value, string label)
    {
        Value = value;
        Label = label;
    }
}

/// <summary>
/// One editable setting in the config dialog, generated from its
/// <see cref="WidgetSettingSchema"/>: toggle for booleans, slider for ranges, dropdown for choices.
/// </summary>
public partial class WidgetConfigEntryViewModel : ObservableObject
{
    public WidgetSettingSchema Schema { get; }

    public string Label { get; }

    public bool IsToggle => Schema.Type == WidgetSettingType.Toggle;
    public bool IsRange => Schema.Type == WidgetSettingType.Range;
    public bool IsChoice => Schema.Type == WidgetSettingType.Choice;

    public double Minimum => Schema.Minimum;
    public double Maximum => Schema.Maximum;
    public double Step => Schema.Step;

    public IReadOnlyList<WidgetConfigChoiceOption> Options { get; }

    [ObservableProperty]
    private bool _boolValue;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(RangeValueText))]
    private double _rangeValue;

    [ObservableProperty]
    private WidgetConfigChoiceOption? _selectedOption;

    /// <summary>Numeric readout beside the slider.</summary>
    public string RangeValueText => ((int)Math.Round(RangeValue)).ToString(CultureInfo.CurrentCulture);

    public WidgetConfigEntryViewModel(WidgetSettingSchema schema, string label, IReadOnlyList<WidgetConfigChoiceOption> options, string currentValue)
    {
        Schema = schema;
        Label = label;
        Options = options;

        switch (schema.Type)
        {
            case WidgetSettingType.Toggle:
                BoolValue = bool.TryParse(currentValue, out var b) && b;
                break;
            case WidgetSettingType.Range:
                RangeValue = double.TryParse(currentValue, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)
                    ? Math.Clamp(d, schema.Minimum, schema.Maximum)
                    : schema.Minimum;
                break;
            case WidgetSettingType.Choice:
                SelectedOption = Options.FirstOrDefault(o => string.Equals(o.Value, currentValue, StringComparison.Ordinal))
                                 ?? Options.FirstOrDefault();
                break;
        }
    }

    /// <summary>Current value encoded for the instance settings bag.</summary>
    public string EncodeValue() => Schema.Type switch
    {
        WidgetSettingType.Toggle => WidgetSettingValues.FromBool(BoolValue),
        WidgetSettingType.Range => WidgetSettingValues.FromInt((int)Math.Round(RangeValue)),
        WidgetSettingType.Choice => SelectedOption?.Value ?? Schema.DefaultValue,
        _ => Schema.DefaultValue
    };
}

/// <summary>
/// Schema-driven config dialog for one widget instance. Save applies the values through
/// <see cref="IWidgetConfigurable.SetConfigAsync"/> (which refreshes the widget) and the board
/// persists them on the instance.
/// </summary>
public partial class WidgetConfigViewModel : ObservableObject
{
    private readonly Func<IReadOnlyDictionary<string, string>, Task> _applyAsync;
    private IOverlayService? _overlayService;
    private string? _overlayId;

    /// <summary>Localized widget display name shown in the dialog header.</summary>
    public string WidgetTitle { get; }

    public IReadOnlyList<WidgetConfigEntryViewModel> Entries { get; }

    [ObservableProperty]
    private bool _isSaving;

    public WidgetConfigViewModel(
        WidgetManifest manifest,
        IReadOnlyDictionary<string, string> currentValues,
        ILocalizationService localization,
        Func<IReadOnlyDictionary<string, string>, Task> applyAsync)
    {
        _applyAsync = applyAsync;
        WidgetTitle = localization.T(manifest.DisplayNameKey, manifest.TranslationNamespace);

        var entries = new List<WidgetConfigEntryViewModel>();
        foreach (var schema in manifest.Settings)
        {
            var label = localization.T(schema.LabelKey, manifest.TranslationNamespace);
            var options = schema.Options
                .Select(o => new WidgetConfigChoiceOption(o.Value, localization.T(o.LabelKey, manifest.TranslationNamespace)))
                .ToList();
            var current = currentValues.TryGetValue(schema.Key, out var value) ? value : schema.DefaultValue;
            entries.Add(new WidgetConfigEntryViewModel(schema, label, options, current));
        }

        Entries = entries;
    }

    /// <summary>Wires the dialog to its overlay so Save/Cancel can dismiss it.</summary>
    public void AttachOverlay(IOverlayService overlayService, string overlayId)
    {
        _overlayService = overlayService;
        _overlayId = overlayId;
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        IsSaving = true;
        try
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var entry in Entries)
                values[entry.Schema.Key] = entry.EncodeValue();

            await _applyAsync(values);
            CloseOverlay();
        }
        finally
        {
            IsSaving = false;
        }
    }

    [RelayCommand]
    private void Cancel() => CloseOverlay();

    private void CloseOverlay()
    {
        if (_overlayService != null && _overlayId != null)
            _overlayService.CloseOverlay(_overlayId);
    }
}
