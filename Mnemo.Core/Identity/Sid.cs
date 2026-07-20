namespace Mnemo.Core.Identity;

/// <summary>
/// The short identifier format for notes and blocks. A sid is the only identifier that crosses the
/// model boundary — the GUID stays internal — so it is optimised for being read, dictated and
/// reasoned about rather than for entropy per character.
///
/// The alphabet drops every pair that is confusable in a proportional font or in speech: no 0/O,
/// no 1/l/I, and no u. What survives is unambiguous under transcription, which matters because
/// small local models address blocks by sid and a one-character slip must not resolve to a
/// different real block.
///
/// A persisted sid is durable. If collision pressure ever justifies more space, mint longer ids for
/// new objects and leave existing ones alone; the lengths below are minimums, never assumptions.
/// </summary>
public static class Sid
{
    public const string Alphabet = "23456789abcdefghjkmnpqrstvwxyz";

    /// <summary>Block sids are unique within their note, which is the only scope that ever resolves one.</summary>
    public const int BlockLength = 5;

    /// <summary>Note sids are unique across the corpus, since nothing encloses a note.</summary>
    public const int NoteLength = 6;

    /// <summary>
    /// True when <paramref name="value"/> could have been minted by this contract. Length is a floor,
    /// not an equality check, so ids minted after a future widening still validate.
    /// </summary>
    public static bool IsWellFormed(string? value, int minLength)
    {
        if (value is null || value.Length < minLength)
            return false;

        foreach (var c in value)
        {
            if (!Alphabet.Contains(c))
                return false;
        }

        return true;
    }

    public static bool IsWellFormedBlockSid(string? value) => IsWellFormed(value, BlockLength);

    public static bool IsWellFormedNoteSid(string? value) => IsWellFormed(value, NoteLength);
}
