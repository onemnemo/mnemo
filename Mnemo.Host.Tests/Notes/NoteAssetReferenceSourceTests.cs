using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Notes;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using Xunit;

namespace Mnemo.Host.Tests.Notes;

public sealed class NoteAssetReferenceSourceTests
{
    private readonly FakeStorage _storage = new();
    private readonly FakeMigrator _migrator = new();

    private NoteAssetReferenceSource Source() => new(_storage, _migrator);

    private static Block ImageBlock(string path) => new()
    {
        Type = BlockType.Image,
        Payload = new ImagePayload(path, "alt", 320, "left"),
    };

    private void AddNote(string id, params Block[] blocks)
    {
        _storage.Rows[NoteCommitStore.NoteKey(id)] = new Note { NoteId = id, Blocks = [.. blocks] };
        var index = _storage.Rows.TryGetValue(NoteCommitStore.IndexKey, out var existing)
            ? (List<string>)existing!
            : [];
        index.Add(id);
        _storage.Rows[NoteCommitStore.IndexKey] = index;
    }

    private Note Stored(string id) => (Note)_storage.Rows[NoteCommitStore.NoteKey(id)]!;

    [Fact]
    public void ReadyFollowsTheMigrator()
    {
        _migrator.IsComplete = false;
        Assert.False(Source().IsReady);
        _migrator.IsComplete = true;
        Assert.True(Source().IsReady);
    }

    [Fact]
    public async Task CollectsManagedIdsFromImagePayloads()
    {
        AddNote("n1", ImageBlock("aaaa.png"), new Block { Type = BlockType.Text });

        var ids = await Source().CollectReferencedIdsAsync();

        Assert.Contains("aaaa.png", ids);
        Assert.Single(ids);
    }

    [Fact]
    public async Task CollectsFromNestedColumnChildren()
    {
        var column = new Block { Type = BlockType.ColumnGroup, Children = [ImageBlock("nested.png")] };
        AddNote("n1", new Block { Type = BlockType.TwoColumn, Children = [column] });

        var ids = await Source().CollectReferencedIdsAsync();

        Assert.Contains("nested.png", ids);
    }

    [Fact]
    public async Task ReportsAttachmentReferencesAsBareGuids()
    {
        AddNote("n1", ImageBlock("attachment:cafe0123:diagram.png"));

        var ids = await Source().CollectReferencedIdsAsync();

        Assert.Contains("cafe0123", ids);
        Assert.DoesNotContain("attachment:cafe0123:diagram.png", ids);
    }

    [Fact]
    public async Task IgnoresDesktopEraAbsolutePathsAndUrls()
    {
        AddNote("n1",
            ImageBlock(@"C:\Users\someone\AppData\Local\Mnemo\images\block1.png"),
            ImageBlock("https://example.com/x.png"),
            ImageBlock(""));

        var ids = await Source().CollectReferencedIdsAsync();

        Assert.Empty(ids);
    }

    [Fact]
    public async Task CollectsAnUploadedCover()
    {
        // The one reference a note can hold outside its blocks. Miss it and the sweep calls the
        // cover an orphan, deleting it the first time it is past the grace window.
        AddNote("n1");
        Stored("n1").Cover = "asset:cover1.png";

        var ids = await Source().CollectReferencedIdsAsync();

        Assert.Contains("cover1.png", ids);
        Assert.Single(ids);
    }

    [Fact]
    public async Task IgnoresPresetCoversWhichNameNoFile()
    {
        AddNote("n1");
        Stored("n1").Cover = "sunset";

        Assert.Empty(await Source().CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task CollectsFilesNamedInsideAPayloadThisBuildCannotRead()
    {
        // A block written by a newer version keeps its payload verbatim, so the file it names
        // is still in use while being invisible to the walk over known payloads. Missing it
        // deletes the image of a block the user can still see in the version that wrote it.
        AddNote("n1", new Block
        {
            Type = BlockType.Text,
            UnknownPayloadJson = """{"kind":"gallery","frames":[{"path":"gallery1.png"},{"path":"gallery2.png"}]}""",
        });

        var ids = await Source().CollectReferencedIdsAsync();

        Assert.Contains("gallery1.png", ids);
        Assert.Contains("gallery2.png", ids);
    }

    [Fact]
    public async Task IgnoresAnUnreadablePayloadThatNamesNoFile()
    {
        AddNote("n1", new Block
        {
            Type = BlockType.Text,
            UnknownPayloadJson = """{"kind":"timeline","start":1969,"source":"https://example.com/x.png"}""",
        });

        // Only the shapes a stored file can take count, so a URL and a number are not references.
        Assert.DoesNotContain("https://example.com/x.png", await Source().CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task SurvivesAnUnreadablePayloadThatIsNotJson()
    {
        AddNote("n1", ImageBlock("aaaa.png"), new Block { Type = BlockType.Text, UnknownPayloadJson = "{" });

        // Refusing to walk it must not cost the references the rest of the corpus does hold.
        Assert.Contains("aaaa.png", await Source().CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task ToleratesNotesWithoutBlocksAndAMissingIndex()
    {
        // A profile with no notes yet has no index row at all, since the first note save writes
        // it; a profile whose only uploads belong to mind maps is one. That is a real empty
        // corpus, not a read failure, and a sweep that refused it would never clean those uploads.
        Assert.Empty(await Source().CollectReferencedIdsAsync());

        AddNote("n1");
        _storage.Rows[NoteCommitStore.NoteKey("n1")] = new Note { NoteId = "n1", Blocks = null };
        Assert.Empty(await Source().CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task FailsClosedWhenTheIndexCannotBeRead()
    {
        // A sweep keyed off "no references found" must never mistake unreadable for empty:
        // that mistake deletes every stored image in one pass.
        AddNote("n1", ImageBlock("aaaa.png"));
        _storage.FailingKeys.Add(NoteCommitStore.IndexKey);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Source().CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task FailsClosedWhenAnyNoteRowCannotBeRead()
    {
        AddNote("n1", ImageBlock("aaaa.png"));
        AddNote("n2", ImageBlock("bbbb.png"));
        _storage.FailingKeys.Add(NoteCommitStore.NoteKey("n2"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => Source().CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task FailsClosedWhenAnIndexedNoteIsMissing()
    {
        AddNote("n1", ImageBlock("aaaa.png"));
        _storage.Rows.Remove(NoteCommitStore.NoteKey("n1"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => Source().CollectReferencedIdsAsync());
    }

    /// <summary>
    /// Keeps the provider's read contract: an absent key fails with no exception, an unreadable
    /// one fails with the exception attached. The source tells the two apart on exactly that.
    /// </summary>
    [Fact]
    public async Task AnImageSharedByTwoNotesSurvivesTheFirstDeleteAndGoesAfterTheSecondOnceNoSessionIsOpen()
    {
        var directory = Path.Combine(Path.GetTempPath(), "mnemo-shared-sweep", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "shared.png");
            File.WriteAllBytes(path, [1, 2, 3]);
            File.SetCreationTimeUtc(path, DateTime.UtcNow - TimeSpan.FromDays(2));
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow - TimeSpan.FromDays(2));
            AddNote("n1", ImageBlock("shared.png"));
            AddNote("n2", ImageBlock("shared.png"));
            var sessions = new AssetSessionRegistry();
            var sweeper = new AssetSweeper(
                new ManagedAssetStore(() => directory, ManagedAssetStore.ImageExtensions),
                [Source()], sessions, new ImageFileLocks(), new NullLogger());

            RemoveNote("n1");
            await sweeper.SweepAsync();
            Assert.True(File.Exists(path));

            RemoveNote("n2");
            var session = sessions.Open();
            await sweeper.SweepAsync();
            Assert.True(File.Exists(path));

            sessions.Close(session);
            await sweeper.SweepAsync();
            Assert.False(File.Exists(path));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private void RemoveNote(string id)
    {
        _storage.Rows.Remove(NoteCommitStore.NoteKey(id));
        ((List<string>)_storage.Rows[NoteCommitStore.IndexKey]!).Remove(id);
    }

    private sealed class NullLogger : ILoggerService
    {
        public void Log(Mnemo.Core.Enums.LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }

    private sealed class FakeStorage : IStorageProvider
    {
        public Dictionary<string, object?> Rows { get; } = [];
        public HashSet<string> FailingKeys { get; } = [];

        public Task<Result<T?>> LoadAsync<T>(string key)
        {
            if (FailingKeys.Contains(key))
                return Task.FromResult(Result<T?>.Failure("simulated read failure", new IOException("simulated")));
            return Task.FromResult(Rows.TryGetValue(key, out var row)
                ? Result<T?>.Success((T?)row)
                : Result<T?>.Failure("Key not found"));
        }

        public Task<Result> SaveAsync<T>(string key, T data) => throw new NotSupportedException();

        public Task<Result> DeleteAsync(string key) => throw new NotSupportedException();
    }

    private sealed class FakeMigrator : INoteSidMigrator
    {
        public bool IsComplete { get; set; } = true;

        public Task MigrateAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
