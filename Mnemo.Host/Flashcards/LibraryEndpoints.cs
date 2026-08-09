using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Folder and deck CRUD behind the flashcard library page, plus the due counts and
/// retention trend it renders.
/// </summary>
public static class LibraryEndpoints
{
    public static void MapFlashcardLibrary(this IEndpointRouteBuilder endpoints)
    {
        MapFolders(endpoints);
        MapDecks(endpoints);
        MapStudyCounts(endpoints);
    }

    private static void MapFolders(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/deck-folders", async (IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var folders = await library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
            return folders.Select(FolderDto.FromModel).ToList();
        });

        endpoints.MapPost("/api/deck-folders", async (SaveFolderDto body, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var folder = new FlashcardFolder(Guid.NewGuid().ToString("N"), body.Name, body.ParentId, body.Order);
            await library.SaveFolderAsync(folder, cancellationToken).ConfigureAwait(false);
            return Results.Ok(FolderDto.FromModel(folder));
        });

        endpoints.MapPut("/api/deck-folders/{id}", async (string id, SaveFolderDto body, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var folders = await library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
            if (!folders.Any(f => f.Id == id))
                return Results.NotFound(new ErrorDto("unknown_folder", $"No folder '{id}'."));

            await library.SaveFolderAsync(new FlashcardFolder(id, body.Name, body.ParentId, body.Order), cancellationToken)
                .ConfigureAwait(false);
            return Results.NoContent();
        });

        // Deleting a folder lifts its contents to the root instead of cascading. The
        // desktop app orchestrates that from its view model across several calls; here
        // it is one request so a client that dies mid-delete cannot leave decks
        // pointing at a folder that no longer exists.
        endpoints.MapDelete("/api/deck-folders/{id}", async (string id, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var folders = await library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
            if (!folders.Any(f => f.Id == id))
                return Results.NotFound(new ErrorDto("unknown_folder", $"No folder '{id}'."));

            var nextRootOrder = folders.Where(f => f.ParentId is null).Select(f => f.Order).DefaultIfEmpty(-1).Max() + 1;
            var orphanedFolders = folders
                .Where(f => f.ParentId == id)
                .OrderBy(f => f.Order)
                .ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            for (var i = 0; i < orphanedFolders.Count; i++)
            {
                await library.SaveFolderAsync(
                        orphanedFolders[i] with { ParentId = null, Order = nextRootOrder + i },
                        cancellationToken)
                    .ConfigureAwait(false);
            }

            var decks = await library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
            foreach (var deck in decks.Where(d => d.Header.FolderId == id))
                await library.MoveDeckAsync(deck.Id, null, deck.Header.SortOrder, cancellationToken).ConfigureAwait(false);

            await library.DeleteFolderAsync(id, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    private static void MapDecks(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/decks", async (IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var decks = await library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
            return decks.Select(DeckSummaryDto.FromModel).ToList();
        });

        endpoints.MapPost("/api/decks", async (
            CreateDeckDto body,
            IFlashcardLibraryService library,
            IFlashcardPresetService presets,
            CancellationToken cancellationToken) =>
        {
            var name = body.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return Results.BadRequest(new ErrorDto("invalid_name", "A deck name is required."));

            var presetId = body.PresetId;
            if (string.IsNullOrEmpty(presetId))
                presetId = (await presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false)).Id;

            var header = await library.CreateDeckAsync(name, body.FolderId, presetId, cancellationToken).ConfigureAwait(false);
            var summary = await library.GetDeckAsync(header.Id, cancellationToken).ConfigureAwait(false);
            return summary is null
                ? Results.StatusCode(StatusCodes.Status500InternalServerError)
                : Results.Ok(DeckSummaryDto.FromModel(summary));
        });

        endpoints.MapGet("/api/decks/{id}", async (string id, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var deck = await library.GetDeckAsync(id, cancellationToken).ConfigureAwait(false);
            return deck is null
                ? Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{id}'."))
                : Results.Ok(DeckSummaryDto.FromModel(deck));
        });

        endpoints.MapPut("/api/decks/{id}", async (string id, UpdateDeckDto body, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var deck = await library.GetDeckAsync(id, cancellationToken).ConfigureAwait(false);
            if (deck is null)
                return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{id}'."));

            var name = body.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return Results.BadRequest(new ErrorDto("invalid_name", "A deck name is required."));

            await library.SaveDeckAsync(
                    deck.Header with { Name = name, Description = body.Description, Tags = body.Tags ?? [], Icon = Blank(body.Icon) },
                    cancellationToken)
                .ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapDelete("/api/decks/{id}", async (string id, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var deleted = await library.DeleteDeckAsync(id, cancellationToken).ConfigureAwait(false);
            return deleted
                ? Results.NoContent()
                : Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{id}'."));
        });

        endpoints.MapPost("/api/decks/reorder", async (
            IReadOnlyList<DeckOrderEntryDto> body,
            IFlashcardLibraryService library,
            CancellationToken cancellationToken) =>
        {
            await library.ReorderAsync(body.Select(e => e.ToModel()).ToList(), cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapPost("/api/decks/{id}/move", async (string id, MoveDeckDto body, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var deck = await library.GetDeckAsync(id, cancellationToken).ConfigureAwait(false);
            if (deck is null)
                return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{id}'."));

            await library.MoveDeckAsync(id, body.FolderId, body.SortOrder, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    private static void MapStudyCounts(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/decks/{id}/due", async (string id, IFlashcardStudyService study, CancellationToken cancellationToken) =>
        {
            var counts = await study.GetDueCountsAsync(id, cancellationToken).ConfigureAwait(false);
            return DueCountsDto.FromModel(counts);
        });

        // Backs the library banner, which counts every deck while the table below it
        // only totals the rows a search left visible.
        endpoints.MapGet("/api/study/due", async (IFlashcardStudyService study, CancellationToken cancellationToken) =>
        {
            var counts = await study.GetAggregateDueCountsAsync(cancellationToken).ConfigureAwait(false);
            return DueCountsDto.FromModel(counts);
        });

        endpoints.MapGet("/api/decks/{id}/retention-trend", async (
            string id,
            int? days,
            IFlashcardStatsService stats,
            CancellationToken cancellationToken) =>
        {
            var window = Math.Clamp(days ?? 14, 1, 365);
            var trend = await stats.GetRetentionTrendAsync(id, window, cancellationToken).ConfigureAwait(false);
            return trend.Select(RetentionTrendPointDto.FromModel).ToList();
        });
    }

    /// <summary>Empty and whitespace both mean "not set", so only one of them reaches storage.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
