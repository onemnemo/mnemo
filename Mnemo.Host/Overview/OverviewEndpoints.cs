using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Overview;

/// <summary>
/// Persistence for the overview board: one stored row, read when the page opens and rewritten
/// whenever the user rearranges it. The logic is in <see cref="OverviewLayoutHandler"/>; this
/// file is only the mapping from its outcomes to HTTP.
/// </summary>
public static class OverviewEndpoints
{
    public static void MapOverview(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/overview/layout", async (IOverviewLayoutStore store, CancellationToken cancellationToken) =>
            (await OverviewLayoutHandler.LoadAsync(store, cancellationToken).ConfigureAwait(false)).ToHttpResult());

        endpoints.MapPut("/api/overview/layout", async (OverviewLayoutDto body, IOverviewLayoutStore store, CancellationToken cancellationToken) =>
            (await OverviewLayoutHandler.SaveAsync(store, body, cancellationToken).ConfigureAwait(false)).ToHttpResult());
    }

    /// <summary>
    /// The never-saved answer: 200 carrying a literal JSON <c>null</c>.
    /// </summary>
    /// <remarks>
    /// Written as content rather than through <c>Results.Ok</c> because the framework's JSON
    /// result skips a null value and sends no body at all. An empty body is the one thing this
    /// must not send: the SPA's fetch wrapper parses every response it gets, so a bodiless 200
    /// (or a 204) throws a parse error instead of an ApiError, and the client can no longer tell
    /// "no board saved yet" from "the request failed". Those two want opposite screens, so
    /// OverviewLayoutHttpTests executes this result and asserts the bytes.
    /// </remarks>
    private static readonly IResult NeverSaved = Results.Content("null", "application/json");

    /// <summary>Maps a load outcome onto its response. Public so the wire shapes can be tested.</summary>
    public static IResult ToHttpResult(this OverviewLayoutLoadResult loaded) => loaded.Status switch
    {
        OverviewLayoutLoadStatus.Loaded => Results.Ok(loaded.Layout),
        OverviewLayoutLoadStatus.NeverSaved => NeverSaved,
        // Never the null answer. A client told "nothing saved" seeds its default board and saves
        // it, which would write a starter board over one that is still on disk and merely
        // unreadable this once.
        _ => Results.Json(
            new ErrorDto("overview_layout_unreadable", loaded.ErrorMessage ?? "The overview layout could not be read."),
            statusCode: StatusCodes.Status500InternalServerError)
    };

    /// <summary>Maps a save outcome onto its response. Public so the wire shapes can be tested.</summary>
    public static IResult ToHttpResult(this OverviewLayoutSaveResult saved) => saved.Status switch
    {
        // Nothing useful to hand back: the client already holds the board it sent, and the
        // normalization the store applies arrives through the refetch this triggers.
        OverviewLayoutSaveStatus.Saved => Results.NoContent(),
        OverviewLayoutSaveStatus.Malformed => Results.BadRequest(
            new ErrorDto("invalid_layout", saved.ErrorMessage ?? "The layout body is not storable.")),
        _ => Results.Json(
            new ErrorDto("overview_layout_unwritable", saved.ErrorMessage ?? "The overview layout could not be saved."),
            statusCode: StatusCodes.Status500InternalServerError)
    };
}
