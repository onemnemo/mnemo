using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Persisted overview board: an ordered list of widget instances plus schema metadata.
/// Positions are never stored — the layout engine re-derives them from order + spans.
/// </summary>
public sealed class OverviewLayout
{
    /// <summary>Schema version written by the current code; bump when the shape changes.</summary>
    public const int CurrentSchemaVersion = 2;

    /// <summary>Default profile identifier until multiple board profiles ship.</summary>
    public const string DefaultProfileId = "default";

    public int SchemaVersion { get; set; } = CurrentSchemaVersion;

    public string ProfileId { get; set; } = DefaultProfileId;

    /// <summary>Widgets in board order. <see cref="WidgetInstance.Order"/> is normalized on save.</summary>
    public List<WidgetInstance> Widgets { get; set; } = new();

    /// <summary>Deep copy used as the edit-mode draft (commit on Done, discard on Cancel).</summary>
    public OverviewLayout Clone() => new()
    {
        SchemaVersion = SchemaVersion,
        ProfileId = ProfileId,
        Widgets = Widgets.Select(w => w.Clone()).ToList()
    };
}
