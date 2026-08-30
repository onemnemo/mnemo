using System;
using System.IO;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// A destination the host has agreed to write an exported file to.
/// </summary>
/// <param name="Directory">The folder, absolute and normalized. What gets remembered on success.</param>
/// <param name="FullPath">The file itself, carrying the extension the format requires.</param>
public sealed record ExportTarget(string Directory, string FullPath)
{
    /// <summary>
    /// Splits the path a native save dialog handed back into a destination, or refuses with a code.
    /// </summary>
    /// <remarks>
    /// The security boundary in front of every save route, since a grant is only ever minted for
    /// what this returns. The path is one the caller supplies, which is the point of the feature,
    /// so the checks are on shape rather than on a list: it must be absolute, its folder's parent
    /// must already exist (so a typo cannot conjure a tree), and the last segment must be a name
    /// and not a path, which is what keeps <c>..\..\</c> out of the result.
    ///
    /// A required extension is appended when the name does not already end in it. A chooser hands
    /// back whatever was typed, so a name without its suffix is the ordinary case rather than a
    /// fault, and two formats that differ only by extension must not collide.
    /// </remarks>
    /// <param name="path">An absolute file path.</param>
    /// <param name="requiredExtension">Dotted, e.g. ".pdf". Null or empty accepts any name.</param>
    /// <param name="target">The resolved destination, or null when this returns false.</param>
    /// <param name="error">
    /// One of <c>invalid_file_name</c>, <c>invalid_directory</c>, <c>missing_directory</c>, or empty
    /// on success.
    /// </param>
    public static bool TryResolvePath(
        string? path,
        string? requiredExtension,
        out ExportTarget? target,
        out string error)
    {
        target = null;

        var trimmed = path?.Trim() ?? string.Empty;
        if (trimmed.Length == 0 || !Path.IsPathFullyQualified(trimmed))
        {
            error = "invalid_directory";
            return false;
        }

        var name = Path.GetFileName(trimmed);
        if (name.Length == 0 || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            error = "invalid_file_name";
            return false;
        }

        var folder = Path.GetFullPath(Path.GetDirectoryName(trimmed) ?? string.Empty);
        var parent = Path.GetDirectoryName(folder);
        // Fully qualified: this record's own Directory property shadows the type inside it.
        if (!System.IO.Directory.Exists(folder) && (parent is null || !System.IO.Directory.Exists(parent)))
        {
            error = "missing_directory";
            return false;
        }

        if (!string.IsNullOrEmpty(requiredExtension) && !name.EndsWith(requiredExtension, StringComparison.OrdinalIgnoreCase))
            name += requiredExtension;

        target = new ExportTarget(folder, Path.Combine(folder, name));
        error = string.Empty;
        return true;
    }
}
