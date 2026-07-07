using System;
using System.Collections.Generic;
using System.Text;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// Generates document-local element/edge ids: 4-character base-36 strings, unique within a document
/// Generation is check-and-retry against the live id set, never random-without-check, since
/// birthday collisions appear long before the ~1.68M value space fills. After several consecutive
/// collisions (high density) it widens to 5 characters for the rest of that document.
/// </summary>
public sealed class MindmapShortIdGenerator
{
    private const string Alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    private const int BaseLength = 4;
    private const int WidenedLength = 5;

    /// <summary>Consecutive collisions at a length before widening. Keeps density from stalling generation.</summary>
    private const int CollisionsBeforeWidening = 8;

    private readonly Func<int, string> _candidateFactory;

    /// <param name="candidateFactory">
    /// Produces a raw base-36 candidate of the requested length. Injectable so tests can force collisions
    /// deterministically; defaults to a cryptographically-unbiased random source.
    /// </param>
    public MindmapShortIdGenerator(Func<int, string>? candidateFactory = null)
    {
        _candidateFactory = candidateFactory ?? RandomCandidate;
    }

    /// <summary>
    /// Returns an id not present in <paramref name="existingIds"/>. The caller must add the returned id to
    /// its set before requesting the next one (so a batch that creates many ids stays collision-free).
    /// </summary>
    public string Next(IReadOnlySet<string> existingIds)
    {
        ArgumentNullException.ThrowIfNull(existingIds);

        var length = BaseLength;
        var collisions = 0;

        while (true)
        {
            var candidate = _candidateFactory(length);
            if (!existingIds.Contains(candidate))
                return candidate;

            if (++collisions >= CollisionsBeforeWidening && length < WidenedLength)
            {
                length = WidenedLength;
                collisions = 0;
            }
        }
    }

    private static string RandomCandidate(int length)
    {
        var builder = new StringBuilder(length);
        for (var i = 0; i < length; i++)
            builder.Append(Alphabet[Random.Shared.Next(Alphabet.Length)]);
        return builder.ToString();
    }
}
