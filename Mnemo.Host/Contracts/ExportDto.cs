namespace Mnemo.Host.Contracts;

/// <param name="Title">The dialog's title. Supplied by the caller because the SPA holds the
/// translations and this process has no idea what language the window is running in.</param>
/// <param name="FileName">The name the dialog is pre-filled with. Its extension is the one the
/// chosen path is held to.</param>
public sealed record ExportSaveTargetRequest(string? Title, string? FileName);

/// <param name="Available">False when there is no window to raise a native chooser on, which is
/// the dev server in a browser tab and the headless test host. The caller falls back to the
/// browser's own download, which is the only thing that can work there anyway.</param>
/// <param name="Path">The chosen file, or null if the chooser was dismissed.</param>
/// <param name="Grant">The token a save route requires, or null when nothing was chosen.</param>
/// <param name="ConfirmOverwrite">True when the extension had to be appended and something is
/// already at the result. The chooser confirmed the name the user typed, which is not this one,
/// so the caller has to ask before the write replaces a file nobody was warned about.</param>
public sealed record ExportSaveTargetDto(bool Available, string? Path, string? Grant = null, bool ConfirmOverwrite = false);

/// <param name="Path">The file that was written, absolute, for the toast to name and to open.</param>
public sealed record ExportSavedDto(string Path);

/// <param name="Available">False when there is no window to raise a chooser on, so a dialog that
/// shows a destination has nothing true to show and hides the row instead.</param>
/// <param name="Folders">Where exports have gone, most recent first. Never empty.</param>
public sealed record ExportFoldersDto(bool Available, IReadOnlyList<string> Folders);

/// <summary>
/// What the request pipeline accepts for one transfer or export file.
/// </summary>
/// <remarks>
/// Here rather than on the staging store because notes, mind maps, flashcards and the generic save
/// route all hold themselves to the same number, and only one of those is a flashcards concern.
/// </remarks>
public static class TransferLimits
{
    /// <summary>
    /// Upper bound on one transfer file. Far above the 20 MB image cap because a package carries
    /// every media file for a whole collection.
    /// </summary>
    public const long MaxFileBytes = 512L * 1024 * 1024;

    /// <summary>
    /// What the request pipeline is allowed to read for one upload. Slightly above the file cap so
    /// multipart headers and boundaries cannot push a file that is legally sized into a framework
    /// rejection, which would surface as an opaque 500 instead of the size message.
    /// </summary>
    public const long MaxRequestBytes = MaxFileBytes + (4L * 1024 * 1024);

    /// <summary>The file cap as the megabyte figure user-facing copy quotes.</summary>
    public const long MaxFileMegabytes = MaxFileBytes / (1024 * 1024);
}
