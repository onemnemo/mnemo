using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Mnemo.Infrastructure.Services.Mindmap.Trash;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Document lifecycle and the one endpoint every edit goes through.
/// <para>
/// That endpoint is <c>POST /api/mindmaps/{id}/ops</c>. There is no per-field PATCH beside it and there
/// never should be: the op vocabulary is where the structural invariants (forest, no cycles, frame
/// membership) are enforced, and a second write path would be a second place for them to be enforced
/// differently. Renaming a map is the one exception, because a title is document metadata rather than
/// graph structure and the service exposes it as its own revisioned call.
/// </para>
/// </summary>
public static class MindmapEndpoints
{
    private const string DefaultTitle = "Untitled map";
    private const int FindLimit = 50;
    private const string OutlineContentType = "text/markdown; charset=utf-8";

    private static readonly IReadOnlyDictionary<string, string> EmptyIds =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public static void MapMindmaps(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/mindmaps", async (IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var listed = await maps.ListAsync(cancellationToken).ConfigureAwait(false);
            return listed.IsSuccess && listed.Value is not null
                ? MindmapJson.Ok(listed.Value)
                : ServerError(listed.ErrorMessage, "The mindmap library could not be read.");
        });

        endpoints.MapGet("/api/mindmaps/{id}", async (string id, IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var loaded = await maps.GetAsync(id, cancellationToken).ConfigureAwait(false);
            if (!loaded.IsSuccess)
                // A map that is not there reports as a failed read, not as a null value, so without
                // this it comes back a 500 and the client retries a request that cannot ever succeed.
                return IsMissing(loaded.ErrorMessage, id)
                    ? UnknownMap(id)
                    : ServerError(loaded.ErrorMessage, $"Mindmap '{id}' could not be read.");
            return loaded.Value is null ? UnknownMap(id) : MindmapJson.Ok(loaded.Value);
        });

        endpoints.MapPost("/api/mindmaps", async (HttpRequest request, IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var (ok, body, error) = await MindmapJson.ReadAsync<CreateMindmapDto>(request.Body, cancellationToken).ConfigureAwait(false);
            if (!ok)
                return error!;

            var title = Blank(body!.Title) ?? DefaultTitle;

            // A map with no root is not a map: every layout algorithm starts from one, the style
            // cascade has no depth to band without one, and opening a brand new map would show an
            // empty canvas. The desktop's create dialog seeds one too, from its own outline.
            var created = await maps.CreateAsync(
                title,
                outline: new[] { new MindmapNodeSpec { Text = title } },
                layoutAlgorithm: Blank(body.LayoutAlgorithm),
                templateId: Blank(body.TemplateId),
                folderId: Blank(body.FolderId),
                cancellationToken).ConfigureAwait(false);

            return created.IsSuccess && created.Value is not null
                ? MindmapJson.Ok(created.Value)
                : ServerError(created.ErrorMessage, "The mindmap could not be created.");
        });

        endpoints.MapPut("/api/mindmaps/{id}/title", async (string id, HttpRequest request, IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var (ok, body, error) = await MindmapJson.ReadAsync<RenameMindmapDto>(request.Body, cancellationToken).ConfigureAwait(false);
            if (!ok)
                return error!;

            var title = Blank(body!.Title);
            if (title is null)
                return Results.BadRequest(new ErrorDto("invalid_name", "A map title is required."));

            // A rename answers exactly the way an edit batch does, deltas and all, because it is one: the
            // client folds it into the same cache and pushes the same single entry onto the same stack.
            var renamed = await maps.RenameAsync(id, title, cancellationToken).ConfigureAwait(false);
            if (!renamed.IsSuccess || renamed.Value is null)
                return ServerError(renamed.ErrorMessage, $"Mindmap '{id}' could not be renamed.");
            return renamed.Value.Success ? MindmapJson.Ok(Committed(renamed.Value)) : Rejected(renamed.Value);
        });

        endpoints.MapPost("/api/mindmaps/{id}/duplicate", async (string id, HttpRequest request, IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var (ok, body, error) = await MindmapJson.ReadAsync<DuplicateMindmapDto>(request.Body, cancellationToken).ConfigureAwait(false);
            if (!ok)
                return error!;

            var loaded = await maps.GetAsync(id, cancellationToken).ConfigureAwait(false);
            if (loaded.Value is null)
                return UnknownMap(id);

            var title = Blank(body!.Title) ?? $"{loaded.Value.Title} copy";
            var duplicated = await maps.DuplicateAsync(id, title, cancellationToken).ConfigureAwait(false);
            return duplicated.IsSuccess && duplicated.Value is not null
                ? MindmapJson.Ok(duplicated.Value)
                : ServerError(duplicated.ErrorMessage, $"Mindmap '{id}' could not be duplicated.");
        });

        // Deleting a map moves it to the trash, where it stays recoverable for the retention window.
        // The answer carries the batch id the client needs to offer Undo.
        endpoints.MapDelete("/api/mindmaps/{id}", async (string id, ITrashService trash, CancellationToken cancellationToken) =>
        {
            var action = await trash
                .DeleteAsync([new TrashDeleteRequest(MindmapTrashSource.TrashKind, id)], cancellationToken)
                .ConfigureAwait(false);

            return action.Entries.Count == 0
                ? UnknownMap(id)
                : Results.Ok(TrashActionDto.FromModel(action));
        }).RequireTrash();

        endpoints.MapGet("/api/mindmaps/{id}/find", async (string id, string? q, IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var found = await maps.FindInMapAsync(id, q ?? string.Empty, FindLimit, cancellationToken).ConfigureAwait(false);
            if (!found.IsSuccess || found.Value is null)
                return IsMissing(found.ErrorMessage, id)
                    ? UnknownMap(id)
                    : ServerError(found.ErrorMessage, $"Mindmap '{id}' could not be searched.");

            return MindmapJson.Ok(new MindmapFindResultDto(
                found.Value.Revision,
                found.Value.Hits.Select(h => new MindmapFindHitDto(h.ElementId, h.Text, h.Path)).ToList()));
        });

        // The one export that is served rather than drawn. A picture of a map can only be made where
        // the map was measured, which is the browser, but an outline is a projection of the stored
        // document and knows nothing about how wide a label came out, so it is produced here by the
        // same exporter the desktop has always used.
        endpoints.MapGet("/api/mindmaps/{id}/outline", async (string id, IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var loaded = await maps.GetAsync(id, cancellationToken).ConfigureAwait(false);
            if (!loaded.IsSuccess)
                return IsMissing(loaded.ErrorMessage, id)
                    ? UnknownMap(id)
                    : ServerError(loaded.ErrorMessage, $"Mindmap '{id}' could not be read.");
            if (loaded.Value is null)
                return UnknownMap(id);

            var outline = MindmapMarkdownExporter.ExportOutline(loaded.Value);
            return Results.File(Encoding.UTF8.GetBytes(outline), OutlineContentType, OutlineFileName(loaded.Value.Title));
        });

        endpoints.MapPost("/api/mindmaps/{id}/ops", (string id, HttpRequest request, IMindmapService maps, CancellationToken cancellationToken) =>
            ApplyOpsAsync(id, request.Body, maps, cancellationToken));

        endpoints.MapPost("/api/mindmaps/{id}/restore", (string id, HttpRequest request, IMindmapService maps, CancellationToken cancellationToken) =>
            RestoreAsync(id, request.Body, maps, cancellationToken));

        endpoints.MapPost("/api/mindmaps/{id}/arrange", (
                string id,
                HttpRequest request,
                IMindmapService maps,
                IMindmapLayoutService layout,
                CancellationToken cancellationToken) =>
            ArrangeAsync(id, request.Body, maps, layout, cancellationToken));
    }

    /// <summary>
    /// Lays the map out and commits the result as one batch of moves.
    /// <para>
    /// It answers in exactly the shape <c>/ops</c> does, because it IS an edit: the client folds the same
    /// delta into the same cache and pushes the same single entry onto its undo stack. An arrange nobody
    /// liked is one Ctrl+Z, which is the whole reason layout is a thing you ask for here rather than a
    /// thing that happens to you after every keystroke.
    /// </para>
    /// </summary>
    public static async Task<IResult> ArrangeAsync(
        string id,
        Stream requestBody,
        IMindmapService maps,
        IMindmapLayoutService layout,
        CancellationToken cancellationToken = default)
    {
        var (ok, body, error) = await MindmapJson.ReadAsync<ArrangeMindmapDto>(requestBody, cancellationToken).ConfigureAwait(false);
        if (!ok)
            return error!;

        var before = (await maps.GetAsync(id, cancellationToken).ConfigureAwait(false)).Value;
        if (before is null)
            return UnknownMap(id);

        if (before.Revision != body!.ExpectedRevision)
            return MindmapJson.Json(
                new MindmapEditErrorDto(
                    "rev_conflict",
                    $"Revision {body.ExpectedRevision} is stale; the map is at {before.Revision}.",
                    before.Revision, null, null, null),
                StatusCodes.Status409Conflict);

        var sizes = ReadSizes(body.Sizes);
        var moves = await MindmapArrange
            .ComputeAsync(before, sizes, Blank(body.Algorithm), layout, cancellationToken)
            .ConfigureAwait(false);

        // A map already in the shape the layout would give it is not an edit. Answering with the current
        // revision and no deltas leaves the client's document and its undo stack alone.
        if (moves.Count == 0)
            return MindmapJson.Ok(new MindmapOpsResultDto(
                before.Revision, before.Revision, EmptyIds, 0, null, null, OrderOf(before)));

        return await CommitAsync(id, body.ExpectedRevision, moves, maps, cancellationToken).ConfigureAwait(false);
    }

    private static IReadOnlyDictionary<string, MindmapArrangeSize> ReadSizes(
        IReadOnlyDictionary<string, double[]>? sizes)
    {
        var read = new Dictionary<string, MindmapArrangeSize>(StringComparer.Ordinal);
        if (sizes is null)
            return read;

        foreach (var (elementId, pair) in sizes)
        {
            // A malformed pair is dropped rather than refused: a size is an optimization over the stored
            // one, and failing the whole arrange over a bad number would be a worse answer than a
            // slightly crowded branch.
            if (pair is { Length: >= 2 } && double.IsFinite(pair[0]) && double.IsFinite(pair[1]))
                read[elementId] = new MindmapArrangeSize(pair[0], pair[1]);
        }

        return read;
    }

    /// <summary>
    /// Applies one edit batch and hands back what the client needs to stay in step without refetching:
    /// the new revision, the revision it applied against, the ids the batch created, and the two deltas
    /// plus the document order (see <see cref="MindmapOpsResultDto"/> for why order travels with them).
    /// </summary>
    public static async Task<IResult> ApplyOpsAsync(
        string id,
        Stream requestBody,
        IMindmapService maps,
        CancellationToken cancellationToken = default)
    {
        var (ok, body, error) = await MindmapJson.ReadAsync<ApplyMindmapOpsDto>(requestBody, cancellationToken).ConfigureAwait(false);
        if (!ok)
            return error!;

        if (!MindmapToolOpParser.TryParse(body!.Ops, out var ops, out var parseError, out var failedOpIndex))
            return MindmapJson.Json(
                new MindmapEditErrorDto("validation_error", parseError, body.ExpectedRevision,
                    failedOpIndex >= 0 ? failedOpIndex : null, null, null),
                StatusCodes.Status400BadRequest);

        return await CommitAsync(id, body.ExpectedRevision, ops, maps, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Applies an op list and builds the answer both write paths share.
    /// </summary>
    /// <remarks>
    /// Nothing here reads the document either side of the write. The service computes the deltas from the
    /// pre-image and post-image it holds inside the per-map write gate, which is the only place the two
    /// are guaranteed to be consecutive states of the same map; a pair of reads taken out here can have a
    /// commit from another session between them, and the delta built from those describes a document
    /// nobody ever had.
    /// </remarks>
    private static async Task<IResult> CommitAsync(
        string id,
        long expectedRevision,
        IReadOnlyList<MindmapEditOp> ops,
        IMindmapService maps,
        CancellationToken cancellationToken)
    {
        var applied = await maps.ApplyAsync(id, expectedRevision, ops, cancellationToken).ConfigureAwait(false);
        if (!applied.IsSuccess || applied.Value is null)
            return ServerError(applied.ErrorMessage, $"The edit batch for mindmap '{id}' could not be applied.");

        var result = applied.Value;
        return result.Success ? MindmapJson.Ok(Committed(result)) : Rejected(result);
    }

    /// <summary>
    /// Replays a delta from the client's undo stack. The client already holds both directions, so all
    /// this returns is the revision the map landed on, the one it applied against, and its order.
    /// </summary>
    public static async Task<IResult> RestoreAsync(
        string id,
        Stream requestBody,
        IMindmapService maps,
        CancellationToken cancellationToken = default)
    {
        var (ok, body, error) = await MindmapJson.ReadAsync<RestoreMindmapDto>(requestBody, cancellationToken).ConfigureAwait(false);
        if (!ok)
            return error!;

        var restored = await maps.RestoreAsync(id, body!.ExpectedRevision, body.Delta, cancellationToken).ConfigureAwait(false);
        if (!restored.IsSuccess || restored.Value is null)
            return ServerError(restored.ErrorMessage, $"The restore for mindmap '{id}' could not be applied.");

        // A refused restore comes back typed, the same way a refused batch does. The commonest reason is
        // that the map moved on: a delta is a verbatim rewrite of specific ids, so replaying it over
        // someone else's edit would silently revert them with no conflict to notice.
        var result = restored.Value;
        if (!result.Success)
            return Rejected(result);

        return MindmapJson.Ok(new MindmapRestoreResultDto(result.Revision, result.BaseRevision, OrderDto(result.Order)));
    }

    /// <summary>The wire shape of a committed write, straight off the service's result.</summary>
    private static MindmapOpsResultDto Committed(MindmapEditResult result) => new(
        result.Revision,
        result.BaseRevision,
        result.CreatedIds,
        result.DeletedCount,
        result.Undo,
        result.Redo,
        OrderDto(result.Order));

    private static MindmapDocumentOrderDto? OrderDto(MindmapDocumentOrder? order) =>
        order is null ? null : new MindmapDocumentOrderDto(order.Elements, order.Edges);

    private static MindmapDocumentOrderDto OrderOf(MindmapDocument document) =>
        new(document.Elements.Select(e => e.Id).ToList(), document.Edges.Select(e => e.Id).ToList());

    /// <summary>
    /// A batch the service refused. 409 for a revision conflict (the request was well formed, the map
    /// simply moved on and the client rebases on the returned revision), 404 for a missing element,
    /// 400 for everything the batch itself got wrong.
    /// </summary>
    private static IResult Rejected(MindmapEditResult result)
    {
        var err = result.Error!;
        var (code, status) = err.Code switch
        {
            MindmapEditErrorCode.RevConflict => ("rev_conflict", StatusCodes.Status409Conflict),
            MindmapEditErrorCode.NotFound => ("not_found", StatusCodes.Status404NotFound),
            MindmapEditErrorCode.WouldCycle => ("would_cycle", StatusCodes.Status400BadRequest),
            MindmapEditErrorCode.BadContentType => ("bad_content_type", StatusCodes.Status400BadRequest),
            _ => ("validation_error", StatusCodes.Status400BadRequest),
        };

        return MindmapJson.Json(
            new MindmapEditErrorDto(code, err.Message, result.Revision, err.FailedOpIndex, err.ContendedIds, err.Suggestions),
            status);
    }

    private static IResult UnknownMap(string id) =>
        Results.NotFound(new ErrorDto("unknown_mindmap", $"No mindmap '{id}'."));

    private static IResult ServerError(string? detail, string fallback) =>
        Results.Json(new ErrorDto("mindmap_error", detail ?? fallback), statusCode: StatusCodes.Status500InternalServerError);

    /// <summary>
    /// The service reports a missing map as a failed <c>Result</c> with a message rather than a typed
    /// code, so this is the one place that reads it, and it reads conservatively: anything that does not
    /// clearly name this map as not found becomes a 500 rather than a 404.
    /// </summary>
    private static bool IsMissing(string? errorMessage, string id) =>
        errorMessage is not null
        && errorMessage.Contains(id, StringComparison.Ordinal)
        && errorMessage.Contains("not found", StringComparison.OrdinalIgnoreCase);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// What an outline lands under. The title with anything a file system would refuse taken out, which
    /// leaves a name of nothing at all for a map called "?" and is why there is a fallback under it.
    /// </summary>
    private static string OutlineFileName(string? title)
    {
        var name = Blank(title) ?? "mindmap";

        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');

        name = name.Trim().Trim('.');
        return (name.Length == 0 ? "mindmap" : name) + ".md";
    }
}
