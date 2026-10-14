using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Flashcards;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Tests.Lifecycle;
using TemporaryDataRoot = Mnemo.Host.Tests.Flashcards.FlashcardAssetUploadHttpTests.TemporaryDataRoot;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

[Collection(DataRootCollection.Name)]
public sealed class FlashcardAssetCleanupOwnerTests
{
    [Fact]
    public async Task ALegacyFileAnotherCardStillNamesIsKept()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        var path = OldFile(MnemoAppPaths.GetImagesDirectory());
        await InsertCardAsync(h, path);

        var outcome = await Owner(h).DeleteIfUnreferencedAsync(path);

        Assert.Equal(AssetCleanupOutcome.StillReferenced, outcome);
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task AnOldLegacyFileNothingNamesIsDeleted()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        var path = OldFile(MnemoAppPaths.GetImagesDirectory());

        Assert.Equal(AssetCleanupOutcome.Deleted, await Owner(h).DeleteIfUnreferencedAsync(path));
        Assert.False(File.Exists(path));
    }

    [Fact]
    public async Task AYoungLegacyFileIsDeferred()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        var path = OldFile(MnemoAppPaths.GetImagesDirectory());
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow);

        Assert.Equal(AssetCleanupOutcome.Deferred, await Owner(h).DeleteIfUnreferencedAsync(path));
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task ALegacyFileAlreadyGoneIsMissing()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        var path = Path.Combine(MnemoAppPaths.GetImagesDirectory(), "gone.png");

        Assert.Equal(AssetCleanupOutcome.Missing, await Owner(h).DeleteIfUnreferencedAsync(path));
    }

    [Fact]
    public async Task ASharedFileIsLeftToTheSweep()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        var path = OldFile(MnemoAppPaths.GetImageAssetsDirectory());

        Assert.Equal(AssetCleanupOutcome.Missing, await Owner(h).DeleteIfUnreferencedAsync(path));
        Assert.True(File.Exists(path));
    }

    [Fact]
    public async Task ItWaitsWhileAnotherInstanceRuns()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        var locks = Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "test-locks");
        using var mine = HostInstanceLock.Acquire(locks);
        using var other = HostInstanceLock.Acquire(locks);

        Assert.False(new FlashcardAssetCleanupOwner(h.Store, new ImageFileLocks(), mine).IsReady);
    }

    [Fact]
    public async Task TheSweepSourceReportsFileNamesWhateverDirectoryARowNames()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await InsertCardAsync(h, Path.Combine("D:", "moved-profile", "image-assets", "abc.png"));

        var ids = await new FlashcardAssetReferenceSource(h.Store).CollectReferencedIdsAsync();

        Assert.Contains("abc.png", ids);
    }

    private static FlashcardAssetCleanupOwner Owner(FlashcardHttpHarness h) =>
        new(h.Store, new ImageFileLocks(), HostInstanceLock.Acquire(Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "test-locks", Guid.NewGuid().ToString("N"))));

    private static string OldFile(string directory)
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".png");
        File.WriteAllBytes(path, [1, 2, 3]);
        var old = DateTime.UtcNow - TimeSpan.FromDays(2);
        File.SetCreationTimeUtc(path, old);
        File.SetLastWriteTimeUtc(path, old);
        return path;
    }

    private static async Task InsertCardAsync(FlashcardHttpHarness h, string path)
    {
        await h.StartAsync();
        var deck = await h.Client.PostAsync("/api/decks", new StringContent(
            "{\"name\":\"Deck\"}", System.Text.Encoding.UTF8, "application/json"));
        var deckId = System.Text.Json.JsonDocument.Parse(await deck.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetString()!;
        var now = DateTimeOffset.UtcNow;
        var card = new Flashcard(
            Id: Guid.NewGuid().ToString("N"), DeckId: deckId, Type: FlashcardType.Classic,
            Front: "Q", Back: "A", Tags: [], State: FlashcardCardState.Active, IsFlagged: false,
            Attachments: [new FlashcardAttachment("a1", FlashcardAttachment.FrontSide, path, "a.png", 3)],
            CreatedAt: now, UpdatedAt: now);
        await h.Store.WriteAsync((conn, tx, ct) => new CardRepository().InsertAsync(conn, tx, card, ct));
    }
}
