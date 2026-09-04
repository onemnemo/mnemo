using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

public sealed class NoteLanguageServiceTests
{
    private static NoteLanguageEntry Custom(params string[] languages) =>
        new(NoteProofingMode.Custom, languages);

    [Fact]
    public async Task ANoteWithNoChoiceReadsAsNothing()
    {
        var service = new NoteLanguageService(new MemorySettings());

        Assert.Null(await service.GetAsync("note-a", CancellationToken.None));
        Assert.Null(await service.GetAsync("  ", CancellationToken.None));
    }

    [Fact]
    public async Task AChoiceIsKeptPerNote()
    {
        var service = new NoteLanguageService(new MemorySettings());

        Assert.True(await service.SetAsync("note-a", Custom("es-ES"), CancellationToken.None));
        Assert.True(await service.SetAsync("note-b", new NoteLanguageEntry(NoteProofingMode.Off, []), CancellationToken.None));

        var a = await service.GetAsync("note-a", CancellationToken.None);
        Assert.Equal(NoteProofingMode.Custom, a!.Mode);
        Assert.Equal(["es-ES"], a.Languages);

        var b = await service.GetAsync("note-b", CancellationToken.None);
        Assert.Equal(NoteProofingMode.Off, b!.Mode);
        Assert.Empty(b.Languages);
    }

    [Fact]
    public async Task WritingAgainReplacesTheChoice()
    {
        var service = new NoteLanguageService(new MemorySettings());
        await service.SetAsync("note-a", Custom("es-ES", "en-US"), CancellationToken.None);

        await service.SetAsync("note-a", Custom("en-US"), CancellationToken.None);

        Assert.Equal(["en-US"], (await service.GetAsync("note-a", CancellationToken.None))!.Languages);
    }

    [Fact]
    public async Task ClearingPutsANoteBackOnTheDefaults()
    {
        var service = new NoteLanguageService(new MemorySettings());
        await service.SetAsync("note-a", Custom("es-ES"), CancellationToken.None);

        await service.ClearAsync("note-a", CancellationToken.None);
        await service.ClearAsync("note-b", CancellationToken.None);

        Assert.Null(await service.GetAsync("note-a", CancellationToken.None));
    }

    [Fact]
    public async Task ANewNotePastTheCapIsRefused()
    {
        var service = new NoteLanguageService(new MemorySettings());
        foreach (var i in Enumerable.Range(0, service.MaxNotes))
            Assert.True(await service.SetAsync($"note{i}", Custom("en-US"), CancellationToken.None));

        Assert.False(await service.SetAsync("onemore", Custom("en-US"), CancellationToken.None));
        Assert.Null(await service.GetAsync("onemore", CancellationToken.None));
    }

    [Fact]
    public async Task ANoteAlreadyStoredIsStillWritableWhenTheMapIsFull()
    {
        // The cap bounds how large the value can grow, so a write that cannot grow it, a rewrite or
        // a clear, has to keep working once the map is full.
        var service = new NoteLanguageService(new MemorySettings());
        foreach (var i in Enumerable.Range(0, service.MaxNotes))
            await service.SetAsync($"note{i}", Custom("en-US"), CancellationToken.None);

        Assert.True(await service.SetAsync("note0", Custom("es-ES"), CancellationToken.None));
        Assert.Equal(["es-ES"], (await service.GetAsync("note0", CancellationToken.None))!.Languages);

        await service.ClearAsync("note1", CancellationToken.None);
        Assert.True(await service.SetAsync("onemore", Custom("en-US"), CancellationToken.None));
    }

    [Fact]
    public async Task ParallelWritesAcrossNotesAllSurvive()
    {
        var service = new NoteLanguageService(new MemorySettings { WriteDelay = TimeSpan.FromMilliseconds(5) });

        await Task.WhenAll(Enumerable.Range(0, 16)
            .Select(i => service.SetAsync($"note{i}", Custom("en-US"), CancellationToken.None)));

        foreach (var i in Enumerable.Range(0, 16))
            Assert.NotNull(await service.GetAsync($"note{i}", CancellationToken.None));
    }
}
