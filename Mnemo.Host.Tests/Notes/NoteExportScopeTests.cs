using Mnemo.Core.Models;
using Mnemo.Host.Notes;

namespace Mnemo.Host.Tests.Notes;

public sealed class NoteExportScopeTests
{
    private static readonly NoteFolder[] Folders =
    [
        new() { FolderId = "med", Name = "Medicine" },
        new() { FolderId = "arm", Name = "Arm", ParentId = "med" },
        new() { FolderId = "other", Name = "Other" },
    ];

    [Fact]
    public void Expand_AFolder_TakesEveryNoteUnderItAndNothingElse()
    {
        var notes = new[] { Summary("a", "med"), Summary("b", "arm"), Summary("c", "other"), Summary("d") };

        var ids = NoteExportScope.Expand(notes, Folders, [], ["med"]);

        Assert.Equal(["a", "b"], ids.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Expand_TakesChildPagesAtAnyDepth_WhereverTheyAreFiled()
    {
        var notes = new[]
        {
            Summary("parent", "other"),
            Summary("child", parentNoteId: "parent"),
            Summary("grandchild", "med", parentNoteId: "child"),
        };

        var ids = NoteExportScope.Expand(notes, Folders, ["parent"], []);

        Assert.Equal(["parent", "child", "grandchild"], ids);
    }

    [Fact]
    public void Expand_DropsUnknownIds_AndNeverRepeatsANote()
    {
        var notes = new[] { Summary("a", "med") };

        var ids = NoteExportScope.Expand(notes, Folders, ["a", "missing"], ["med", "no-such-folder"]);

        Assert.Equal(["a"], ids);
    }

    [Fact]
    public void Expand_SurvivesNotesAndFoldersThatLoop()
    {
        NoteFolder[] looped =
        [
            new() { FolderId = "x", Name = "X", ParentId = "y" },
            new() { FolderId = "y", Name = "Y", ParentId = "x" },
        ];
        var notes = new[] { Summary("p", "x", parentNoteId: "q"), Summary("q", parentNoteId: "p") };

        var ids = NoteExportScope.Expand(notes, looped, [], ["x"]);

        Assert.Equal(["p", "q"], ids);
    }

    private static NoteSummary Summary(string id, string? folderId = null, string? parentNoteId = null) =>
        new(id, id, 1, id, folderId, parentNoteId, 0, false, DateTime.UnixEpoch, DateTime.UnixEpoch, null, null, null, []);
}
