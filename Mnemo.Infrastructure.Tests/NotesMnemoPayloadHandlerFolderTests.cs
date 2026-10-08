using System.Reflection;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using InMemoryFolderService = Mnemo.Infrastructure.Tests.NotesMnemoPayloadHandlerTests.InMemoryFolderService;
using InMemoryNoteService = Mnemo.Infrastructure.Tests.NotesMnemoPayloadHandlerTests.InMemoryNoteService;

namespace Mnemo.Infrastructure.Tests;

/// <summary>How a notes package carries a folder's shape out, and where an import puts it back.</summary>
[Collection(DataRootCollection.Name)]
public sealed class NotesMnemoPayloadHandlerFolderTests
{
    [Fact]
    public async Task ExportAsync_FolderSubtree_KeepsEmptyAndIntermediateFolders()
    {
        // Notes only in the deepest folder: an export that kept just the folders holding a note
        // would ship "Arm" alone and the import would flatten it to the root.
        var source = await Profile.CreateAsync(
            [Folder("med", "Medicine"), Folder("upper", "Upper", "med"), Folder("arm", "Arm", "upper"),
             Folder("empty", "Empty", "med"), Folder("other", "Other")],
            [Note("n1", "arm"), Note("n2", "other")]);

        var data = await source.Handler.ExportAsync(Selection(["n1"], ["med"]));
        var target = await Profile.CreateAsync([], []);
        await target.Handler.ImportAsync(Context(data, ImportConflictPolicy.KeepBoth));

        var folders = await target.FolderMap();
        Assert.Equal(["arm", "empty", "med", "upper"], folders.Keys.Order(StringComparer.Ordinal));
        Assert.Equal("upper", folders["arm"].ParentId);
        Assert.Equal("med", folders["upper"].ParentId);
        Assert.Equal("med", folders["empty"].ParentId);
        Assert.Equal(["n1"], (await target.Notes.GetAllNotesAsync()).Select(n => n.NoteId));
    }

    [Fact]
    public async Task ExportAsync_NotesOnly_CarriesJustTheFoldersHoldingThem()
    {
        var source = await Profile.CreateAsync(
            [Folder("med", "Medicine"), Folder("arm", "Arm", "med"), Folder("empty", "Empty", "med")],
            [Note("n1", "arm")]);

        var data = await source.Handler.ExportAsync(Selection(["n1"], []));
        var target = await Profile.CreateAsync([], []);
        await target.Handler.ImportAsync(Context(data, ImportConflictPolicy.KeepBoth));

        Assert.Equal(["arm"], (await target.FolderMap()).Keys);
    }

    [Fact]
    public async Task ExportAsync_NoSelection_CarriesEverything()
    {
        var source = await Profile.CreateAsync(
            [Folder("a", "A"), Folder("b", "B", "a"), Folder("empty", "Empty")],
            [Note("n1", "b"), Note("n2")]);

        var data = await source.Handler.ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });
        var target = await Profile.CreateAsync([], []);
        await target.Handler.ImportAsync(Context(data, ImportConflictPolicy.KeepBoth));

        Assert.Equal(["a", "b", "empty"], (await target.FolderMap()).Keys.Order(StringComparer.Ordinal));
        Assert.Equal(2, (await target.Notes.GetAllNotesAsync()).Count());
    }

    [Fact]
    public async Task ExportAsync_RefusesASelectionThatIsNotACollectionOfIds()
    {
        var source = await Profile.CreateAsync([], [Note("n1")]);
        var options = new MnemoPackageExportOptions();
        options.PayloadOptions[MnemoPayloadOptionKeys.NoteIds] = "n1";

        await Assert.ThrowsAsync<ArgumentException>(() =>
            source.Handler.ExportAsync(new MnemoPayloadExportContext { Options = options }));
    }

    [Fact]
    public async Task ImportAsync_IntoAFolder_HangsTheTopLevelUnderIt()
    {
        var profile = await Profile.CreateAsync([Folder("dest", "Destination")], []);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb(
            [Note("loose"), Note("inside", "sub"), Note("child", null, parentNoteId: "inside"), Note("orphan", "gone")],
            [Folder("top", "Top", "somewhere-else"), Folder("sub", "Sub", "top")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.KeepBoth, "dest"));

        var folders = await profile.FolderMap();
        Assert.Equal("dest", folders["top"].ParentId);
        Assert.Equal("top", folders["sub"].ParentId);
        var notes = (await profile.Notes.GetAllNotesAsync()).ToDictionary(n => n.NoteId);
        Assert.Equal("dest", notes["loose"].FolderId);
        Assert.Equal("dest", notes["orphan"].FolderId);
        Assert.Equal("sub", notes["inside"].FolderId);
        // A child page lives inside its parent note, so it is not filed on its own.
        Assert.Null(notes["child"].FolderId);
    }

    [Fact]
    public async Task ImportAsync_KeepBoth_AChildListedBeforeItsParentFollowsTheCopy()
    {
        var profile = await Profile.CreateAsync([Folder("top", "Top"), Folder("sub", "Sub", "top")], []);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb(
            [],
            [Folder("sub", "Sub", "top"), Folder("top", "Top")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.KeepBoth));

        var folders = (await profile.Folders.GetAllFoldersAsync()).ToList();
        Assert.Equal(4, folders.Count);
        var topCopy = folders.Single(f => f.Name == "Top" && f.FolderId != "top");
        var subCopy = folders.Single(f => f.Name == "Sub" && f.FolderId != "sub");
        Assert.Equal(topCopy.FolderId, subCopy.ParentId);
    }

    [Fact]
    public async Task ImportAsync_ReplaceIntoAFolder_MovesNothingThatAlreadyExists()
    {
        // The package is a folder export of "top" being brought back in under "dest". Replace must
        // not pull the live "top" or the live note out of where they are.
        var profile = await Profile.CreateAsync(
            [Folder("home", "Home"), Folder("top", "Top", "home"), Folder("dest", "Destination")],
            [Note("n1", "top", title: "Old")]);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb(
            [Note("n1", "top", title: "New"), Note("fresh", "top")],
            [Folder("top", "Top", "home")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.Replace, "dest"));

        // The existing folder is reused where it stands, so no empty copy appears under the target.
        var folders = await profile.FolderMap();
        Assert.Equal(3, folders.Count);
        Assert.Equal("home", folders["top"].ParentId);
        var note = await profile.Notes.GetNoteAsync("n1");
        Assert.Equal("New", note?.Title);
        Assert.Equal("top", note?.FolderId);
        Assert.Equal("top", (await profile.Notes.GetNoteAsync("fresh"))?.FolderId);
    }

    [Fact]
    public async Task ImportAsync_ReplaceIntoAFolderInsideThePackage_NeverParentsAFolderUnderItself()
    {
        var profile = await Profile.CreateAsync([Folder("top", "Top"), Folder("sub", "Sub", "top")], []);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb(
            [],
            [Folder("top", "Top"), Folder("sub", "Sub", "top")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.Replace, "sub"));

        var folders = await profile.FolderMap();
        Assert.Equal(2, folders.Count);
        Assert.Null(folders["top"].ParentId);
        Assert.Equal("top", folders["sub"].ParentId);
    }

    [Fact]
    public async Task ImportAsync_SkipIntoAFolder_FilesNewNotesInTheExistingFolderWhereItStands()
    {
        var profile = await Profile.CreateAsync(
            [Folder("home", "Home"), Folder("top", "Top", "home"), Folder("dest", "Destination")],
            []);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb([Note("fresh", "top")], [Folder("top", "Top", "home")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.Skip, "dest"));

        Assert.Equal("home", (await profile.Folders.GetFolderAsync("top"))?.ParentId);
        Assert.Equal("top", (await profile.Notes.GetNoteAsync("fresh"))?.FolderId);
    }

    [Fact]
    public async Task ImportAsync_FoldersThatNameEachOtherAsParent_ImportWithoutLooping()
    {
        var profile = await Profile.CreateAsync([], []);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb(
            [],
            [Folder("x", "X", "y"), Folder("y", "Y", "x"), Folder("self", "Self", "self")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.KeepBoth));

        var folders = await profile.FolderMap();
        Assert.Equal(3, folders.Count);
        Assert.Null(folders["self"].ParentId);
        Assert.Single(new[] { folders["x"], folders["y"] }, f => f.ParentId is null);
    }

    [Fact]
    public async Task ImportAsync_HeldFolderIdIntoAFolder_GetsAFreshIdUnderTheTarget()
    {
        var trash = HeldIdsTrash.Holding(folderIds: ["top"]);
        var profile = await Profile.CreateAsync([Folder("dest", "Destination")], [], trash);
        var bytes = NotesMnemoPayloadHandlerTests.BuildNotesDb([Note("n1", "top")], [Folder("top", "Top")]);

        await profile.Handler.ImportAsync(Context(bytes, ImportConflictPolicy.KeepBoth, "dest"));

        var copy = (await profile.Folders.GetAllFoldersAsync()).Single(f => f.Name == "Top");
        Assert.NotEqual("top", copy.FolderId);
        Assert.Equal("dest", copy.ParentId);
        Assert.Equal(copy.FolderId, (await profile.Notes.GetNoteAsync("n1"))?.FolderId);
    }

    private static NoteFolder Folder(string id, string name, string? parentId = null) =>
        new() { FolderId = id, Name = name, ParentId = parentId };

    private static Note Note(string id, string? folderId = null, string? parentNoteId = null, string? title = null) =>
        new() { NoteId = id, Title = title ?? id, FolderId = folderId, ParentNoteId = parentNoteId };

    private static MnemoPayloadExportContext Selection(string[] noteIds, string[] folderIds)
    {
        var options = new MnemoPackageExportOptions();
        options.PayloadOptions[MnemoPayloadOptionKeys.NoteIds] = noteIds;
        options.PayloadOptions[MnemoPayloadOptionKeys.FolderIds] = folderIds;
        return new MnemoPayloadExportContext { Options = options };
    }

    private static MnemoPayloadImportContext Context(MnemoPayloadExportData data, ImportConflictPolicy policy) =>
        Context(data.Files["notes.db"], policy);

    private static MnemoPayloadImportContext Context(byte[] notesDb, ImportConflictPolicy policy, string? targetFolderId = null)
    {
        var options = new MnemoPackageImportOptions { ConflictPolicy = policy };
        if (targetFolderId is not null)
            options.PayloadOptions[MnemoPayloadOptionKeys.TargetFolderId] = targetFolderId;
        return new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "notes", Path = "payloads/notes" },
            Options = options,
            Files = new Dictionary<string, byte[]> { ["notes.db"] = notesDb }
        };
    }

    private sealed record Profile(NotesMnemoPayloadHandler Handler, InMemoryNoteService Notes, InMemoryFolderService Folders)
    {
        public static async Task<Profile> CreateAsync(NoteFolder[] folders, Note[] notes, INoteTrashStore? trash = null)
        {
            var noteService = new InMemoryNoteService();
            var folderService = new InMemoryFolderService();
            foreach (var folder in folders)
                await folderService.SaveFolderAsync(folder);
            foreach (var note in notes)
                await noteService.SaveNoteAsync(note);
            return new Profile(new NotesMnemoPayloadHandler(noteService, folderService, trash), noteService, folderService);
        }

        public async Task<Dictionary<string, NoteFolder>> FolderMap() =>
            (await Folders.GetAllFoldersAsync()).ToDictionary(f => f.FolderId, StringComparer.Ordinal);
    }

    /// <summary>A trash that holds the given ids and answers nothing else; the import only asks which ids are held.</summary>
    public class HeldIdsTrash : DispatchProxy
    {
        private IReadOnlyDictionary<string, string> _folders = new Dictionary<string, string>();

        public static INoteTrashStore Holding(string[] folderIds)
        {
            var proxy = Create<INoteTrashStore, HeldIdsTrash>();
            ((HeldIdsTrash)(object)proxy)._folders = folderIds.ToDictionary(id => id, id => $"entry-{id}", StringComparer.Ordinal);
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => targetMethod?.Name switch
        {
            nameof(INoteTrashStore.HeldFolderIdsAsync) => Task.FromResult(_folders),
            nameof(INoteTrashStore.HeldNoteIdsAsync) => Task.FromResult<IReadOnlyDictionary<string, string>>(new Dictionary<string, string>()),
            _ => throw new NotSupportedException(targetMethod?.Name),
        };
    }
}
