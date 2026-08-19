using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapStoreTests
{
    [Fact]
    public async Task Save_And_Load_RoundTripsDocument()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "Rock cycle", revision: 5, Node("n1", "igneous"));

        await h.Store.SaveAsync(document, FullDelta(document));
        var loaded = await h.Store.LoadAsync("m1");

        Assert.NotNull(loaded);
        Assert.Equal("Rock cycle", loaded!.Title);
        Assert.Equal(5, loaded.Revision);
        Assert.Single(loaded.Elements);
        Assert.Equal("n1", loaded.Elements[0].Id);
    }

    [Fact]
    public async Task Load_ReturnsNull_ForMissingMap()
    {
        await using var h = new MindmapTestHarness();
        Assert.Null(await h.Store.LoadAsync("nope"));
    }

    [Fact]
    public async Task List_ReturnsHeaders()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveAsync(Doc("m1", "One", 1), new MindmapSearchDelta { FullReplace = true });
        await h.Store.SaveAsync(Doc("m2", "Two", 2), new MindmapSearchDelta { FullReplace = true });

        var summaries = await h.Store.ListAsync();

        Assert.Equal(2, summaries.Count);
        Assert.Contains(summaries, s => s.Id == "m1" && s.Title == "One");
        Assert.Contains(summaries, s => s.Id == "m2" && s.Revision == 2);
    }

    [Fact]
    public async Task Delete_RemovesDocumentAndSearchRows()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "M", 1, Node("n1", "sediment"));
        await h.Store.SaveAsync(document, FullDelta(document));

        await h.Store.DeleteAsync("m1");

        Assert.Null(await h.Store.LoadAsync("m1"));
        Assert.Empty(await h.Store.SearchAsync("m1", "sediment", 10));
    }

    [Fact]
    public async Task Search_FindsElementText()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "M", 1, Node("n1", "metamorphic rock"), Node("n2", "igneous rock"));
        await h.Store.SaveAsync(document, FullDelta(document));

        var hits = await h.Store.SearchAsync("m1", "metamorphic", 10);

        Assert.Single(hits);
        Assert.Equal("n1", hits[0].ElementId);
    }

    [Fact]
    public async Task IncrementalDelta_UpdatesAndRemovesRows()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "M", 1, Node("n1", "granite"), Node("n2", "basalt"));
        await h.Store.SaveAsync(document, FullDelta(document));

        // Re-index n1 with new text, remove n2 from the mirror — the incremental path.
        await h.Store.SaveAsync(document with { Revision = 2 }, new MindmapSearchDelta
        {
            Upserts = new[] { new MindmapSearchEntry("n1", "gneiss") },
            Removed = new[] { "n2" },
        });

        Assert.Empty(await h.Store.SearchAsync("m1", "granite", 10)); // old text gone
        Assert.Single(await h.Store.SearchAsync("m1", "gneiss", 10));  // new text indexed
        Assert.Empty(await h.Store.SearchAsync("m1", "basalt", 10));   // removed
    }

    [Fact]
    public async Task IncrementalDelta_MoreRowsThanOneStatementNames_RemovesExactlyThoseRows()
    {
        await using var h = new MindmapTestHarness();
        var nodes = Enumerable.Range(0, 900).Select(i => Node($"n{i}", $"word{i}")).ToArray();
        var document = Doc("m1", "M", 1, nodes);
        await h.Store.SaveAsync(document, FullDelta(document));

        // Deleting a branch names more elements than one statement can carry, so the removal is split.
        // A split that loses a chunk leaves search hits for nodes the user deleted, and one that overreaches
        // makes surviving nodes unfindable, so both ends of the boundary are checked.
        var removed = Enumerable.Range(0, 500).Select(i => $"n{i}").ToArray();
        await h.Store.SaveAsync(document with { Revision = 2 }, new MindmapSearchDelta { Removed = removed });

        Assert.Empty(await h.Store.SearchAsync("m1", "word0", 10));
        Assert.Empty(await h.Store.SearchAsync("m1", "word499", 10));
        Assert.Single(await h.Store.SearchAsync("m1", "word500", 10));
        Assert.Single(await h.Store.SearchAsync("m1", "word899", 10));
    }

    [Fact]
    public async Task Search_WithPunctuation_DoesNotThrow()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "M", 1, Node("n1", "heat + pressure"));
        await h.Store.SaveAsync(document, FullDelta(document));

        // A raw '+' is FTS5 syntax; the store must sanitize it rather than throw.
        var hits = await h.Store.SearchAsync("m1", "heat +", 10);

        Assert.Single(hits);
    }

    private static MindmapDocument Doc(string id, string title, long revision, params MindmapElement[] elements) =>
        new()
        {
            Id = id,
            Title = title,
            Revision = revision,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow,
            Elements = elements,
        };

    private static MindmapElement Node(string id, string text) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = text } };

    private static MindmapSearchDelta FullDelta(MindmapDocument document) =>
        new()
        {
            FullReplace = true,
            Upserts = document.Elements
                .Select(e => new MindmapSearchEntry(e.Id, ((TextContent)e.Content).Text))
                .ToList(),
        };
}
