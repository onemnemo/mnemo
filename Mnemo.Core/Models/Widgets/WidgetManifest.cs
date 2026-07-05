using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Static description of a widget type: identity, presentation keys, sizing contract, and
/// config schema. Manifests are pure data — safe to list in the widget library without
/// instantiating the widget.
/// </summary>
public sealed record WidgetManifest
{
    /// <summary>Namespaced stable identifier, e.g. "mnemo.recent-notes" or "ext.acme.pomodoro".</summary>
    public required string WidgetId { get; init; }

    /// <summary>Translation namespace that resolves <see cref="DisplayNameKey"/>, <see cref="DescriptionKey"/>, and setting labels.</summary>
    public required string TranslationNamespace { get; init; }

    /// <summary>Localization key for the display name, resolved in <see cref="TranslationNamespace"/>.</summary>
    public string DisplayNameKey { get; init; } = "Title";

    /// <summary>Localization key for the description, resolved in <see cref="TranslationNamespace"/>.</summary>
    public string DescriptionKey { get; init; } = "Description";

    /// <summary>Author shown in the widget library (e.g. "Mnemo" or an extension publisher handle).</summary>
    public required string Author { get; init; }

    /// <summary>Owning extension id, or null for built-in widgets. Drives the library's built-in/extension grouping.</summary>
    public string? SourceExtensionId { get; init; }

    /// <summary>Functional category of the widget.</summary>
    public WidgetCategory Category { get; init; } = WidgetCategory.Statistics;

    /// <summary>Icon as an <c>avares://</c> URI to an SVG shipped beside the widget implementation.</summary>
    public required string IconUri { get; init; }

    /// <summary>Sizes the widget supports, in preference order. Must contain <see cref="DefaultSize"/>.</summary>
    public required IReadOnlyList<WidgetSize> SupportedSizes { get; init; }

    /// <summary>Size used when the widget is first added to the board.</summary>
    public required WidgetSize DefaultSize { get; init; }

    /// <summary>Config schema for per-instance settings; empty when the widget is not configurable.</summary>
    public IReadOnlyList<WidgetSettingSchema> Settings { get; init; } = [];

    /// <summary>True when the widget declares per-instance settings (shows the config gear in edit mode).</summary>
    public bool IsConfigurable => Settings.Count > 0;

    /// <summary>True when the widget ships with Mnemo rather than an extension.</summary>
    public bool IsBuiltIn => string.IsNullOrEmpty(SourceExtensionId);

    /// <summary>
    /// Maps an arbitrary size onto the closest supported size (by column distance, then row
    /// distance). Used when restoring persisted layouts whose sizes are no longer offered.
    /// </summary>
    public WidgetSize NearestSupportedSize(WidgetSize size)
    {
        if (SupportedSizes.Count == 0)
            return DefaultSize;
        if (SupportedSizes.Contains(size))
            return size;

        return SupportedSizes
            .OrderBy(s => Math.Abs(s.Columns - size.Columns))
            .ThenBy(s => Math.Abs(s.Rows - size.Rows))
            .First();
    }

    /// <summary>Default settings bag seeded from the schema defaults.</summary>
    public Dictionary<string, string> CreateDefaultSettings()
    {
        var settings = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var schema in Settings)
            settings[schema.Key] = schema.DefaultValue;
        return settings;
    }
}
