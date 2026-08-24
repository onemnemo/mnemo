using System;
using System.IO;

namespace Mnemo.Infrastructure.Common;

public static class MnemoAppPaths
{
    private const string ProductFolderName = "Mnemo";

    /// <summary>
    /// Environment variable that overrides the data root wholesale, so a second app
    /// instance (e.g. a dev host) can run against its own profile instead of the
    /// shared per-user directory. Unset means normal per-user resolution.
    /// </summary>
    public const string DataDirEnvironmentVariable = "MNEMO_DATA_DIR";

    // Local databases should live in OS-specific per-user directories.
    // Windows: %LOCALAPPDATA%\Mnemo\
    // Linux/macOS: resolved via .NET's LocalApplicationData implementation.
    public static string GetLocalUserDataRoot()
        => ResolveDataRoot(
            Environment.GetEnvironmentVariable(DataDirEnvironmentVariable),
            GetLocalApplicationData());

    /// <summary>
    /// Decides the data root from an override and the per-user application data directory.
    /// An override that is null, empty or whitespace is ignored, so a blank variable behaves as
    /// if it were unset; otherwise the override wins and is returned as a full path. Split out
    /// from <see cref="GetLocalUserDataRoot"/> so the rule can be exercised without changing the
    /// environment of the running process.
    /// </summary>
    public static string ResolveDataRoot(string? overrideRoot, string localApplicationData)
    {
        if (!string.IsNullOrWhiteSpace(overrideRoot))
            return Path.GetFullPath(overrideRoot);

        return Path.Combine(localApplicationData, ProductFolderName);
    }

    /// <summary>
    /// The per-user application data directory this machine reports, falling back to the roaming
    /// directory when the local one is unavailable. Ignores the data root override, so a caller
    /// that needs the shipped location can ask for it while an override is in force.
    /// </summary>
    public static string GetLocalApplicationData()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
            localAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        return localAppData;
    }

    public static string GetLocalUserDataFile(string fileName)
        => Path.Combine(GetLocalUserDataRoot(), fileName);

    /// <summary>
    /// Returns the directory holding the daily log files: <c>%LocalAppData%\Mnemo\logs\</c>.
    /// The logger's file sink, the startup crash sink and the endpoint that shows the folder
    /// all resolve it here, so an overridden data root moves the three of them together
    /// instead of writing to one place and opening another.
    /// </summary>
    public static string GetLogsDirectory()
        => Path.Combine(GetLocalUserDataRoot(), "logs");

    /// <summary>
    /// Returns the directory where image block assets are stored:
    /// <c>%LocalAppData%\Mnemo\images\</c>.
    /// </summary>
    public static string GetImagesDirectory()
        => Path.Combine(GetLocalUserDataRoot(), "images");

    /// <summary>
    /// Returns the directory where chat attachments uploaded through the web host are
    /// stored: <c>%LocalAppData%\Mnemo\chat-attachments\</c>. Files land here as managed
    /// copies so the host can serve them back by id without exposing arbitrary paths.
    /// </summary>
    public static string GetChatAttachmentsDirectory()
        => Path.Combine(GetLocalUserDataRoot(), "chat-attachments");

    /// <summary>
    /// Returns the directory where note image assets uploaded through the web host are
    /// stored: <c>%LocalAppData%\Mnemo\note-assets\</c>. Deliberately separate from
    /// <see cref="GetImagesDirectory"/>: that directory is shared with flashcard and mindmap
    /// assets, so a notes-only cleanup pass over it could never know which files are safe to
    /// remove. A directory owned by one module makes its sweep safe by construction.
    /// </summary>
    public static string GetNoteAssetsDirectory()
        => Path.Combine(GetLocalUserDataRoot(), "note-assets");

    /// <summary>
    /// Returns the directory where mindmap canvas images uploaded through the web host are
    /// stored: <c>%LocalAppData%\Mnemo\mindmap-assets\</c>. Separate from
    /// <see cref="GetImagesDirectory"/> for the same reason
    /// <see cref="GetNoteAssetsDirectory"/> is: a module that owns its directory can say which
    /// files in it are unreferenced, and a module sharing one never can. Images a map carried
    /// before this directory existed stay in the shared one and are still read from there.
    /// </summary>
    public static string GetMindmapAssetsDirectory()
        => Path.Combine(GetLocalUserDataRoot(), "mindmap-assets");

    /// <summary>
    /// True when <paramref name="absolutePath"/> resolves to a file under <see cref="GetImagesDirectory"/>.
    /// Used so we only delete managed copies, never arbitrary user-selected paths.
    /// </summary>
    public static bool IsPathUnderImagesDirectory(string absolutePath)
        => IsPathUnderDirectory(absolutePath, GetImagesDirectory());

    /// <summary>
    /// True when <paramref name="absolutePath"/> resolves to a file under <see cref="GetChatAttachmentsDirectory"/>.
    /// </summary>
    public static bool IsPathUnderChatAttachmentsDirectory(string absolutePath)
        => IsPathUnderDirectory(absolutePath, GetChatAttachmentsDirectory());

    /// <summary>
    /// True when <paramref name="absolutePath"/> resolves to a file under <see cref="GetNoteAssetsDirectory"/>.
    /// </summary>
    public static bool IsPathUnderNoteAssetsDirectory(string absolutePath)
        => IsPathUnderDirectory(absolutePath, GetNoteAssetsDirectory());

    /// <summary>
    /// True when <paramref name="absolutePath"/> resolves to a file under <see cref="GetMindmapAssetsDirectory"/>.
    /// </summary>
    public static bool IsPathUnderMindmapAssetsDirectory(string absolutePath)
        => IsPathUnderDirectory(absolutePath, GetMindmapAssetsDirectory());

    /// <summary>
    /// True when <paramref name="absolutePath"/> resolves to a file strictly under
    /// <paramref name="directory"/>. The general form of the checks above, for callers that
    /// manage a directory of their own.
    /// </summary>
    public static bool IsPathUnder(string absolutePath, string directory)
        => IsPathUnderDirectory(absolutePath, directory);

    private static bool IsPathUnderDirectory(string absolutePath, string directory)
    {
        if (string.IsNullOrWhiteSpace(absolutePath))
            return false;

        try
        {
            var fullFile = Path.GetFullPath(absolutePath);
            var dir = Path.GetFullPath(directory);
            if (fullFile.Length <= dir.Length)
                return false;
            if (!fullFile.StartsWith(dir, StringComparison.OrdinalIgnoreCase))
                return false;
            var sep = fullFile[dir.Length];
            return sep == Path.DirectorySeparatorChar || sep == Path.AltDirectorySeparatorChar;
        }
        catch
        {
            return false;
        }
    }
}

