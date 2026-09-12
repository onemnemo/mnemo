using System.Text.Json;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.ProfileBackup;

public sealed class ProfileBackupService : IProfileBackupService
{
    private const string LogCategory = "ProfileBackup";
    internal const string RestoreStagingDirectoryName = "restore-staging";
    internal const string PendingRestoreFileName = "pending.json";
    internal const string RestoreJournalFileName = "operation.json";

    internal static IReadOnlyList<string> ManagedDirectoryNames => MnemoAppPaths.ManagedProfileDirectoryNames;

    private readonly string _dataRoot;
    private readonly ProfileBackupArchive.ReadLimits _limits;
    private readonly ILoggerService _logger;
    private readonly Action<BackupCheckpoint>? _checkpoint;

    public ProfileBackupService(ILoggerService logger)
        : this(MnemoAppPaths.GetLocalUserDataRoot(), ProfileBackupArchive.ReadLimits.Default, logger)
    {
    }

    internal ProfileBackupService(
        string dataRoot,
        ProfileBackupArchive.ReadLimits limits,
        ILoggerService? logger = null,
        Action<BackupCheckpoint>? checkpoint = null)
    {
        _dataRoot = Path.GetFullPath(dataRoot);
        _limits = limits;
        _logger = logger ?? DiscardLogger.Instance;
        _checkpoint = checkpoint;
    }

    public async Task<ProfileBackupManifest> CreateAsync(
        string outputFilePath,
        string appVersion,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(outputFilePath))
            throw new ArgumentException("An output path is required.", nameof(outputFilePath));
        if (!ProfileBackupArchive.IsValidAppVersion(appVersion))
            throw new ArgumentException("A valid application version is required.", nameof(appVersion));

        var output = Path.GetFullPath(outputFilePath);
        var outputDirectory = Path.GetDirectoryName(output)!;
        Directory.CreateDirectory(outputDirectory);
        var building = Path.Combine(outputDirectory, $".{Path.GetFileName(output)}.{Guid.NewGuid():N}.building");
        var scratch = WorkingDirectory("backup-create");
        Directory.CreateDirectory(scratch);

        try
        {
            var snapshot = Path.Combine(scratch, ProfileBackupArchive.DatabasePath);
            var assets = Path.Combine(scratch, "assets");
            await CaptureConsistentProfileAsync(snapshot, assets, cancellationToken).ConfigureAwait(false);
            var contents = await ProfileBackupDatabase.SanitizeAndDescribeAsync(snapshot, cancellationToken)
                .ConfigureAwait(false);
            EnsureSnapshotHasNoSidecars(snapshot);
            var collectionId = await ProfileBackupDatabase.ReadJsonStringAsync(
                snapshot, "Collection.Id", cancellationToken).ConfigureAwait(false);

            var manifest = new ProfileBackupManifest
            {
                FormatVersion = ProfileBackupArchive.FormatVersion,
                CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByAppVersion = appVersion,
                CollectionId = collectionId,
                Contents = contents,
            };

            await ProfileBackupWriter.WriteAsync(building, snapshot, assets, manifest, _limits, cancellationToken)
                .ConfigureAwait(false);
            _checkpoint?.Invoke(BackupCheckpoint.ArchiveReady);
            cancellationToken.ThrowIfCancellationRequested();
            ReplaceAtomically(building, output);
            _logger.Info(LogCategory, $"Created profile backup at {output}.");
            return manifest;
        }
        catch (Exception ex)
        {
            TryDeleteFile(building, _logger);
            _logger.Error(LogCategory, "Profile backup creation failed.", ex);
            throw;
        }
        finally
        {
            TryDeleteDirectory(scratch, _logger);
        }
    }

    public async Task<ProfileBackupInspection> InspectAsync(
        string backupFilePath,
        string currentAppVersion,
        CancellationToken cancellationToken = default)
    {
        var scratch = WorkingDirectory("backup-inspect");
        var databasePath = Path.Combine(scratch, ProfileBackupArchive.DatabasePath);
        Directory.CreateDirectory(scratch);
        ProfileBackupManifest manifest;
        try
        {
            manifest = await ProfileBackupArchive.ValidateAsync(
                backupFilePath,
                currentAppVersion,
                _limits,
                databaseExtractionPath: databasePath,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            await ProfileBackupDatabase.ValidateAsync(databasePath, cancellationToken).ConfigureAwait(false);
            var actual = await ProfileBackupDatabase.DescribeAsync(databasePath, cancellationToken).ConfigureAwait(false);
            actual.ManagedFiles = manifest.Entries.Count(entry => entry.Path.StartsWith("assets/", StringComparison.Ordinal));
            if (!ProfileBackupDatabase.ContentSummaryMatches(manifest.Contents, actual))
                throw new ProfileBackupException("backup_manifest_invalid", "The backup summary does not match its profile data.");
            var archiveCollectionId = await ProfileBackupDatabase.ReadJsonStringAsync(
                databasePath, "Collection.Id", cancellationToken).ConfigureAwait(false);
            if (!string.Equals(manifest.CollectionId, archiveCollectionId, StringComparison.OrdinalIgnoreCase))
                throw new ProfileBackupException("backup_manifest_invalid", "The backup collection identity does not match its profile data.");
        }
        catch (InvalidDataException ex)
        {
            throw new ProfileBackupException("backup_manifest_invalid", "The backup file is malformed.", ex);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SqliteException or InvalidCastException)
        {
            throw new ProfileBackupException("backup_manifest_invalid", "The backup file could not be read.", ex);
        }
        finally
        {
            TryDeleteDirectory(scratch, _logger);
        }
        string? localCollectionId;
        try
        {
            localCollectionId = await ProfileBackupDatabase.ReadJsonStringAsync(
                Path.Combine(_dataRoot, "mnemo.db"), "Collection.Id", cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SqliteException or InvalidCastException)
        {
            throw new ProfileBackupException("backup_database_unavailable", "The current profile database could not be read.", ex);
        }
        var sameCollection = !string.IsNullOrWhiteSpace(manifest.CollectionId) &&
            string.Equals(manifest.CollectionId, localCollectionId, StringComparison.OrdinalIgnoreCase);
        return new ProfileBackupInspection(manifest, sameCollection, CanRestore: true);
    }

    public async Task<ProfileRestoreStage> StageRestoreAsync(
        string backupFilePath,
        string currentAppVersion,
        CancellationToken cancellationToken = default)
    {
        _ = await InspectAsync(backupFilePath, currentAppVersion, cancellationToken).ConfigureAwait(false);
        var operationId = Guid.NewGuid().ToString("N");
        var staging = Path.Combine(_dataRoot, RestoreStagingDirectoryName);
        Directory.CreateDirectory(staging);
        SweepStagedRestore(staging);
        var finalArchive = Path.Combine(staging, operationId + ".mnemo-backup");
        var pendingArchive = finalArchive + ".part";
        var pendingFile = Path.Combine(staging, PendingRestoreFileName);
        var pendingWrite = pendingFile + ".part";

        try
        {
            await CopyFileAsync(backupFilePath, pendingArchive, cancellationToken).ConfigureAwait(false);
            File.Move(pendingArchive, finalArchive, overwrite: false);

            var pending = new PendingRestore(operationId, Path.GetFileName(finalArchive), DateTimeOffset.UtcNow);
            await WriteJsonFileAsync(pendingWrite, pending, cancellationToken).ConfigureAwait(false);
            File.Move(pendingWrite, pendingFile, overwrite: true);
            _logger.Info(LogCategory, $"Staged profile restore {operationId}.");
            return new ProfileRestoreStage(operationId);
        }
        catch (Exception ex)
        {
            TryDeleteFile(pendingArchive, _logger);
            TryDeleteFile(finalArchive, _logger);
            TryDeleteFile(pendingWrite, _logger);
            _logger.Error(LogCategory, "Profile restore staging failed.", ex);
            throw;
        }
    }

    public bool IsRestoreStaged(string? operationId)
    {
        if (!IsOperationId(operationId))
            return false;
        var validOperationId = operationId!;

        var staging = Path.Combine(_dataRoot, RestoreStagingDirectoryName);
        var pending = ReadPending(Path.Combine(staging, PendingRestoreFileName));
        return pending is not null && pending.OperationId == validOperationId &&
            File.Exists(Path.Combine(staging, pending.ArchiveFileName));
    }

    public Task<bool> CancelStagedRestoreAsync(
        string? operationId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!IsOperationId(operationId))
            return Task.FromResult(false);
        var validOperationId = operationId!;

        var staging = Path.Combine(_dataRoot, RestoreStagingDirectoryName);
        var pendingPath = Path.Combine(staging, PendingRestoreFileName);
        var pending = ReadPending(pendingPath);
        if (pending is null || pending.OperationId != validOperationId)
            return Task.FromResult(false);

        TryDeleteFile(pendingPath, _logger);
        TryDeleteFile(Path.Combine(staging, pending.ArchiveFileName), _logger);
        _logger.Info(LogCategory, $"Cancelled staged profile restore {validOperationId}.");
        return Task.FromResult(true);
    }

    private async Task CaptureConsistentProfileAsync(
        string snapshotPath,
        string assetsPath,
        CancellationToken cancellationToken)
    {
        var databasePath = Path.Combine(_dataRoot, "mnemo.db");
        if (!File.Exists(databasePath))
            throw new ProfileBackupException("backup_database_missing", "The Mnemo profile database could not be found.");

        await using var barrier = new SqliteConnection($"Data Source={databasePath};Pooling=False");
        await barrier.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (var pragma = barrier.CreateCommand())
        {
            pragma.CommandText = "PRAGMA busy_timeout=15000; BEGIN IMMEDIATE;";
            await pragma.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        try
        {
            await using var source = new SqliteConnection($"Data Source={databasePath};Mode=ReadOnly;Pooling=False");
            await source.OpenAsync(cancellationToken).ConfigureAwait(false);
            await using (var destination = new SqliteConnection($"Data Source={snapshotPath};Pooling=False"))
            {
                await destination.OpenAsync(cancellationToken).ConfigureAwait(false);
                source.BackupDatabase(destination);
            }
        }
        finally
        {
            await using var rollback = barrier.CreateCommand();
            rollback.CommandText = "ROLLBACK;";
            await rollback.ExecuteNonQueryAsync(CancellationToken.None).ConfigureAwait(false);
        }

        foreach (var directoryName in ManagedDirectoryNames)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await CopyManagedDirectoryAsync(
                Path.Combine(_dataRoot, directoryName),
                Path.Combine(assetsPath, directoryName),
                cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task CopyManagedDirectoryAsync(
        string sourceDirectory,
        string destinationDirectory,
        CancellationToken cancellationToken)
    {
        if (!Directory.Exists(sourceDirectory))
            return;
        if ((File.GetAttributes(sourceDirectory) & FileAttributes.ReparsePoint) != 0)
            throw new ProfileBackupException("backup_link_rejected", "A managed asset directory is a link.");

        Directory.CreateDirectory(destinationDirectory);
        foreach (var path in Directory.EnumerateFileSystemEntries(sourceDirectory))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new ProfileBackupException("backup_link_rejected", "A managed asset is a link.");
                if (Directory.Exists(path))
                {
                    _logger.Warning(LogCategory, $"Skipped unexpected directory in managed assets: {path}");
                    continue;
                }

                await CopyFileAsync(path, Path.Combine(destinationDirectory, Path.GetFileName(path)), cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
            {
                _logger.Warning(LogCategory, $"Skipped managed asset that disappeared during capture: {path}");
            }
        }
    }

    private static async Task CopyFileAsync(string source, string destination, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        await input.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
        await output.FlushAsync(cancellationToken).ConfigureAwait(false);
        output.Flush(flushToDisk: true);
    }

    private string WorkingDirectory(string purpose) =>
        Path.Combine(_dataRoot, $".{purpose}-{Guid.NewGuid():N}");

    private void SweepStagedRestore(string staging)
    {
        if (File.Exists(Path.Combine(staging, RestoreJournalFileName)))
            throw new ProfileBackupException("restore_recovery_pending", "An interrupted restore must be recovered before another can start.");

        foreach (var path in Directory.EnumerateFiles(staging))
        {
            var name = Path.GetFileName(path);
            if (name == ProfileRestoreStartup.StatusFileName)
                continue;
            TryDeleteFile(path, _logger);
        }
        foreach (var path in Directory.EnumerateDirectories(staging, "apply-*"))
            TryDeleteDirectory(path, _logger);
    }

    private PendingRestore? ReadPending(string path)
    {
        if (!File.Exists(path))
            return null;
        try
        {
            return JsonSerializer.Deserialize<PendingRestore>(
                File.ReadAllText(path), ProfileBackupArchive.SerializerOptions);
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            _logger.Warning(LogCategory, $"Could not read the staged restore request at {path}: {ex.Message}");
            return null;
        }
    }

    private static async Task WriteJsonFileAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        await File.WriteAllTextAsync(
            path, JsonSerializer.Serialize(value, ProfileBackupArchive.SerializerOptions), cancellationToken)
            .ConfigureAwait(false);
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
        stream.Flush(flushToDisk: true);
    }

    private static void EnsureSnapshotHasNoSidecars(string snapshot)
    {
        if (File.Exists(snapshot + "-wal") || File.Exists(snapshot + "-shm"))
            throw new ProfileBackupException("backup_database_invalid", "The sanitized profile snapshot still has SQLite sidecars.");
    }

    private static void ReplaceAtomically(string source, string destination)
    {
        if (File.Exists(destination))
            File.Replace(source, destination, destinationBackupFileName: null);
        else
            File.Move(source, destination);
    }

    internal static bool IsOperationId(string? value) =>
        value is { Length: 32 } && value.All(char.IsAsciiHexDigit);

    internal static bool TryDeleteFile(string path, ILoggerService logger)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.Warning(LogCategory, $"Could not remove temporary backup file {path}: {ex.Message}");
            return false;
        }
    }

    internal static bool TryDeleteDirectory(string path, ILoggerService logger)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, recursive: true);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.Warning(LogCategory, $"Could not remove temporary backup directory {path}: {ex.Message}");
            return false;
        }
    }

    internal sealed record PendingRestore(string OperationId, string ArchiveFileName, DateTimeOffset StagedAtUtc);

    internal enum BackupCheckpoint
    {
        ArchiveReady,
    }

    private sealed class DiscardLogger : ILoggerService
    {
        public static readonly DiscardLogger Instance = new();

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
