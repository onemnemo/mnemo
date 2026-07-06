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

    /// <summary>Current column × row span. The active column count clamps it at layout time.</summary>
    public WidgetSize Size { get; set; }

    /// <summary>
    /// Canonical grid column of this widget (0-based, on the widest 4-column layout), or
    /// <c>-1</c> when unassigned. Unassigned instances (freshly added, or a pre-coords layout)
    /// are auto-placed at the first free cell on load and persisted with real coordinates.
    /// </summary>
    public int Column { get; set; } = -1;

    /// <summary>Canonical grid row of this widget (0-based), or <c>-1</c> when unassigned. See <see cref="Column"/>.</summary>
    public int Row { get; set; } = -1;

    /// <summary>
    /// Stable serialization tiebreak, normalized from <c>(Row, Column)</c> on save. Also the
    /// flow order used to compact the board at narrow breakpoints where coordinates don't fit.
    /// Placement authority is <see cref="Column"/>/<see cref="Row"/>, not this.
    /// </summary>
    public int Order { get; set; }

    /// <summary>Per-instance setting values keyed by <see cref="WidgetSettingSchema.Key"/>; string-encoded, culture-invariant.</summary>
    public Dictionary<string, string> Settings { get; set; } = new(StringComparer.Ordinal);

    /// <summary>Deep copy used to build the edit-mode draft without aliasing the saved layout.</summary>
    public WidgetInstance Clone() => new()
    {
        InstanceId = InstanceId,
        WidgetId = WidgetId,
        Size = Size,
        Column = Column,
        Row = Row,
        Order = Order,
        Settings = new Dictionary<string, string>(Settings, StringComparer.Ordinal)
    };
}
