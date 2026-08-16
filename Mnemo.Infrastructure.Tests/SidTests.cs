using Mnemo.Core.Identity;

namespace Mnemo.Infrastructure.Tests;

public class SidTests
{
    // Every persisted sid is durable, so the alphabet can never be revised without breaking ids
    // that are already in user data. This test exists to make that change fail loudly.
    [Fact]
    public void Alphabet_omits_every_confusable_character()
    {
        foreach (var lookalike in "01ilouILOU")
            Assert.DoesNotContain(lookalike, Sid.Alphabet);

        Assert.Equal(30, Sid.Alphabet.Length);
        Assert.Equal(Sid.Alphabet.Length, Sid.Alphabet.Distinct().Count());
        Assert.Equal(Sid.Alphabet, new string(Sid.Alphabet.OrderBy(c => c).ToArray()));
    }

    [Fact]
    public void Lengths_are_the_sizes_the_migration_was_run_with()
    {
        Assert.Equal(5, Sid.BlockLength);
        Assert.Equal(6, Sid.NoteLength);
    }

    [Theory]
    [InlineData("abcde", true)]
    [InlineData("23456", true)]
    [InlineData("abcdefgh", true)] // longer than the floor: a widened sid still validates
    [InlineData("abcd", false)] // shorter than the floor
    [InlineData("abcd0", false)] // zero is not in the alphabet
    [InlineData("abcdi", false)] // nor is i
    [InlineData("ABCDE", false)] // sids are lower case
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsWellFormedBlockSid_accepts_only_minted_shapes(string? value, bool expected)
    {
        Assert.Equal(expected, Sid.IsWellFormedBlockSid(value));
    }

    [Fact]
    public void Note_sids_need_one_more_character_than_block_sids()
    {
        Assert.True(Sid.IsWellFormedBlockSid("abcde"));
        Assert.False(Sid.IsWellFormedNoteSid("abcde"));
        Assert.True(Sid.IsWellFormedNoteSid("abcdef"));
    }

    [Fact]
    public void Minted_sids_are_well_formed_at_the_requested_length()
    {
        var generator = new SidGenerator();
        var taken = new HashSet<string>();

        for (var i = 0; i < 500; i++)
        {
            var sid = generator.NextBlockSid(taken);
            Assert.True(Sid.IsWellFormedBlockSid(sid), $"'{sid}' is not a well-formed block sid.");
            Assert.Equal(Sid.BlockLength, sid.Length);
            Assert.True(taken.Add(sid), $"'{sid}' was minted twice.");
        }
    }

    [Fact]
    public void Next_never_returns_a_sid_already_in_scope()
    {
        // Hands back a taken value three times before yielding a free one.
        var queue = new Queue<string>(["aaaaa", "aaaaa", "aaaaa", "bbbbb"]);
        var generator = new SidGenerator(_ => queue.Dequeue());

        Assert.Equal("bbbbb", generator.Next(new HashSet<string> { "aaaaa" }, 5));
    }

    [Fact]
    public void Sustained_collisions_widen_the_sid_rather_than_spinning()
    {
        var requestedLengths = new List<int>();
        var generator = new SidGenerator(length =>
        {
            requestedLengths.Add(length);
            // Every 5-character candidate collides; the first 6-character one is free.
            return length == 5 ? "aaaaa" : "bbbbbb";
        });

        var sid = generator.Next(new HashSet<string> { "aaaaa" }, 5);

        Assert.Equal("bbbbbb", sid);
        Assert.Equal(8, requestedLengths.Count(l => l == 5));
    }

    [Fact]
    public void Batch_minting_stays_collision_free_when_the_caller_records_each_result()
    {
        var generator = new SidGenerator();
        var taken = new HashSet<string>();
        var minted = Enumerable.Range(0, 2000).Select(_ =>
        {
            var sid = generator.NextBlockSid(taken);
            taken.Add(sid);
            return sid;
        }).ToList();

        Assert.Equal(minted.Count, minted.Distinct().Count());
    }
}
