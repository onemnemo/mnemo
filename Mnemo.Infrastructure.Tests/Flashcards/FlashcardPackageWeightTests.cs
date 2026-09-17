using Mnemo.Core.Enums;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// A package is a zip anyone can edit, and the scheduling profiles it carries go straight into
/// the store. The weight vector is the one field there the engine cannot survive being wrong:
/// a vector of the wrong length throws the moment a session starts, and a slot out of range
/// schedules every deck under the profile on numbers the app's own gate refuses.
/// </summary>
public sealed class FlashcardPackageWeightTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_vector_of_the_wrong_length_is_refused_and_the_profile_imports_on_the_defaults()
    {
        await using var source = await SeededAsync(new[] { 0.4, 1.1, 3.2 });
        var package = await Handler(source, new RecordingLogger()).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var logger = new RecordingLogger();
        await Handler(target, logger).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var preset = await target.Store.ReadAsync((conn, ct) => target.Presets.GetAsync(conn, "preset-fitted", ct));
        Assert.NotNull(preset);
        Assert.Null(preset!.Weights);
        Assert.Equal(60, preset.NewPerDay);
        Assert.Contains(logger.Warnings, w => w.Contains("preset-fitted", StringComparison.Ordinal));
        Assert.Empty(logger.Errors);

        // The deck under it must still be studyable: resolving the profile is what a session start does.
        Assert.Equal(FlashcardFsrsParameters.Default.Weights, FsrsWeightRules.Resolve(preset));
    }

    [Fact]
    public async Task A_slot_outside_its_range_is_refused_and_the_rest_of_the_profile_survives()
    {
        var weights = FsrsWeightRules.Defaults();
        weights[4] = 25d;
        await using var source = await SeededAsync(weights);
        var package = await Handler(source, new RecordingLogger()).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var logger = new RecordingLogger();
        await Handler(target, logger).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var preset = await target.Store.ReadAsync((conn, ct) => target.Presets.GetAsync(conn, "preset-fitted", ct));
        Assert.NotNull(preset);
        Assert.Null(preset!.Weights);
        Assert.Equal(0.95, preset.DesiredRetention);
        Assert.Single(logger.Warnings);
    }

    [Fact]
    public async Task A_fitted_vector_the_gate_accepts_comes_back_slot_for_slot()
    {
        var weights = FsrsWeightRules.Defaults();
        weights[0] = 0.5d;
        weights[20] = 0.3d;
        await using var source = await SeededAsync(weights);
        var package = await Handler(source, new RecordingLogger()).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var logger = new RecordingLogger();
        await Handler(target, logger).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var preset = await target.Store.ReadAsync((conn, ct) => target.Presets.GetAsync(conn, "preset-fitted", ct));
        Assert.NotNull(preset);
        Assert.Equal(weights, preset!.Weights);
        Assert.Empty(logger.Warnings);
    }

    private static async Task<FlashcardStoreHarness> SeededAsync(double[] weights)
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.Store.InitializeAsync();
        await harness.Store.WriteAsync(async (conn, tx, ct) =>
        {
            // Straight through the repository: this is the one write that skips the gate, which
            // is exactly how a package comes to carry a vector the gate would refuse.
            await harness.Presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(Now) with
            {
                Id = "preset-fitted",
                Name = "Fitted",
                NewPerDay = 60,
                DesiredRetention = 0.95,
                Weights = weights,
            }, ct);
            await harness.Decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                "deck-1", null, "preset-fitted", "Pharmacology", null, [], 0, null, null, Now.AddDays(-30), Now.AddDays(-1)), ct);
        });
        return harness;
    }

    private static FlashcardsMnemoPayloadHandler Handler(FlashcardStoreHarness h, ILoggerService logger) => new(
        new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock),
        new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock),
        new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
        h.Store,
        h.Folders,
        h.Decks,
        h.Cards,
        h.Facts,
        h.CardTypes,
        h.Presets,
        h.Schedules,
        h.Reviews,
        h.DailyStats,
        logger,
        FlashcardPackageFixture.NewImagesDirectory());

    private sealed class RecordingLogger : ILoggerService
    {
        public List<string> Warnings { get; } = [];

        public List<string> Errors { get; } = [];

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level == LogLevel.Warning)
                Warnings.Add(message);
            else if (level >= LogLevel.Error)
                Errors.Add($"{message} {exception}");
        }
    }
}
