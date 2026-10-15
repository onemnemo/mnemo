using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Composition;
using Mnemo.Host.Tests.Lifecycle;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Xunit;
using TemporaryDataRoot = Mnemo.Host.Tests.Flashcards.FlashcardAssetUploadHttpTests.TemporaryDataRoot;

namespace Mnemo.Host.Tests.Assets;

/// <summary>The real sweep over the real modules, so a dropped source or a missed reference shape fails here.</summary>
[Collection(DataRootCollection.Name)]
public sealed class StartupAssetSweepWiringTests
{
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    [Fact]
    public async Task EveryReferenceShapeSurvivesAndOnlyTheOrphanGoesAfterAStartupSweep()
    {
        using var root = new TemporaryDataRoot();
        var modules = HostComposition.DiscoverModules(out var failures);
        Assert.Empty(failures);
        var services = new ServiceCollection();
        HostComposition.AddMnemoBackend(services, modules);
        await using var provider = services.BuildServiceProvider();
        var images = provider.GetRequiredService<SharedImageStore>();
        var flashcards = provider.GetRequiredService<IFlashcardStore>();
        await flashcards.InitializeAsync();

        var noteImage = await SaveOldImageAsync(images, 1);
        var mapImage = await SaveOldImageAsync(images, 2);
        var attachmentImage = await SaveOldImageAsync(images, 3);
        var inlineImage = await SaveOldImageAsync(images, 4);
        var orphan = await SaveOldImageAsync(images, 5);

        var saved = await provider.GetRequiredService<INoteService>().SaveNoteAsync(new Note
        {
            NoteId = Guid.NewGuid().ToString("N"),
            Blocks = [new Block { Type = BlockType.Image, Payload = new ImagePayload(noteImage, "alt", 320, "left") }],
        });
        Assert.True(saved.IsSuccess);

        var maps = provider.GetRequiredService<IMindmapService>();
        var map = (await maps.CreateAsync("M")).Value!;
        var applied = await maps.ApplyAsync(map.Id, map.Revision,
        [
            new AddElementOp
            {
                Kind = ElementKind.Image,
                Content = new CanvasImageContent { AssetId = mapImage },
            },
        ]);
        Assert.True(applied.IsSuccess);

        var deck = await provider.GetRequiredService<IFlashcardLibraryService>().CreateDeckAsync("Deck");
        await InsertCardAsync(flashcards, deck.Id, "Q", Path.Combine(images.Directory, attachmentImage));
        await InsertCardAsync(flashcards, deck.Id, $"Q ![x]({Path.Combine(images.Directory, inlineImage)})", null);

        await provider.GetRequiredService<INoteSidMigrator>().MigrateAsync();
        await provider.GetRequiredService<StartupAssetSweep>().RunAsync();

        Assert.True(File.Exists(Path.Combine(images.Directory, noteImage)));
        Assert.True(File.Exists(Path.Combine(images.Directory, mapImage)));
        Assert.True(File.Exists(Path.Combine(images.Directory, attachmentImage)));
        Assert.True(File.Exists(Path.Combine(images.Directory, inlineImage)));
        Assert.False(File.Exists(Path.Combine(images.Directory, orphan)));
    }

    private static async Task<string> SaveOldImageAsync(SharedImageStore images, byte distinct)
    {
        var name = await images.SaveAsync(new MemoryStream([.. Png, distinct]));
        var path = Path.Combine(images.Directory, name);
        var old = DateTime.UtcNow - TimeSpan.FromDays(2);
        File.SetCreationTimeUtc(path, old);
        File.SetLastWriteTimeUtc(path, old);
        return name;
    }

    private static Task InsertCardAsync(IFlashcardStore store, string deckId, string front, string? attachmentPath)
    {
        var now = DateTimeOffset.UtcNow;
        var card = new Flashcard(
            Id: Guid.NewGuid().ToString("N"), DeckId: deckId, Type: FlashcardType.Classic,
            Front: front, Back: "A", Tags: [], State: FlashcardCardState.Active, IsFlagged: false,
            Attachments: attachmentPath is null ? [] : [new FlashcardAttachment("a1", FlashcardAttachment.FrontSide, attachmentPath, "a.png", 3)],
            CreatedAt: now, UpdatedAt: now);
        return store.WriteAsync((conn, tx, ct) => new CardRepository().InsertAsync(conn, tx, card, ct));
    }
}
