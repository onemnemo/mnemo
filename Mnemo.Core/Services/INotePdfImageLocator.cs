namespace Mnemo.Core.Services;

/// <summary>
/// Maps a note image block's stored reference to an absolute file path the PDF exporter can read.
/// </summary>
/// <remarks>
/// An image block's path is not always a filesystem path. Desktop-era notes store an absolute path,
/// but notes edited in the browser store a managed asset id (<c>{guid}.png</c>) or the older
/// <c>attachment:{guid}:{name}</c> form, which only the host's asset store can turn into a file. This
/// seam lets each host resolve those to a real path without the exporter knowing the difference; a
/// reference that cannot be located returns null and the block falls back to its alt text.
/// </remarks>
public interface INotePdfImageLocator
{
    /// <summary>The absolute path the reference points to, or null when it cannot be located.</summary>
    string? LocateImageFilePath(string reference);
}
