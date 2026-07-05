namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// One selectable value of a <see cref="WidgetSettingType.Choice"/> setting.
/// </summary>
/// <param name="Value">Stable value persisted in <see cref="WidgetInstance.Settings"/> (e.g. "date").</param>
/// <param name="LabelKey">Localization key for the display label, resolved in the widget's translation namespace.</param>
public sealed record WidgetSettingOption(string Value, string LabelKey);
