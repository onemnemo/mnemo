using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Scheduling presets, and the deck-to-preset binding. Backs the review settings dialog.
/// </summary>
/// <remarks>
/// The preset service validates nothing and its store upserts, so every guard lives here: an
/// unknown id would otherwise be inserted as a new preset rather than refused, and a preset
/// saved with a client-chosen id could overwrite someone else's by collision. Ids are therefore
/// minted server-side and an update has to name a preset that already exists.
/// </remarks>
public static class PresetEndpoints
{
    // The bounds the settings dialog offers. Nothing downstream enforces them, and a preset is
    // shared, so a bad value would quietly reshape scheduling for every deck bound to it.
    private const int MaxNewPerDay = 999;
    private const int MaxReviewsPerDay = 9999;
    private const double MinRetention = 0.80;
    private const double MaxRetention = 0.97;
    private const int MaxLearningSteps = 5;

    /// <summary>
    /// The most lapses a card may be allowed before it is called a leech. Mirrors the domain's own
    /// clamp, so a value past it is refused here rather than silently pulled back on save.
    /// </summary>
    private const int MaxLeechThreshold = FlashcardPreset.MaxLeechThreshold;

    /// <summary>
    /// A year, in minutes. A learning step is a short intra-session interval, and the scheduler
    /// adds it straight to the due date without complaint - a step of a billion minutes parks the
    /// card several thousand years out, where nothing errors and the card simply stops appearing.
    /// </summary>
    private const int MaxStepMinutes = 525_600;

    public static void MapFlashcardPresets(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/presets", ListAsync);
        endpoints.MapPost("/api/presets", CreateAsync);
        endpoints.MapPut("/api/presets/{presetId}", UpdateAsync);
        endpoints.MapDelete("/api/presets/{presetId}", DeleteAsync);
        endpoints.MapPost("/api/presets/{presetId}/optimize", OptimizeAsync);
        endpoints.MapPut("/api/presets/{presetId}/weights", SaveWeightsAsync);
        endpoints.MapPost("/api/decks/{deckId}/preset", AssignAsync);
    }

    /// <summary>
    /// Every preset with the number of decks bound to it.
    /// </summary>
    /// <remarks>
    /// Seeds Standard first so the dialog always opens onto something. A profile that has never
    /// created a deck has no presets at all, and an empty sidebar would read as a failure.
    /// </remarks>
    private static async Task<IResult> ListAsync(
        IFlashcardPresetService presets,
        CancellationToken cancellationToken)
    {
        await presets.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);
        var all = await presets.ListPresetsAsync(cancellationToken).ConfigureAwait(false);

        var dtos = new List<PresetDto>(all.Count);
        foreach (var preset in all)
        {
            var count = await presets.CountDecksUsingAsync(preset.Id, cancellationToken).ConfigureAwait(false);
            dtos.Add(PresetDto.FromModel(preset, count));
        }

        return Results.Ok(dtos);
    }

    private static async Task<IResult> CreateAsync(
        SavePresetDto body,
        IFlashcardPresetService presets,
        FlashcardClock clock,
        CancellationToken cancellationToken)
    {
        if (Validate(body, out var name, out var autoReveal, out var leechAction, out var error))
            return error;

        // Seeded from Standard so the fields with no editor - relearn steps, weights, algorithm -
        // start somewhere sane rather than at the enum's zero, which is not a valid algorithm.
        var standard = FlashcardPreset.CreateStandard(clock.Now);
        var created = await presets.SavePresetAsync(
            standard with
            {
                Id = Guid.NewGuid().ToString("N"),
                Name = name,
                NewPerDay = body.NewPerDay,
                MaxReviewsPerDay = body.MaxReviewsPerDay,
                DesiredRetention = body.DesiredRetention,
                LearningSteps = body.LearningSteps,
                ShuffleOrder = body.ShuffleOrder,
                BuryRelated = body.BuryRelated,
                AutoReveal = autoReveal,
                NextDayStartsAtHour = body.NextDayStartsAtHour ?? standard.NextDayStartsAtHour,
                LeechThreshold = body.LeechThreshold ?? standard.LeechThreshold,
                LeechAction = leechAction ?? standard.LeechAction,
                CreatedAt = default,
            },
            cancellationToken).ConfigureAwait(false);

        return Results.Ok(PresetDto.FromModel(created, deckCount: 0));
    }

    private static async Task<IResult> UpdateAsync(
        string presetId,
        SavePresetDto body,
        IFlashcardPresetService presets,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(presetId))
            return Results.BadRequest(new ErrorDto("preset_required", "A preset must be named."));

        if (Validate(body, out var name, out var autoReveal, out var leechAction, out var error))
            return error;

        var stored = await presets.GetPresetAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (stored is null)
            return Results.NotFound(new ErrorDto("unknown_preset", $"No preset '{presetId}'."));

        // Updating the stored record rather than building a fresh one keeps the fields this DTO
        // does not carry - relearn steps, weights, the creation stamp - instead of blanking them.
        var saved = await presets.SavePresetAsync(
            stored with
            {
                Name = name,
                NewPerDay = body.NewPerDay,
                MaxReviewsPerDay = body.MaxReviewsPerDay,
                DesiredRetention = body.DesiredRetention,
                LearningSteps = body.LearningSteps,
                ShuffleOrder = body.ShuffleOrder,
                BuryRelated = body.BuryRelated,
                AutoReveal = autoReveal,
                NextDayStartsAtHour = body.NextDayStartsAtHour ?? stored.NextDayStartsAtHour,
                LeechThreshold = body.LeechThreshold ?? stored.LeechThreshold,
                LeechAction = leechAction ?? stored.LeechAction,
            },
            cancellationToken).ConfigureAwait(false);

        var count = await presets.CountDecksUsingAsync(presetId, cancellationToken).ConfigureAwait(false);
        return Results.Ok(PresetDto.FromModel(saved, count));
    }

    /// <summary>
    /// Deletes a preset that nothing uses.
    /// </summary>
    /// <remarks>
    /// The service returns false both for "in use" and for "no such preset", so the two cases are
    /// separated here to give the dialog something it can act on. Standard is refused outright:
    /// the service would happily delete it once its last deck moved away, and it would then be
    /// re-seeded under the same id the next time anything asked for it.
    /// </remarks>
    private static async Task<IResult> DeleteAsync(
        string presetId,
        IFlashcardPresetService presets,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(presetId))
            return Results.BadRequest(new ErrorDto("preset_required", "A preset must be named."));

        if (string.Equals(presetId, FlashcardPreset.StandardPresetId, StringComparison.Ordinal))
            return Results.Json(
                new ErrorDto("preset_protected", "The Standard preset cannot be deleted."),
                statusCode: StatusCodes.Status409Conflict);

        var stored = await presets.GetPresetAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (stored is null)
            return Results.NotFound(new ErrorDto("unknown_preset", $"No preset '{presetId}'."));

        var count = await presets.CountDecksUsingAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (count > 0)
            return Results.Json(
                new ErrorDto("preset_in_use", "This preset is still used by one or more decks."),
                statusCode: StatusCodes.Status409Conflict);

        // The service re-counts before deleting, so it can still refuse after the check above -
        // a deck bound to this preset in between would otherwise be reported as a success.
        var deleted = await presets.DeletePresetAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (!deleted)
            return Results.Json(
                new ErrorDto("preset_in_use", "This preset is still used by one or more decks."),
                statusCode: StatusCodes.Status409Conflict);

        return Results.NoContent();
    }

    /// <summary>
    /// Fits FSRS weights to the review history of every deck bound to this preset.
    /// </summary>
    /// <remarks>
    /// Stores nothing. The fit is CPU bound and runs for seconds on a large collection, so the
    /// client is expected to show it working and the request token is what stops it.
    /// </remarks>
    private static async Task<IResult> OptimizeAsync(
        string presetId,
        IFlashcardOptimizerService optimizer,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(presetId))
            return Results.BadRequest(new ErrorDto("preset_required", "A preset must be named."));

        var result = await optimizer.OptimizePresetAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (result is null)
            return Results.NotFound(new ErrorDto("unknown_preset", $"No preset '{presetId}'."));

        return Results.Ok(OptimizeWeightsDto.FromModel(result));
    }

    /// <summary>
    /// Puts a preset onto a weight vector, or back onto the published defaults when none is sent.
    /// </summary>
    /// <remarks>
    /// The vector is checked here so a refusal reads as a bad request rather than as a failure. The
    /// preset service checks it again on the way to the store, because this is not the only caller.
    /// </remarks>
    private static async Task<IResult> SaveWeightsAsync(
        string presetId,
        SaveWeightsDto body,
        IFlashcardPresetService presets,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(presetId))
            return Results.BadRequest(new ErrorDto("preset_required", "A preset must be named."));

        if (!FsrsWeightRules.TryValidate(body.Weights, out var weightError))
            return Results.BadRequest(new ErrorDto("invalid_weights", weightError!));

        var stored = await presets.GetPresetAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (stored is null)
            return Results.NotFound(new ErrorDto("unknown_preset", $"No preset '{presetId}'."));

        var saved = await presets.SavePresetAsync(
            stored with { Weights = body.Weights }, cancellationToken).ConfigureAwait(false);

        var count = await presets.CountDecksUsingAsync(presetId, cancellationToken).ConfigureAwait(false);
        return Results.Ok(PresetDto.FromModel(saved, count));
    }

    /// <summary>
    /// Binds a deck to a preset.
    /// </summary>
    /// <remarks>
    /// Both ids are checked first. An unknown deck is a silent no-op down in the repository, and
    /// an unknown preset trips the foreign key and surfaces as an opaque 500 - neither tells the
    /// dialog anything.
    /// </remarks>
    private static async Task<IResult> AssignAsync(
        string deckId,
        AssignPresetDto body,
        IFlashcardLibraryService library,
        IFlashcardPresetService presets,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deckId))
            return Results.BadRequest(new ErrorDto("deck_required", "A preset binding must name a deck."));

        if (string.IsNullOrWhiteSpace(body.PresetId))
            return Results.BadRequest(new ErrorDto("preset_required", "A preset binding must name a preset."));

        var deck = await library.GetDeckAsync(deckId, cancellationToken).ConfigureAwait(false);
        if (deck is null)
            return Results.NotFound(new ErrorDto("unknown_deck", $"No deck '{deckId}'."));

        var preset = await presets.GetPresetAsync(body.PresetId, cancellationToken).ConfigureAwait(false);
        if (preset is null)
            return Results.NotFound(new ErrorDto("unknown_preset", $"No preset '{body.PresetId}'."));

        await presets.AssignDeckPresetAsync(deckId, body.PresetId, cancellationToken).ConfigureAwait(false);
        return Results.NoContent();
    }

    /// <summary>
    /// Checks a submitted preset. Returns true when the request should be refused, in which case
    /// <paramref name="error"/> carries the response.
    /// </summary>
    private static bool Validate(
        SavePresetDto body,
        out string name,
        out FlashcardAutoReveal autoReveal,
        out FlashcardLeechAction? leechAction,
        out IResult error)
    {
        autoReveal = FlashcardAutoReveal.Off;
        leechAction = null;
        name = body.Name?.Trim() ?? string.Empty;

        if (name.Length == 0)
        {
            error = Results.BadRequest(new ErrorDto("invalid_name", "A preset name is required."));
            return true;
        }

        if (body.NewPerDay < 0 || body.NewPerDay > MaxNewPerDay)
        {
            error = Results.BadRequest(new ErrorDto("invalid_limit", $"New cards per day must be between 0 and {MaxNewPerDay}."));
            return true;
        }

        if (body.MaxReviewsPerDay < 0 || body.MaxReviewsPerDay > MaxReviewsPerDay)
        {
            error = Results.BadRequest(new ErrorDto("invalid_limit", $"Maximum reviews per day must be between 0 and {MaxReviewsPerDay}."));
            return true;
        }

        if (double.IsNaN(body.DesiredRetention) || body.DesiredRetention < MinRetention || body.DesiredRetention > MaxRetention)
        {
            error = Results.BadRequest(new ErrorDto("invalid_retention", $"Desired retention must be between {MinRetention:P0} and {MaxRetention:P0}."));
            return true;
        }

        var steps = body.LearningSteps;
        if (steps is null || steps.Count == 0 || steps.Count > MaxLearningSteps
            || steps.Any(s => s <= 0 || s > MaxStepMinutes))
        {
            error = Results.BadRequest(new ErrorDto("invalid_steps", $"Learning steps must be 1 to {MaxLearningSteps} minute counts between 1 and {MaxStepMinutes}."));
            return true;
        }

        if (!FlashcardWire.TryParseAutoReveal(body.AutoReveal, out autoReveal))
        {
            error = Results.BadRequest(new ErrorDto("invalid_auto_reveal", $"Unknown auto-reveal '{body.AutoReveal}'."));
            return true;
        }

        if (body.NextDayStartsAtHour is { } hour && (hour < 0 || hour > 23))
        {
            error = Results.BadRequest(new ErrorDto("invalid_day_start", "The next day must start at an hour between 0 and 23."));
            return true;
        }

        if (body.LeechThreshold is { } lapses && (lapses < 1 || lapses > MaxLeechThreshold))
        {
            error = Results.BadRequest(new ErrorDto("invalid_leech_threshold", $"The lapse limit must be between 1 and {MaxLeechThreshold}."));
            return true;
        }

        if (body.LeechAction is not null)
        {
            if (!FlashcardWire.TryParseLeechAction(body.LeechAction, out var parsed))
            {
                error = Results.BadRequest(new ErrorDto("invalid_leech_action", $"Unknown leech action '{body.LeechAction}'."));
                return true;
            }
            leechAction = parsed;
        }

        error = Results.Empty;
        return false;
    }
}
