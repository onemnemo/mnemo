using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Trash;

/// <summary>
/// The shared trash routes. Module delete endpoints stay where they are and answer with
/// <see cref="TrashActionDto"/>; everything after the delete happens here.
/// </summary>
/// <remarks>
/// An expected conflict answers with its own body rather than a bare error, because the page has
/// to say which entries blocked the request. Only a bad kind and an unavailable module produce a
/// plain error code.
/// </remarks>
public static class TrashEndpoints
{
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;

    /// <summary>Maps the shared trash routes.</summary>
    public static void MapTrash(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/trash", async (
            string? cursor,
            int? limit,
            string? kind,
            string? query,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var request = new TrashListQuery(
                Blank(cursor),
                Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize),
                Blank(kind),
                Blank(query));
            var page = await trash.ListAsync(request, cancellationToken).ConfigureAwait(false);
            return TrashPageDto.FromModel(page);
        }).RequireTrash();

        endpoints.MapGet("/api/trash/count", async (ITrashService trash, CancellationToken cancellationToken) =>
            new TrashCountDto(await trash.CountAsync(cancellationToken).ConfigureAwait(false)))
            .RequireTrash();

        endpoints.MapPost("/api/trash/{entryId}/restore", async (
            string entryId,
            TrashRestoreRequestDto? body,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var results = await trash
                .RestoreAsync([entryId], Destination(body), cancellationToken)
                .ConfigureAwait(false);
            return TrashRestoreResponseDto.FromModel(results);
        }).RequireTrash();

        endpoints.MapPost("/api/trash/restore", async (
            TrashRestoreRequestDto body,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var entryIds = body.EntryIds ?? [];
            if (entryIds.Count == 0)
                return Results.BadRequest(new ErrorDto("no_entries", "Restore needs at least one entry."));

            var results = await trash
                .RestoreAsync(entryIds, Destination(body), cancellationToken)
                .ConfigureAwait(false);
            return Results.Ok(TrashRestoreResponseDto.FromModel(results));
        }).RequireTrash();

        endpoints.MapPost("/api/trash/batches/{batchId}/restore", async (
            string batchId,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var results = await trash.RestoreBatchAsync(batchId, cancellationToken).ConfigureAwait(false);
            return TrashRestoreResponseDto.FromModel(results);
        }).RequireTrash();

        endpoints.MapDelete("/api/trash/{entryId}", async (
            string entryId,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var result = await trash.PurgeAsync(entryId, cancellationToken).ConfigureAwait(false);
            var dto = TrashPurgeResultDto.FromModel(result);

            // Nothing was destroyed because other entries own rows the same cascade would reach.
            // The body names them, so the page can say what has to be handled first.
            return result.Purged
                ? Results.Ok(dto)
                : Results.Json(dto, statusCode: StatusCodes.Status409Conflict);
        }).RequireTrash();

        endpoints.MapPost("/api/trash/empty", async (ITrashService trash, CancellationToken cancellationToken) =>
        {
            var result = await trash.EmptyAsync(cancellationToken).ConfigureAwait(false);
            return TrashEmptyResultDto.FromModel(result);
        }).RequireTrash();
    }

    private static TrashRestoreTarget? Destination(TrashRestoreRequestDto? body)
    {
        var containerId = Blank(body?.DestinationId);
        return containerId is null ? null : new TrashRestoreTarget(containerId);
    }

    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
