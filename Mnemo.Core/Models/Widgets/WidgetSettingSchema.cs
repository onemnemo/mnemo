using System.Collections.Generic;

namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Declares one user-configurable setting of a widget type. The config dialog is generated
/// from these schemas; values are stored per instance in <see cref="WidgetInstance.Settings"/>
/// as culture-invariant strings keyed by <see cref="Key"/>.
/// </summary>
public sealed record WidgetSettingSchema
{
    /// <summary>Stable settings key (snake_case, e.g. "days_to_show").</summary>
    public required string Key { get; init; }

    /// <summary>Localization key for the setting label, resolved in the widget's translation namespace.</summary>
    public required string LabelKey { get; init; }

    /// <summary>Control kind used to edit this setting.</summary>
    public required WidgetSettingType Type { get; init; }

    /// <summary>Default value as a culture-invariant string; used when an instance has no stored value.</summary>
    public required string DefaultValue { get; init; }

    /// <summary>Lower bound for <see cref="WidgetSettingType.Range"/> settings.</summary>
    public double Minimum { get; init; }

    /// <summary>Upper bound for <see cref="WidgetSettingType.Range"/> settings.</summary>
    public double Maximum { get; init; }

    /// <summary>Slider increment for <see cref="WidgetSettingType.Range"/> settings.</summary>
    public double Step { get; init; } = 1;

    /// <summary>Selectable values for <see cref="WidgetSettingType.Choice"/> settings.</summary>
    public IReadOnlyList<WidgetSettingOption> Options { get; init; } = [];
}
