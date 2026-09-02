using System;
using System.Collections.Generic;
using System.Text;

namespace Mnemo.Core.Identity;

/// <summary>
/// Mints sids by check-and-retry against the ids already in scope. Never random-without-check:
/// birthday collisions show up at roughly the square root of the value space, long before it fills,
/// and a silent duplicate sid would make two blocks indistinguishable to every caller that addresses
/// by sid.
///
/// Because collisions are detected rather than merely made unlikely, the length governs retry cost
/// and not correctness. That is what keeps sids short enough to stay usable at the tool boundary.
/// </summary>
public sealed class SidGenerator
{
    /// <summary>Consecutive collisions at a length before widening, so a dense scope cannot stall minting.</summary>
    private const int CollisionsBeforeWidening = 8;

    private readonly Func<int, string> _candidateFactory;

    /// <param name="candidateFactory">
    /// Produces a raw candidate of the requested length. Injectable so tests can force collisions and
    /// widening deterministically; defaults to a uniform random draw over <see cref="Sid.Alphabet"/>.
    /// </param>
    public SidGenerator(Func<int, string>? candidateFactory = null)
    {
        _candidateFactory = candidateFactory ?? RandomCandidate;
    }

    /// <summary>
    /// Returns a sid of at least <paramref name="length"/> characters that is absent from
    /// <paramref name="taken"/>. Callers minting a batch must add each result to the set before
    /// asking for the next, or the batch can collide with itself.
    /// </summary>
    public string Next(IReadOnlySet<string> taken, int length)
    {
        ArgumentNullException.ThrowIfNull(taken);
        if (length < 1)
            throw new ArgumentOutOfRangeException(nameof(length), length, "A sid needs at least one character.");

        var collisions = 0;

        while (true)
        {
            var candidate = _candidateFactory(length);
            if (!taken.Contains(candidate))
                return candidate;

            if (++collisions >= CollisionsBeforeWidening)
            {
                length++;
                collisions = 0;
            }
        }
    }

    public string NextBlockSid(IReadOnlySet<string> taken) => Next(taken, Sid.BlockLength);

    public string NextNoteSid(IReadOnlySet<string> taken) => Next(taken, Sid.NoteLength);

    public string NextMindmapSid(IReadOnlySet<string> taken) => Next(taken, Sid.MindmapLength);

    private static string RandomCandidate(int length)
    {
        var builder = new StringBuilder(length);
        for (var i = 0; i < length; i++)
            builder.Append(Sid.Alphabet[Random.Shared.Next(Sid.Alphabet.Length)]);
        return builder.ToString();
    }
}
