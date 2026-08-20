using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Wires the flashcards payload handler over a test store, and builds the contexts an export and
/// an import arrive in, so a test says what it is exercising rather than how the handler is built.
/// </summary>
internal static class FlashcardPackageFixture
{
    public static FlashcardsMnemoPayloadHandler Handler(FlashcardStoreHarness h) => new(
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
        new TestLogger());

    /// <summary>An export of the whole collection, as a backup unless the caller says otherwise.</summary>
    public static MnemoPayloadExportContext ExportContext(string kind = MnemoPackageKinds.Backup) =>
        new() { Options = new MnemoPackageExportOptions { Kind = kind } };

    public static MnemoPayloadImportContext ImportContext(
        MnemoPayloadExportData exported,
        ImportConflictPolicy policy = ImportConflictPolicy.KeepBoth,
        int? schemaVersion = null) => new()
    {
        Entry = new MnemoPackageEntry
        {
            PayloadType = "flashcards",
            ItemCount = exported.ItemCount,
            SchemaVersion = schemaVersion ?? exported.SchemaVersion,
            Path = "payloads/flashcards",
        },
        Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
        Files = new Dictionary<string, byte[]>(exported.Files, StringComparer.OrdinalIgnoreCase),
    };
}
