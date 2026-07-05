using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// One widget placed on the overview board. Identity is <see cref="InstanceId"/> — several
/// instances of the same <see cref="WidgetId"/> may coexist with different settings.
/// Settings travel with the instance so saving the layout is atomic and removing an
/// instance can never orphan its config.
/// </summary>
public sealed class WidgetInstance
{
    /// <summary>Unique identity of this placement; also keys per-instance config.</summary>
    public Guid InstanceId { get; init; } = Guid.NewGuid();

    /// <summary>Which widget type this instance is (a <see cref="WidgetManifest.WidgetId"/>).</summary>
    public required string WidgetId { get; init; }

    /// <summary>Current column × row span. Re-packing derives the actual position; it is never stored.</summary>
    public WidgetSize Size { get; set; }

    /// <summary>Position in the board's ordered flow (0-based). Packing fills holes densely in this order.</summary>
    public int Order { get; set; }

    /// <summary>Per-instance setting values keyed by <see cref="WidgetSettingSchema.Key"/>; string-encoded, culture-invariant.</summary>
    public Dictionary<string, string> Settings { get; set; } = new(StringComparer.Ordinal);

    /// <summary>Deep copy used to build the edit-mode draft without aliasing the saved layout.</summary>
    public WidgetInstance Clone() => new()
    {
        InstanceId = InstanceId,
        WidgetId = WidgetId,
        Size = Size,
        Order = Order,
        Settings = new Dictionary<string, string>(Settings, StringComparer.Ordinal)
    };
}
