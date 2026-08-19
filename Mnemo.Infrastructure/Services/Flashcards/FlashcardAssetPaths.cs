using System;
using System.Collections.Generic;
using System.IO;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// How attachment paths are compared when deciding whether a file is still spoken for.
/// </summary>
/// <remarks>
/// The same file can be written into two rows with different separators or different casing, and on
/// Windows those all name one file. Comparing them raw would let a cleanup pass delete an image a
/// card still shows, so both sides of the question go through the same normalisation.
/// </remarks>
internal static class FlashcardAssetPaths
{
    /// <summary>The comparer a normalised path set is built with.</summary>
    public static StringComparer Comparer => StringComparer.OrdinalIgnoreCase;

    /// <summary>The comparable form of one stored path, or null when there is nothing to compare.</summary>
    public static string? Normalize(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        return path.Trim().Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
    }

    /// <summary>Adds a stored path to a set in its comparable form.</summary>
    public static void Add(HashSet<string> paths, string? path)
    {
        if (Normalize(path) is { } normalized)
            paths.Add(normalized);
    }
}
