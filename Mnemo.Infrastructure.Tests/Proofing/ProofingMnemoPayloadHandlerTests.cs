using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

public sealed class ProofingMnemoPayloadHandlerTests
{
    [Fact]
    public async Task APackageCarriesTheWordsAndTheChoicesOneNoteMade()
    {
        var (handler, _, _, _) = await SourceAsync().ConfigureAwait(false);

        var exported = await handler.ExportAsync(Export()).ConfigureAwait(false);

        Assert.Equal(4, exported.ItemCount);
        var (target, personal, languages, ignores) = Empty();
        var result = await target.ImportAsync(Import(exported)).ConfigureAwait(false);

        Assert.Equal(4, result.ImportedCount);
        Assert.Equal(
            ["Ordbanken", "piso"],
            (await personal.ListAsync(CancellationToken.None)).Select(w => w.Word).Order(StringComparer.OrdinalIgnoreCase));
        Assert.Equal(
            "es-ES",
            Assert.Single((await languages.GetAsync("note-a", CancellationToken.None))!.Languages));
        Assert.Equal(["myocyte"], await ignores.ListAsync("note-b", CancellationToken.None));
    }

    [Fact]
    public async Task ARestoreMergesRatherThanReplacing()
    {
        var (handler, _, _, _) = await SourceAsync().ConfigureAwait(false);
        var exported = await handler.ExportAsync(Export()).ConfigureAwait(false);

        var (target, personal, _, _) = Empty();
        // Added since the backup was taken. A restore is not licence to take it back.
        await personal.AddAsync("debounce", null, CancellationToken.None);
        await personal.AddAsync("Ordbanken", null, CancellationToken.None);

        var result = await target.ImportAsync(Import(exported)).ConfigureAwait(false);

        Assert.Equal(1, result.DuplicatedCount);
        Assert.Equal(
            ["debounce", "Ordbanken", "piso"],
            (await personal.ListAsync(CancellationToken.None)).Select(w => w.Word).Order(StringComparer.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task APackageWithoutTheFileSaysSoRatherThanThrowing()
    {
        var (handler, _, _, _) = Empty();

        var result = await handler.ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "proofing", Path = "payloads/proofing" },
            Options = new MnemoPackageImportOptions(),
            Files = new Dictionary<string, byte[]>()
        }).ConfigureAwait(false);

        Assert.Equal(0, result.ImportedCount);
        Assert.Single(result.Warnings);
    }

    [Fact]
    public async Task AFileThatSpellsItsListsAsNullReadsAsAFileWithNothingInThem()
    {
        var (handler, personal, _, _) = Empty();

        var result = await handler.ImportAsync(
            Import("""{"personalWords":null,"noteLanguages":null,"noteIgnores":null}""")).ConfigureAwait(false);

        Assert.Equal(0, result.ImportedCount);
        Assert.Equal(0, result.SkippedCount);
        Assert.Empty(result.Warnings);
        Assert.Empty(await personal.ListAsync(CancellationToken.None));
    }

    [Fact]
    public async Task TheWarningCountsOnlyTheWordsThatWereSkipped()
    {
        var (handler, _, _, ignores) = Empty();
        // Full, so the word this package holds for it cannot be stored either. That skip raises the
        // running total, which is what the warning used to report.
        for (var i = 0; i < ignores.MaxWordsPerNote; i++)
            await ignores.AddAsync("note-b", $"term{i}", CancellationToken.None);

        var result = await handler.ImportAsync(Import(
            """
            {
              "personalWords": [{ "word": "Ordbanken" }, { "word": "42" }],
              "noteIgnores": { "note-b": ["myocyte"] }
            }
            """)).ConfigureAwait(false);

        // A run of digits is not something the checker can ever ask about, so of the two words in
        // the file it is the only one skipped.
        Assert.Equal(2, result.SkippedCount);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal("ProofingWordsSkipped", warning.Key);
        Assert.Equal("1", warning.Params["count"]);
    }

    private static async Task<(ProofingMnemoPayloadHandler Handler, PersonalDictionaryService Personal,
        NoteLanguageService Languages, NoteIgnoreService Ignores)> SourceAsync()
    {
        var parts = Empty();
        await parts.Personal.AddAsync("Ordbanken", null, CancellationToken.None);
        await parts.Personal.AddAsync("piso", "es-ES", CancellationToken.None);
        await parts.Languages.SetAsync("note-a", new NoteLanguageEntry("custom", ["es-ES"]), CancellationToken.None);
        await parts.Ignores.AddAsync("note-b", "myocyte", CancellationToken.None);
        return parts;
    }

    private static (ProofingMnemoPayloadHandler Handler, PersonalDictionaryService Personal,
        NoteLanguageService Languages, NoteIgnoreService Ignores) Empty()
    {
        var settings = new MemorySettings();
        var personal = new PersonalDictionaryService(settings);
        var languages = new NoteLanguageService(settings);
        var ignores = new NoteIgnoreService(settings);
        return (new ProofingMnemoPayloadHandler(personal, languages, ignores), personal, languages, ignores);
    }

    private static MnemoPayloadExportContext Export() =>
        new() { Options = new MnemoPackageExportOptions() };

    private static MnemoPayloadImportContext Import(MnemoPayloadExportData exported) => new()
    {
        Entry = new MnemoPackageEntry { PayloadType = "proofing", Path = "payloads/proofing" },
        Options = new MnemoPackageImportOptions(),
        Files = exported.Files.ToDictionary(pair => pair.Key, pair => pair.Value)
    };

    /// <summary>A package holding exactly the file text given, for the shapes an export never writes.</summary>
    private static MnemoPayloadImportContext Import(string json) => new()
    {
        Entry = new MnemoPackageEntry { PayloadType = "proofing", Path = "payloads/proofing" },
        Options = new MnemoPackageImportOptions(),
        Files = new Dictionary<string, byte[]> { ["proofing.json"] = Encoding.UTF8.GetBytes(json) }
    };
}
