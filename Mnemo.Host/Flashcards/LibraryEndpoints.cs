using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Flashcards.Trash;

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
            var name = body.Name?.Trim() ?? string.Empty;
            if (FlashcardTextValidation.TooLong(name, FlashcardTextLimits.MaxNameLength, "invalid_name", "A folder name", out var error))
                return error;

            var folder = new FlashcardFolder(Guid.NewGuid().ToString("N"), name, body.ParentId, body.Order);
            await library.SaveFolderAsync(folder, cancellationToken).ConfigureAwait(false);
            return Results.Ok(FolderDto.FromModel(folder));
        });

        endpoints.MapPut("/api/deck-folders/{id}", async (string id, SaveFolderDto body, IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var folders = await library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
            if (!folders.Any(f => f.Id == id))
                return Results.NotFound(new ErrorDto("unknown_folder", $"No folder '{id}'."));

            var name = body.Name?.Trim() ?? string.Empty;
            if (FlashcardTextValidation.TooLong(name, FlashcardTextLimits.MaxNameLength, "invalid_name", "A folder name", out var error))
                return error;

            await library.SaveFolderAsync(new FlashcardFolder(id, name, body.ParentId, body.Order), cancellationToken)
                .ConfigureAwait(false);
            return Results.NoContent();
        });

        // Deleting a folder takes the decks and subfolders inside it, all under one entry, so Undo
        // puts the arrangement back rather than leaving its contents scattered at the root. Nothing
        // is destroyed: the whole subtree stays recoverable for thirty days.
        endpoints.MapDelete("/api/deck-folders/{id}", async (
            string id,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var action = await trash
                .DeleteAsync([new TrashDeleteRequest(FlashcardDeckFolderTrashSource.TrashKind, id)], cancellationToken)
                .ConfigureAwait(false);

            return action.Entries.Count == 0
                ? Results.NotFound(new ErrorDto("unknown_folder", $"No folder '{id}'."))
                : Results.Ok(TrashActionDto.FromModel(action));
        }).RequireTrash();
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
            if (FlashcardTextValidation.TooLong(name, FlashcardTextLimits.MaxNameLength, "invalid_name", "A deck name", out var nameError))
                return nameError;

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
            if (FlashcardTextValidation.TooLong(name, FlashcardTextLimits.MaxNameLength, "invalid_name", "A deck name", out var nameError))
                return nameError;

            var description = body.Description;
            if (description is not null
                && FlashcardTextValidation.TooLong(description, FlashcardTextLimits.MaxDescriptionLength, "invalid_description", "A deck description", out var descriptionError))
                return descriptionError;

            await library.SaveDeckAsync(
                    deck.Header with
                    {
                        Name = name,
                        Description = description,
                        Tags = FlashcardTextValidation.NormalizeTags(body.Tags),
                        Icon = Blank(body.Icon),
                    },
                    cancellationToken)
                .ConfigureAwait(false);
            return Results.NoContent();
        });

        // A deleted deck keeps its cards, their schedules and their review history for thirty days,
        // so restoring it puts somebody back exactly where they were rather than starting the deck
        // over. Material filed here whose cards all live in this deck goes with it; material with a
        // card somewhere else stays, refiled under the deck that card is in.
        endpoints.MapDelete("/api/decks/{id}", async (
            string id,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var action = await trash
                .DeleteAsync([new TrashDeleteRequest(FlashcardDeckTrashSource.TrashKind, id)], cancellationToken)
                .ConfigureAwait(false);

            return action.Entries.Count == 0
                ? Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{id}'."))
                : Results.Ok(TrashActionDto.FromModel(action));
        }).RequireTrash();

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
        // Backs the library banner, which counts every deck while the table below it
        // only totals the rows a search left visible.
        endpoints.MapGet("/api/study/due", async (IFlashcardStudyService study, CancellationToken cancellationToken) =>
        {
            var counts = await study.GetAggregateDueCountsAsync(cancellationToken).ConfigureAwait(false);
            return DueCountsDto.FromModel(counts);
        });

        // Backs the overview's review-forecast widget. Library-wide rather than per deck: the board
        // is asking what the next fortnight looks like, not what one deck's next fortnight looks
        // like, and a fan-out would issue one request per deck to answer a single chart.
        endpoints.MapGet("/api/study/forecast", async (
            int? days,
            IFlashcardStudyService study,
            CancellationToken cancellationToken) =>
        {
            var forecast = await study.GetReviewForecastAsync(days ?? 7, cancellationToken).ConfigureAwait(false);
            return forecast.Select(ForecastDayDto.FromModel).ToList();
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
