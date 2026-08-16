using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Scratch space for transfer files. The import/export adapters work on local file paths - the
/// desktop hands them the path the user picked in a file dialog - but over HTTP the bytes arrive
/// in a request body and leave in a response body, so both directions need somewhere on disk in
/// between. Everything here is disposable: nothing under this directory is app data, and deleting
/// the whole tree while the app is closed loses nothing.
/// </summary>
public static class TransferStagingStore
{
    /// <summary>
    /// Upper bound on an uploaded transfer file. Far above the 20 MB image cap because an Anki
    /// package carries every media file for a whole collection.
    /// </summary>
    public const long MaxFileBytes = 512L * 1024 * 1024;

    /// <summary>
    /// What the request pipeline is allowed to read for one upload. Slightly above the file cap so
    /// multipart headers and boundaries cannot push a file that is legally sized into a framework
    /// rejection, which would surface as an opaque 500 instead of the size message.
    /// </summary>
    public const long MaxRequestBytes = MaxFileBytes + (4L * 1024 * 1024);

    /// <summary>
    /// How long an abandoned staged file survives. Only long enough to outlast an import dialog
    /// somebody left open; the confirmed and cancelled paths both delete eagerly, so anything
    /// still here past the cutoff is from a client that went away mid-flow.
    /// </summary>
    private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(6);

    public static string Directory => Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "transfer-staging");

    /// <summary>
    /// A staging id is the bare 32-hex-digit form <see cref="CreateUpload"/> mints. Validating the
    /// shape rather than sanitizing a caller-supplied string is what keeps a request from naming a
    /// path outside the staging directory.
    /// </summary>
    public static bool IsValidStagingId(string? stagingId) =>
        stagingId is { Length: 32 } && stagingId.All(Uri.IsHexDigit);

    /// <summary>
    /// Stages an upload under its own directory and returns the id plus the path to write to.
    /// </summary>
    /// <remarks>
    /// The uploaded file keeps its original name inside that directory, which is why each upload
    /// gets a directory instead of being a flat <c>{id}{ext}</c> file the way card assets are: the
    /// CSV adapter names the imported deck after the file, so staging <c>biology.csv</c> as its id
    /// would produce a deck called <c>8f2c...</c>.
    /// </remarks>
    public static (string StagingId, string Path) CreateUpload(string? originalFileName)
    {
        var stagingId = Guid.NewGuid().ToString("N");
        var directory = Path.Combine(Directory, stagingId);
        System.IO.Directory.CreateDirectory(directory);
        return (stagingId, Path.Combine(directory, SafeFileName(originalFileName)));
    }

    /// <summary>The staged upload's path, or null when the id is malformed or already consumed.</summary>
    public static string? ResolveUpload(string? stagingId)
    {
        if (!IsValidStagingId(stagingId))
            return null;

        var directory = Path.Combine(Directory, stagingId!);
        if (!System.IO.Directory.Exists(directory))
            return null;

        return System.IO.Directory.EnumerateFiles(directory).FirstOrDefault();
    }

    /// <summary>Discards a staged upload. Safe to call for an id that is already gone.</summary>
    public static void DeleteUpload(string? stagingId)
    {
        if (!IsValidStagingId(stagingId))
            return;

        TryDelete(() => System.IO.Directory.Delete(Path.Combine(Directory, stagingId!), recursive: true));
    }

    /// <summary>
    /// Discards an export whose response will never be sent. The normal path hands the file to
    /// <see cref="FileOptions.DeleteOnClose"/>, which only covers a stream that was opened.
    /// </summary>
    public static void TryDeleteFile(string path) => TryDelete(() =>
    {
        if (File.Exists(path))
            File.Delete(path);
    });

    /// <summary>
    /// A path for an adapter to write an export to. Flat rather than a directory because the
    /// download name travels in the Content-Disposition header, so the name on disk is nobody's
    /// business but ours.
    /// </summary>
    public static string CreateExportPath(string extension)
    {
        System.IO.Directory.CreateDirectory(Directory);
        return Path.Combine(Directory, $"export-{Guid.NewGuid():N}{extension}");
    }

    /// <summary>
    /// Clears staged files left behind by clients that never confirmed or cancelled. Called on
    /// upload rather than on a timer: an app that never imports again has nothing to clean up.
    /// </summary>
    public static void SweepStale()
    {
        if (!System.IO.Directory.Exists(Directory))
            return;

        var cutoff = DateTime.UtcNow - StaleAfter;
        foreach (var entry in System.IO.Directory.EnumerateFileSystemEntries(Directory))
        {
            // Sweeping is best-effort housekeeping, so a locked entry - an export still streaming,
            // an antivirus scan - is skipped rather than allowed to fail the upload that triggered it.
            // Last-write rather than creation time: creation time needs statx birthtime, which not
            // every Linux filesystem reports, and where it is missing .NET answers with an epoch
            // value that would make every entry look stale - including one another request is
            // still writing.
            TryDelete(() =>
            {
                if (System.IO.Directory.Exists(entry))
                {
                    if (System.IO.Directory.GetLastWriteTimeUtc(entry) < cutoff)
                        System.IO.Directory.Delete(entry, recursive: true);
                }
                else if (File.GetLastWriteTimeUtc(entry) < cutoff)
                {
                    File.Delete(entry);
                }
            });
        }
    }

    private static void TryDelete(Action delete)
    {
        try
        {
            delete();
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    /// <summary>
    /// The uploaded name reduced to something safe to join onto a path, keeping its extension -
    /// which is what adapter resolution keys off when the file is read back at import time.
    /// </summary>
    private static string SafeFileName(string? originalFileName)
    {
        var name = Path.GetFileName(originalFileName ?? string.Empty);
        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');

        // The extension is split off before the stem is trimmed and put back after. Trimming the
        // whole string would eat the leading dot of a name that is *only* an extension - ".csv"
        // becoming "csv", a file that uploads happily and can then never be imported, because the
        // import re-derives the format from the staged path.
        var extension = Path.GetExtension(name);
        var stem = extension.Length > 0 ? name[..^extension.Length] : name;
        stem = stem.Trim().Trim('.');
        return (string.IsNullOrWhiteSpace(stem) ? "import" : stem) + extension;
    }
}
