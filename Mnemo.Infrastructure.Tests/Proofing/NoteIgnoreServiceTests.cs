using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

public sealed class NoteIgnoreServiceTests
{
    [Fact]
    public async Task WordsAreKeptPerNote()
    {
        var service = new NoteIgnoreService(new MemorySettings());

        await service.AddAsync("note-a", "Ordbanken", CancellationToken.None);
        await service.AddAsync("note-b", "myocyte", CancellationToken.None);

        Assert.Equal(["Ordbanken"], await service.ListAsync("note-a", CancellationToken.None));
        Assert.Equal(["myocyte"], await service.ListAsync("note-b", CancellationToken.None));
        Assert.Empty(await service.ListAsync("note-c", CancellationToken.None));
    }

    [Fact]
    public async Task AddingTheSameWordAgainIgnoringCaseChangesNothing()
    {
        var service = new NoteIgnoreService(new MemorySettings());

        Assert.True(await service.AddAsync("note", "Ordbanken", CancellationToken.None));
        Assert.True(await service.AddAsync("note", "ordbanken", CancellationToken.None));

        Assert.Single(await service.ListAsync("note", CancellationToken.None));
    }

    [Fact]
    public async Task RemovalIgnoresCaseAndDropsAnEmptyNote()
    {
        var service = new NoteIgnoreService(new MemorySettings());
        await service.AddAsync("note", "Ordbanken", CancellationToken.None);

        await service.RemoveAsync("note", "ORDBANKEN", CancellationToken.None);

        Assert.Empty(await service.ListAsync("note", CancellationToken.None));
    }

    [Fact]
    public async Task ANoteStopsAcceptingWordsAtTheCap()
    {
        var service = new NoteIgnoreService(new MemorySettings());
        foreach (var i in Enumerable.Range(0, service.MaxWordsPerNote))
            Assert.True(await service.AddAsync("note", $"word{i}", CancellationToken.None));

        Assert.False(await service.AddAsync("note", "onemore", CancellationToken.None));
        Assert.Equal(service.MaxWordsPerNote, (await service.ListAsync("note", CancellationToken.None)).Count);
    }

    [Fact]
    public async Task ParallelAddsAcrossNotesAllSurvive()
    {
        var service = new NoteIgnoreService(new MemorySettings { WriteDelay = System.TimeSpan.FromMilliseconds(5) });

        await Task.WhenAll(Enumerable.Range(0, 16)
            .Select(i => service.AddAsync($"note{i % 4}", $"word{i}", CancellationToken.None)));

        var counted = 0;
        foreach (var i in Enumerable.Range(0, 4))
            counted += (await service.ListAsync($"note{i}", CancellationToken.None)).Count;

        Assert.Equal(16, counted);
    }
}
