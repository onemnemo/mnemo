using System;

namespace Mnemo.Core.Models.Proofing;

/// <summary>
/// One word the user has told the checker to accept.
/// </summary>
/// <param name="Word">The word as the user typed it, casing included, which is what a list shows.</param>
/// <param name="Language">
/// The language tag this word applies to, or null for every language. A name is spelled the same way
/// whichever language surrounds it, so null is the common case.
/// </param>
/// <param name="AddedAt">When it was added, so a list can be ordered newest first.</param>
public sealed record PersonalWord(string Word, string? Language, DateTimeOffset AddedAt);
