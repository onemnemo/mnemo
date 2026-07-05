namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Kind of UI control a widget setting is rendered with in the schema-driven config dialog.
/// </summary>
public enum WidgetSettingType
{
    /// <summary>Boolean setting rendered as a toggle switch. Values: "true" / "false".</summary>
    Toggle,

    /// <summary>Numeric setting rendered as a slider bounded by the schema's minimum/maximum.</summary>
    Range,

    /// <summary>Enumerated setting rendered as a dropdown of the schema's options.</summary>
    Choice
}
