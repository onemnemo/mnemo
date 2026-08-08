using Mnemo.Core.Models.Widgets;

namespace Mnemo.Host.Contracts;

/// <summary>
/// The saved overview board: schema metadata plus every widget on it. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// <para>
/// One shape for both read and write, unlike the note contracts, because a board save is a
/// full replacement of exactly what a read returns and there is no field a client may read
/// but not set. <c>SchemaVersion</c> is echoed rather than trusted: the store re-stamps it on
/// every save, so a client that sends a stale number cannot downgrade the stored row.
/// </para>
/// </summary>
public sealed record OverviewLayoutDto(
    int SchemaVersion,
    string ProfileId,
    IReadOnlyList<WidgetInstanceDto> Widgets)
{
    public static OverviewLayoutDto FromModel(OverviewLayout model) => new(
        model.SchemaVersion,
        model.ProfileId,
        model.Widgets.Select(WidgetInstanceDto.FromModel).ToList());
}

/// <summary>
/// One widget placed on the board. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C#
/// side is authoritative.
/// <para>
/// <c>Column</c> and <c>Row</c> of <c>-1</c> mean unassigned, not invalid: the layout engine
/// drops such a widget into the first free cell and the store persists the coordinates it
/// lands on. A client seeding a fresh board sends -1 rather than guessing at placement.
/// </para>
/// <para>
/// <c>Settings</c> values are string-encoded and culture-invariant, matching the stored model;
/// the widget that owns a key is the only thing that knows how to read it back.
/// </para>
/// </summary>
public sealed record WidgetInstanceDto(
    Guid InstanceId,
    string WidgetId,
    WidgetSizeDto Size,
    int Column,
    int Row,
    int Order,
    IReadOnlyDictionary<string, string> Settings)
{
    public static WidgetInstanceDto FromModel(WidgetInstance model) => new(
        model.InstanceId,
        model.WidgetId,
        WidgetSizeDto.FromModel(model.Size),
        model.Column,
        model.Row,
        model.Order,
        model.Settings);
}

/// <summary>
/// A widget's column x row span in grid units, not pixels. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
public sealed record WidgetSizeDto(int Columns, int Rows)
{
    public static WidgetSizeDto FromModel(WidgetSize model) => new(model.Columns, model.Rows);
}
