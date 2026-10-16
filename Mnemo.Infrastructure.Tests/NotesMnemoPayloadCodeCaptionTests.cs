using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

namespace Mnemo.Infrastructure.Tests;

/// <summary>A code block's caption through a notes package: export, then import into another library.</summary>
[Collection(DataRootCollection.Name)]
public sealed class NotesMnemoPayloadCodeCaptionTests
{
    [Fact]
    public async Task ExportThenImport_KeepsTheCaptionAndTheDisplayChoices()
    {
        var source = new NotesMnemoPayloadHandlerTests.InMemoryNoteService();
        var block = new Block
        {
            Id = "b1",
            Type = BlockType.Code,
            Spans = [InlineSpan.Plain("let x = 1;")],
            Payload = new CodePayload("ts", "let x = 1;", Wrap: true, Numbers: true, Caption: "Figure \"one\""),
        };
        await source.SaveNoteAsync(new Note { NoteId = "n1", Title = "With code", Blocks = [block] }).ConfigureAwait(false);
        var exporter = new NotesMnemoPayloadHandler(source, new NotesMnemoPayloadHandlerTests.InMemoryFolderService(), TestImages.Store());

        var exported = await exporter.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() }).ConfigureAwait(false);

        var target = new NotesMnemoPayloadHandlerTests.InMemoryNoteService();
        var importer = new NotesMnemoPayloadHandler(target, new NotesMnemoPayloadHandlerTests.InMemoryFolderService(), TestImages.Store());
        await importer.ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
            Options = new MnemoPackageImportOptions { ConflictPolicy = ImportConflictPolicy.KeepBoth },
            Files = exported.Files.ToDictionary(f => f.Key, f => f.Value),
        }).ConfigureAwait(false);

        var back = await target.GetNoteAsync("n1").ConfigureAwait(false);
        var code = Assert.IsType<CodePayload>(Assert.Single(back!.Blocks!).Payload);
        Assert.Equal(("ts", "let x = 1;", true, true, "Figure \"one\""), (code.Language, code.Source, code.Wrap, code.Numbers, code.Caption));
    }
}
