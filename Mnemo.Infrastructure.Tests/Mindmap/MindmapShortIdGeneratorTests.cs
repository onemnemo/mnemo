using System.Collections.Generic;
using Mnemo.Infrastructure.Services.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapShortIdGeneratorTests
{
    private const string Alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

    [Fact]
    public void Next_ProducesUniqueFourCharBase36_UnderNormalDensity()
    {
        var generator = new MindmapShortIdGenerator();
        var seen = new HashSet<string>();

        for (var i = 0; i < 2000; i++)
        {
            var id = generator.Next(seen);
            Assert.Equal(4, id.Length);
            Assert.All(id, c => Assert.Contains(c, Alphabet));
            Assert.True(seen.Add(id), "generator returned a duplicate id");
        }
    }

    [Fact]
    public void Next_SkipsCandidatesAlreadyInUse()
    {
        // Factory returns a colliding candidate first, then a free one.
        var queue = new Queue<string>(new[] { "aaaa", "bbbb" });
        var generator = new MindmapShortIdGenerator(_ => queue.Dequeue());
        var existing = new HashSet<string> { "aaaa" };

        var id = generator.Next(existing);

        Assert.Equal("bbbb", id);
    }

    [Fact]
    public void Next_WidensToFiveChars_AfterConsecutiveCollisions()
    {
        // Every 4-char candidate collides; only the 5-char candidate is free.
        var generator = new MindmapShortIdGenerator(length => length == 4 ? "aaaa" : "bbbbb");
        var existing = new HashSet<string> { "aaaa" };

        var id = generator.Next(existing);

        Assert.Equal("bbbbb", id);
        Assert.Equal(5, id.Length);
    }
}
