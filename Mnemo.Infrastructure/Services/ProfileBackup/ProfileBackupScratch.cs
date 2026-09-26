using System.Collections.Concurrent;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ProfileBackup;

/// <summary>
/// Owns the cleartext working copies a backup writes: <c>.backup-*</c> scratch folders under the
/// data root and <c>.building</c> archives beside the destination. A live scratch holds its lock
/// file open, so a sweep removes only what a killed backup left behind.
/// </summary>
public static class ProfileBackupScratch
{
    private const string LogCategory = "ProfileBackup";
    internal const string LockFileName = ".lock";
    private const string BuildingSuffix = ".building";
    private static readonly string[] Purposes = ["backup-create", "backup-inspect"];

    // A scratch with no lock file predates the lock or is a live one caught before taking it.
    internal static readonly TimeSpan UnlockedGrace = TimeSpan.FromMinutes(10);

    private static readonly ConcurrentDictionary<string, byte> Active = new(
        OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
            ? StringComparer.OrdinalIgnoreCase
            : StringComparer.Ordinal);

    /// <summary>
    /// Removes scratch folders under <paramref name="dataRoot"/> that no running backup holds.
    /// Only names this class creates are touched, and links are never followed.
    /// </summary>
    public static void SweepAbandoned(string dataRoot, ILoggerService logger)
    {
        var root = Path.GetFullPath(dataRoot);
        if (!Directory.Exists(root))
            return;

        foreach (var purpose in Purposes)
        {
            IEnumerable<string> candidates;
            try
            {
                candidates = Directory.EnumerateDirectories(root, $".{purpose}-*").ToArray();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                logger.Warning(LogCategory, $"Could not list backup scratch in {root}: {ex.Message}");
                return;
            }

            foreach (var path in candidates)
            {
                var suffix = Path.GetFileName(path)[(purpose.Length + 2)..];
                if (!ProfileBackupService.IsOperationId(suffix) || Active.ContainsKey(path))
                    continue;
                if (IsLink(path) || !IsAbandoned(path))
                    continue;
                if (ProfileBackupService.TryDeleteDirectory(path, logger))
                    logger.Info(LogCategory, $"Removed abandoned backup scratch {path}.");
            }
        }
    }

    /// <summary>
    /// Removes unfinished archives a killed backup left beside <paramref name="outputPath"/>. Files
    /// still open elsewhere are skipped.
    /// </summary>
    internal static void SweepAbandonedBuilds(string outputPath, ILoggerService logger)
    {
        var directory = Path.GetDirectoryName(outputPath)!;
        var prefix = "." + Path.GetFileName(outputPath) + ".";
        string[] candidates;
        try
        {
            candidates = Directory.EnumerateFiles(directory, "*" + BuildingSuffix).ToArray();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.Warning(LogCategory, $"Could not list unfinished backups in {directory}: {ex.Message}");
            return;
        }

        foreach (var path in candidates)
        {
            var name = Path.GetFileName(path);
            if (!name.StartsWith(prefix, StringComparison.Ordinal) ||
                name.Length != prefix.Length + 32 + BuildingSuffix.Length ||
                !ProfileBackupService.IsOperationId(name.Substring(prefix.Length, 32)) ||
                Active.ContainsKey(path) || IsLink(path))
            {
                continue;
            }

            try
            {
                // Opening exclusively fails while a writer holds it; closing deletes it.
                using var _ = new FileStream(
                    path, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
                logger.Info(LogCategory, $"Removed unfinished backup {path}.");
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
            }
        }
    }

    internal static Lease CreateDirectory(string dataRoot, string purpose, ILoggerService logger)
    {
        var path = Path.Combine(dataRoot, $".{purpose}-{Guid.NewGuid():N}");
        Active.TryAdd(path, 0);
        try
        {
            Directory.CreateDirectory(path);
            var hold = new FileStream(
                Path.Combine(path, LockFileName), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
            return new Lease(path, hold, logger);
        }
        catch
        {
            Active.TryRemove(path, out _);
            ProfileBackupService.TryDeleteDirectory(path, logger);
            throw;
        }
    }

    internal static Lease Track(string path, ILoggerService logger)
    {
        Active.TryAdd(path, 0);
        return new Lease(path, null, logger);
    }

    private static bool IsAbandoned(string path)
    {
        var lockPath = Path.Combine(path, LockFileName);
        try
        {
            if (File.Exists(lockPath))
            {
                using var probe = new FileStream(lockPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                return true;
            }

            return DateTime.UtcNow - NewestWriteUtc(path) >= UnlockedGrace;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static DateTime NewestWriteUtc(string path) =>
        new DirectoryInfo(path)
            .EnumerateFileSystemInfos("*", SearchOption.AllDirectories)
            .Select(entry => entry.LastWriteTimeUtc)
            .Append(Directory.GetLastWriteTimeUtc(path))
            .Max();

    private static bool IsLink(string path)
    {
        try
        {
            return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return true;
        }
    }

    /// <summary>A scratch path in use by this process. Disposing a directory lease deletes it.</summary>
    internal sealed class Lease : IDisposable
    {
        private readonly FileStream? _hold;
        private readonly ILoggerService _logger;

        internal Lease(string path, FileStream? hold, ILoggerService logger)
        {
            Path = path;
            _hold = hold;
            _logger = logger;
        }

        public string Path { get; }

        public void Dispose()
        {
            if (_hold is not null)
            {
                _hold.Dispose();
                ProfileBackupService.TryDeleteDirectory(Path, _logger);
            }
            Active.TryRemove(Path, out _);
        }
    }
}
