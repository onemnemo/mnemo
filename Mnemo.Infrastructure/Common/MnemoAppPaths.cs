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
    {
        var overrideRoot = Environment.GetEnvironmentVariable(DataDirEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(overrideRoot))
            return Path.GetFullPath(overrideRoot);

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
            localAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        return Path.Combine(localAppData, ProductFolderName);
    }

    public static string GetLocalUserDataFile(string fileName)
        => Path.Combine(GetLocalUserDataRoot(), fileName);

    /// <summary>
    /// Returns the directory where image block assets are stored:
    /// <c>%LocalAppData%\Mnemo\images\</c>.
    /// </summary>
    public static string GetImagesDirectory()
        => Path.Combine(GetLocalUserDataRoot(), "images");

    /// <summary>
    /// True when <paramref name="absolutePath"/> resolves to a file under <see cref="GetImagesDirectory"/>.
    /// Used so we only delete managed copies, never arbitrary user-selected paths.
    /// </summary>
    public static bool IsPathUnderImagesDirectory(string absolutePath)
    {
        if (string.IsNullOrWhiteSpace(absolutePath))
            return false;

        try
        {
            var fullFile = Path.GetFullPath(absolutePath);
            var dir = Path.GetFullPath(GetImagesDirectory());
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

