using System.Diagnostics.CodeAnalysis;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Overview;

/// <summary>What a board read was able to establish.</summary>
/// <remarks>
/// Three states rather than a nullable layout, because the two ways of having no board to hand
/// call for opposite client behaviour. A profile that never saved wants the default board seeded
/// over it; a read that failed wants an error and nothing written, since the board is very
/// probably still there and seeding defaults would overwrite it on the next save. Collapsing the
/// two loses somebody's board.
/// </remarks>
public enum OverviewLayoutLoadStatus
{
    /// <summary>A board is stored and was read.</summary>
    Loaded,

    /// <summary>Nothing has ever been saved for this profile; the client seeds its default board.</summary>
    NeverSaved,

    /// <summary>The stored board could not be read. The client shows an error and writes nothing.</summary>
    Failed
}

/// <summary>Outcome of <see cref="OverviewLayoutHandler.LoadAsync"/>.</summary>
public sealed record OverviewLayoutLoadResult(
    OverviewLayoutLoadStatus Status,
    OverviewLayoutDto? Layout,
    string? ErrorMessage)
{
    public static OverviewLayoutLoadResult Loaded(OverviewLayoutDto layout)
        => new(OverviewLayoutLoadStatus.Loaded, layout, null);

    public static OverviewLayoutLoadResult NeverSaved()
        => new(OverviewLayoutLoadStatus.NeverSaved, null, null);

    public static OverviewLayoutLoadResult Failed(string errorMessage)
        => new(OverviewLayoutLoadStatus.Failed, null, errorMessage);
}

/// <summary>What a board write was able to do.</summary>
public enum OverviewLayoutSaveStatus
{
    /// <summary>The board was persisted.</summary>
    Saved,

    /// <summary>The body was not a board this server can store; nothing was written.</summary>
    Malformed,

    /// <summary>The board was well formed but storage refused it.</summary>
    Failed
}

/// <summary>Outcome of <see cref="OverviewLayoutHandler.SaveAsync"/>.</summary>
public sealed record OverviewLayoutSaveResult(OverviewLayoutSaveStatus Status, string? ErrorMessage)
{
    public static OverviewLayoutSaveResult Saved() => new(OverviewLayoutSaveStatus.Saved, null);

    public static OverviewLayoutSaveResult Malformed(string errorMessage)
        => new(OverviewLayoutSaveStatus.Malformed, errorMessage);

    public static OverviewLayoutSaveResult Failed(string errorMessage)
        => new(OverviewLayoutSaveStatus.Failed, errorMessage);
}

/// <summary>
/// Reads and writes the overview board through <see cref="IOverviewLayoutStore"/>, mapping the
/// store's Result convention onto outcomes a route can turn into status codes.
/// </summary>
/// <remarks>
/// Kept out of the endpoint so it can be tested directly: telling a fresh profile apart from a
/// failed read is the whole substance of this endpoint, and there is no way in this repo to
/// exercise a route.
/// </remarks>
public static class OverviewLayoutHandler
{
    /// <summary>
    /// How far down the board a request body may reach, as a row index and as a row span.
    /// </summary>
    /// <remarks>
    /// Placement materializes one array per grid row between the top of the board and the widget,
    /// so a row that arrives unbounded from JSON is an allocation the caller picks the size of:
    /// row 50,000,000 asks for fifty million arrays inside a single request and takes the process
    /// with it. Real boards are a few dozen rows tall at most, so a value past this is either a
    /// hostile body or a client that derived a row from a pixel offset without clamping, and both
    /// are better served by a 400 than by the allocation.
    /// </remarks>
    private const int MaxBoardRow = 1024;

    public static async Task<OverviewLayoutLoadResult> LoadAsync(
        IOverviewLayoutStore store,
        CancellationToken cancellationToken)
    {
        var loaded = await store.LoadAsync(cancellationToken).ConfigureAwait(false);
        if (!loaded.IsSuccess)
            return OverviewLayoutLoadResult.Failed(loaded.ErrorMessage ?? "The overview layout could not be read.");

        // Success carrying null is the store's way of saying the key was never written. A
        // non-null layout with no widgets is a different thing entirely, a board the user
        // deliberately cleared, and it comes back as a real (empty) board.
        return loaded.Value is { } layout
            ? OverviewLayoutLoadResult.Loaded(OverviewLayoutDto.FromModel(layout))
            : OverviewLayoutLoadResult.NeverSaved();
    }

    public static async Task<OverviewLayoutSaveResult> SaveAsync(
        IOverviewLayoutStore store,
        OverviewLayoutDto? body,
        CancellationToken cancellationToken)
    {
        if (!TryBuildLayout(body, out var layout, out var reason))
            return OverviewLayoutSaveResult.Malformed(reason);

        // The store stamps the schema version, seeds coordinates for anything still unplaced and
        // renormalizes Order as part of saving. It mutates the instance it is handed, which is why
        // this builds a fresh model rather than reusing anything the caller can still see.
        var saved = await store.SaveAsync(layout, cancellationToken).ConfigureAwait(false);
        return saved.IsSuccess
            ? OverviewLayoutSaveResult.Saved()
            : OverviewLayoutSaveResult.Failed(saved.ErrorMessage ?? "The overview layout could not be saved.");
    }

    /// <summary>
    /// Turns a request body into a storable board, rejecting what cannot round trip and what the
    /// placement pass cannot safely be handed. Odd sizes, unknown widget ids and unplaced
    /// coordinates all survive: a size the widget no longer offers is snapped to its manifest
    /// when the store reads the board back, and an unknown id is deliberately kept so a removed
    /// widget renders as a placeholder instead of vanishing from someone's board.
    /// </summary>
    private static bool TryBuildLayout(
        OverviewLayoutDto? body,
        [NotNullWhen(true)] out OverviewLayout? layout,
        [NotNullWhen(false)] out string? reason)
    {
        layout = null;

        if (body is null)
        {
            reason = "No layout body.";
            return false;
        }

        if (body.Widgets is null)
        {
            reason = "The layout has no widget list. Send an empty array to clear the board.";
            return false;
        }

        var widgets = new List<WidgetInstance>(body.Widgets.Count);
        foreach (var widget in body.Widgets)
        {
            if (widget is null)
            {
                reason = "The widget list contains a null entry.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(widget.WidgetId))
            {
                reason = "Every widget needs a widgetId.";
                return false;
            }

            if (widget.Size is null)
            {
                reason = $"Widget '{widget.WidgetId}' has no size.";
                return false;
            }

            if (widget.Row > MaxBoardRow)
            {
                reason = $"Widget '{widget.WidgetId}' sits at row {widget.Row}; the board ends at row {MaxBoardRow}.";
                return false;
            }

            if (widget.Size.Rows > MaxBoardRow)
            {
                reason = $"Widget '{widget.WidgetId}' is {widget.Size.Rows} rows tall; the board ends at row {MaxBoardRow}.";
                return false;
            }

            widgets.Add(new WidgetInstance
            {
                // An absent or all-zero id is not an identity, and per-instance settings are keyed
                // by it. Mint one instead of storing a key two widgets could share; the client
                // refetches after the save and picks up what was actually stored.
                InstanceId = widget.InstanceId == Guid.Empty ? Guid.NewGuid() : widget.InstanceId,
                WidgetId = widget.WidgetId,
                Size = new WidgetSize(widget.Size.Columns, widget.Size.Rows),
                Column = widget.Column,
                Row = widget.Row,
                Order = widget.Order,
                Settings = widget.Settings is null
                    ? new Dictionary<string, string>(StringComparer.Ordinal)
                    : new Dictionary<string, string>(widget.Settings, StringComparer.Ordinal)
            });
        }

        layout = new OverviewLayout
        {
            ProfileId = string.IsNullOrWhiteSpace(body.ProfileId) ? OverviewLayout.DefaultProfileId : body.ProfileId,
            Widgets = widgets
        };
        reason = null;
        return true;
    }
}
