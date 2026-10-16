using System.Text.Json;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

namespace Mnemo.Infrastructure.Tests;

/// <summary>A layout built by dragging a block onto another's edge survives a .mnemo round trip.</summary>
[Collection(DataRootCollection.Name)]
public sealed class NotesMnemoSplitLayoutTests
{
    // Written by the web editor's mapper after dragging "dragged" onto the left edge of "target".
    private const string DragMadeBlocks = """
        [{"id":"1923f5fb-b087-4495-aa86-3c3522353e69","type":"TwoColumn","spans":[{"kind":"text","text":"","style":{"bold":false,"italic":false,"underline":false,"strikethrough":false,"code":false,"highlight":false,"suppressAutoLink":false}}],"payload":{"kind":"twoColumn","splitRatio":0.5},"meta":{},"order":0,"sid":"g4a35","children":[{"id":"d79d78ac-ca74-4910-a7c9-d418d958976e","type":"ColumnGroup","spans":[{"kind":"text","text":"","style":{"bold":false,"italic":false,"underline":false,"strikethrough":false,"code":false,"highlight":false,"suppressAutoLink":false}}],"payload":{"kind":"empty"},"meta":{},"order":0,"sid":"br5kq","children":[{"id":"id-1","type":"Text","spans":[{"kind":"text","text":"dragged","style":{"bold":false,"italic":false,"underline":false,"strikethrough":false,"code":false,"highlight":false,"suppressAutoLink":false}}],"payload":{"kind":"empty"},"meta":{},"order":0,"sid":"s0001"}]},{"id":"f315813b-f16a-4b3e-a739-ef8efa8583af","type":"ColumnGroup","spans":[{"kind":"text","text":"","style":{"bold":false,"italic":false,"underline":false,"strikethrough":false,"code":false,"highlight":false,"suppressAutoLink":false}}],"payload":{"kind":"empty"},"meta":{},"order":1,"sid":"ww7bx","children":[{"id":"id-2","type":"Text","spans":[{"kind":"text","text":"target","style":{"bold":false,"italic":false,"underline":false,"strikethrough":false,"code":false,"highlight":false,"suppressAutoLink":false}}],"payload":{"kind":"empty"},"meta":{},"order":0,"sid":"s0002"}]}]},{"id":"id-3","type":"Text","spans":[{"kind":"text","text":"tail","style":{"bold":false,"italic":false,"underline":false,"strikethrough":false,"code":false,"highlight":false,"suppressAutoLink":false}}],"payload":{"kind":"empty"},"meta":{},"order":1,"sid":"s0003"}]
        """;

    [Fact]
    public async Task DragMadeLayout_SurvivesPackageExportAndImport()
    {
        var blocks = JsonSerializer.Deserialize<List<Block>>(DragMadeBlocks)!;
        var note = new Note { NoteId = "n1", Title = "Split", Blocks = blocks };
        var source = new NotesMnemoPayloadHandlerTests.InMemoryNoteService();
        await source.SaveNoteAsync(note).ConfigureAwait(false);
        var exporter = new NotesMnemoPayloadHandler(source, new NotesMnemoPayloadHandlerTests.InMemoryFolderService(), TestImages.Store());

        var data = await exporter.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() }).ConfigureAwait(false);

        var target = new NotesMnemoPayloadHandlerTests.InMemoryNoteService();
        var importer = new NotesMnemoPayloadHandler(target, new NotesMnemoPayloadHandlerTests.InMemoryFolderService(), TestImages.Store());
        await importer.ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
            Options = new MnemoPackageImportOptions { ConflictPolicy = ImportConflictPolicy.Replace },
            Files = new Dictionary<string, byte[]>(data.Files),
        }).ConfigureAwait(false);

        var imported = await target.GetNoteAsync("n1").ConfigureAwait(false);
        Assert.NotNull(imported);
        Assert.Equal(JsonSerializer.Serialize(blocks), JsonSerializer.Serialize(imported!.Blocks));
        var layout = imported.Blocks[0];
        Assert.Equal(BlockType.TwoColumn, layout.Type);
        Assert.Equal(0.5, ((TwoColumnPayload)layout.Payload).SplitRatio);
        Assert.Equal(["s0001"], layout.Children![0].Children!.Select(b => b.Sid));
        Assert.Equal(["s0002"], layout.Children![1].Children!.Select(b => b.Sid));
        Assert.Equal("s0003", imported.Blocks[1].Sid);
    }
}
