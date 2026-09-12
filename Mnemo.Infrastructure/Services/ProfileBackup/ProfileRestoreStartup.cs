using System.Text.Json;
using Mnemo.Core.Enums;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.ProfileBackup;

/// <summary>
/// Applies a staged profile replacement before dependency injection opens the database. A journal
/// makes an interrupted multi-file replacement roll back on the next launch.
/// </summary>
public static class ProfileRestoreStartup
{
    public const string RecoveryDirectoryName = "restore-recovery";
    public const string StatusFileName = "restore-status.json";
    private static readonly TimeSpan PendingLifetime = TimeSpan.FromHours(24);
    private const string LogCategory = "ProfileRestore";

    public static async Task<RestoreStatus?> ApplyPendingAsync(
        string dataRoot,
        string currentAppVersion,
        ILoggerService? logger = null,
        bool allowProfileReplacement = true,
        CancellationToken cancellationToken = default)
    {
        logger ??= DiscardLogger.Instance;
        var root = Path.GetFullPath(dataRoot);
        var staging = Path.Combine(root, ProfileBackupService.RestoreStagingDirectoryName);
        var journalPath = Path.Combine(staging, ProfileBackupService.RestoreJournalFileName);
        if (File.Exists(journalPath))
        {
            if (!allowProfileReplacement)
            {
                throw new InvalidOperationException(
                    $"Mnemo cannot recover the interrupted restore in '{Path.Combine(root, RecoveryDirectoryName)}' while another instance is running.");
            }

            var recoveryStatus = await RecoverInterruptedAsync(root, staging, journalPath, logger, cancellationToken)
                .ConfigureAwait(false);
            if (recoveryStatus is not null)
                return recoveryStatus;
        }

        var pendingPath = Path.Combine(staging, ProfileBackupService.PendingRestoreFileName);
        if (!File.Exists(pendingPath))
            return null;

        ProfileBackupService.PendingRestore pending;
        try
        {
            pending = JsonSerializer.Deserialize<ProfileBackupService.PendingRestore>(
                await File.ReadAllTextAsync(pendingPath, cancellationToken).ConfigureAwait(false),
                ProfileBackupArchive.SerializerOptions)
                ?? throw new InvalidDataException("The pending restore request is empty.");
            ValidatePending(pending);
            if (DateTimeOffset.UtcNow - pending.StagedAtUtc > PendingLifetime)
                throw new InvalidDataException("The pending restore request expired before it could be applied.");
        }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or IOException or UnauthorizedAccessException)
        {
            ProfileBackupService.TryDeleteFile(pendingPath, logger);
            CleanupStagingArtifacts(staging, logger);
            return await RecordFailureAsync(staging, null, "restore_request_invalid", ex, logger, cancellationToken)
                .ConfigureAwait(false);
        }

        var archivePath = Path.Combine(staging, pending.ArchiveFileName);
        if (!allowProfileReplacement)
        {
            ProfileBackupService.TryDeleteFile(pendingPath, logger);
            ProfileBackupService.TryDeleteFile(archivePath, logger);
            return await RecordFailureAsync(
                    staging,
                    null,
                    "restore_instance_running",
                    new InvalidOperationException("Another Mnemo instance was using this data folder."),
                    logger,
                    cancellationToken)
                .ConfigureAwait(false);
        }

        var extraction = Path.Combine(staging, "apply-" + pending.OperationId);
        var recoveryName = $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}-{pending.OperationId}";
        var recovery = Path.Combine(root, RecoveryDirectoryName, recoveryName);
        RestoreJournal? journal = null;

        try
        {
            ProfileBackupService.TryDeleteDirectory(extraction, logger);
            Directory.CreateDirectory(extraction);
            var manifest = await ProfileBackupArchive.ValidateAsync(
                archivePath,
                currentAppVersion,
                extractionDirectory: extraction,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            await ProfileBackupDatabase.ValidateAsync(
                    Path.Combine(extraction, ProfileBackupArchive.DatabasePath), cancellationToken)
                .ConfigureAwait(false);

            Directory.CreateDirectory(recovery);
            var existing = ExistingTargets(root).ToArray();
            journal = new RestoreJournal(
                pending.OperationId,
                pending.ArchiveFileName,
                recoveryName,
                existing,
                RestorePhase.Prepared,
                manifest.CreatedAtUtc,
                manifest.CreatedByAppVersion);
            await WriteJournalAsync(journalPath, journal, cancellationToken).ConfigureAwait(false);

            journal = journal with { Phase = RestorePhase.Installing };
            await WriteJournalAsync(journalPath, journal, cancellationToken).ConfigureAwait(false);
            MoveCurrentToRecovery(root, recovery, existing);
            InstallExtracted(root, extraction);

            journal = journal with { Phase = RestorePhase.Committed };
            await WriteJournalAsync(journalPath, journal, cancellationToken).ConfigureAwait(false);
            ProfileBackupService.TryDeleteFile(pendingPath, logger);
            ProfileBackupService.TryDeleteFile(archivePath, logger);
            ProfileBackupService.TryDeleteDirectory(extraction, logger);
            var status = new RestoreStatus(
                true,
                "restore_complete",
                recoveryName,
                null,
                manifest.CreatedAtUtc,
                manifest.CreatedByAppVersion);
            await WriteStatusAsync(staging, status, cancellationToken).ConfigureAwait(false);
            ProfileBackupService.TryDeleteFile(journalPath, logger);
            PruneRecoveries(root, recoveryName, logger);
            logger.Info(LogCategory, $"Restored the profile and retained recovery copy {recoveryName}.");
            return status;
        }
        catch (Exception ex)
        {
            if (journal is not null)
            {
                try
                {
                    Rollback(root, recovery, journal.ExistingTargets);
                    ProfileBackupService.TryDeleteFile(journalPath, logger);
                }
                catch (Exception rollbackException)
                {
                    logger.Critical(LogCategory, $"Restore rollback failed. Recovery directory: {recovery}", rollbackException);
                    throw new InvalidOperationException(
                        $"Mnemo could not roll back the profile restore. Recovery directory: {recovery}",
                        new AggregateException(ex, rollbackException));
                }
            }

            ProfileBackupService.TryDeleteFile(pendingPath, logger);
            ProfileBackupService.TryDeleteFile(archivePath, logger);
            ProfileBackupService.TryDeleteDirectory(extraction, logger);
            return await RecordFailureAsync(
                    staging, recoveryName, "restore_failed", ex, logger, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    public static RestoreStatus? ReadStatus(string dataRoot)
    {
        var path = Path.Combine(dataRoot, ProfileBackupService.RestoreStagingDirectoryName, StatusFileName);
        if (!File.Exists(path))
            return null;
        try
        {
            return JsonSerializer.Deserialize<RestoreStatus>(File.ReadAllText(path), ProfileBackupArchive.SerializerOptions);
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static RestoreStatus? ConsumeStatus(string dataRoot, ILoggerService logger)
    {
        var path = Path.Combine(dataRoot, ProfileBackupService.RestoreStagingDirectoryName, StatusFileName);
        var status = ReadStatus(dataRoot);
        if (File.Exists(path))
            ProfileBackupService.TryDeleteFile(path, logger);
        return status;
    }

    private static async Task<RestoreStatus?> RecoverInterruptedAsync(
        string root,
        string staging,
        string journalPath,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        RestoreJournal journal;
        try
        {
            journal = JsonSerializer.Deserialize<RestoreJournal>(
                await File.ReadAllTextAsync(journalPath, cancellationToken).ConfigureAwait(false),
                ProfileBackupArchive.SerializerOptions)
                ?? throw new InvalidDataException("The restore recovery journal is empty.");
            ValidateJournal(journal);
        }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or IOException or UnauthorizedAccessException)
        {
            QuarantineJournal(journalPath, logger);
            ProfileBackupService.TryDeleteFile(
                Path.Combine(staging, ProfileBackupService.PendingRestoreFileName), logger);
            CleanupStagingArtifacts(staging, logger);
            return await RecordFailureAsync(
                    staging, null, "restore_journal_invalid", ex, logger, cancellationToken)
                .ConfigureAwait(false);
        }

        RestoreStatus status;
        if (journal.Phase == RestorePhase.Committed)
        {
            status = new RestoreStatus(
                true,
                "restore_complete",
                journal.RecoveryDirectoryName,
                null,
                journal.BackupCreatedAtUtc,
                journal.BackupAppVersion);
            logger.Info(LogCategory, $"Completed cleanup for committed restore {journal.OperationId}.");
        }
        else
        {
            var recovery = Path.Combine(root, RecoveryDirectoryName, journal.RecoveryDirectoryName);
            try
            {
                Rollback(root, recovery, journal.ExistingTargets);
            }
            catch (Exception ex)
            {
                logger.Critical(LogCategory, $"Interrupted restore rollback failed. Recovery directory: {recovery}", ex);
                throw new InvalidOperationException(
                    $"Mnemo could not recover an interrupted profile restore. Recovery directory: {recovery}", ex);
            }

            status = new RestoreStatus(
                false,
                "restore_interrupted_rolled_back",
                journal.RecoveryDirectoryName,
                "An interrupted restore was rolled back.");
            logger.Warning(LogCategory, $"Rolled back interrupted restore {journal.OperationId}.");
        }

        ProfileBackupService.TryDeleteFile(
            Path.Combine(staging, ProfileBackupService.PendingRestoreFileName), logger);
        ProfileBackupService.TryDeleteFile(Path.Combine(staging, journal.ArchiveFileName), logger);
        ProfileBackupService.TryDeleteDirectory(Path.Combine(staging, "apply-" + journal.OperationId), logger);
        await WriteStatusAsync(staging, status, cancellationToken).ConfigureAwait(false);
        ProfileBackupService.TryDeleteFile(journalPath, logger);
        if (status.Success)
            PruneRecoveries(root, journal.RecoveryDirectoryName, logger);
        return status;
    }

    private static IEnumerable<string> ExistingTargets(string root)
    {
        foreach (var file in new[] { "mnemo.db", "mnemo.db-wal", "mnemo.db-shm" })
        {
            if (File.Exists(Path.Combine(root, file)))
                yield return file;
        }
        foreach (var directory in ProfileBackupService.ManagedDirectoryNames)
        {
            if (Directory.Exists(Path.Combine(root, directory)))
                yield return directory;
        }
    }

    private static void MoveCurrentToRecovery(string root, string recovery, IReadOnlyList<string> existing)
    {
        foreach (var name in existing)
        {
            var source = Path.Combine(root, name);
            var destination = Path.Combine(recovery, name);
            if (File.Exists(source))
                File.Move(source, destination);
            else if (Directory.Exists(source))
                Directory.Move(source, destination);
        }
    }

    private static void InstallExtracted(string root, string extraction)
    {
        File.Move(Path.Combine(extraction, ProfileBackupArchive.DatabasePath), Path.Combine(root, "mnemo.db"));
        var assets = Path.Combine(extraction, "assets");
        foreach (var name in ProfileBackupService.ManagedDirectoryNames)
        {
            var source = Path.Combine(assets, name);
            if (Directory.Exists(source))
                Directory.Move(source, Path.Combine(root, name));
        }
    }

    private static void Rollback(string root, string recovery, IReadOnlyList<string> existing)
    {
        var original = new HashSet<string>(existing, StringComparer.Ordinal);
        foreach (var target in new[] { "mnemo.db", "mnemo.db-wal", "mnemo.db-shm" }
                     .Concat(ProfileBackupService.ManagedDirectoryNames))
        {
            var current = Path.Combine(root, target);
            var saved = Path.Combine(recovery, target);
            if (!original.Contains(target))
            {
                if (File.Exists(current)) File.Delete(current);
                else if (Directory.Exists(current)) Directory.Delete(current, recursive: true);
                continue;
            }

            if (File.Exists(saved) || Directory.Exists(saved))
            {
                if (File.Exists(current)) File.Delete(current);
                else if (Directory.Exists(current)) Directory.Delete(current, recursive: true);
                if (File.Exists(saved)) File.Move(saved, current);
                else Directory.Move(saved, current);
                continue;
            }

            if (!File.Exists(current) && !Directory.Exists(current))
                throw new InvalidDataException($"The restore recovery copy is missing '{target}'.");
        }
    }

    private static void ValidatePending(ProfileBackupService.PendingRestore pending)
    {
        if (!ProfileBackupService.IsOperationId(pending.OperationId) ||
            pending.StagedAtUtc == default || pending.StagedAtUtc > DateTimeOffset.UtcNow.AddMinutes(5) ||
            Path.GetFileName(pending.ArchiveFileName) != pending.ArchiveFileName ||
            pending.ArchiveFileName != pending.OperationId + ".mnemo-backup")
        {
            throw new InvalidDataException("The pending restore request is malformed.");
        }
    }

    private static void ValidateJournal(RestoreJournal journal)
    {
        var allowedTargets = new HashSet<string>(
            new[] { "mnemo.db", "mnemo.db-wal", "mnemo.db-shm" }
                .Concat(ProfileBackupService.ManagedDirectoryNames),
            StringComparer.Ordinal);
        if (!ProfileBackupService.IsOperationId(journal.OperationId) ||
            Path.GetFileName(journal.ArchiveFileName) != journal.ArchiveFileName ||
            journal.ArchiveFileName != journal.OperationId + ".mnemo-backup" ||
            string.IsNullOrWhiteSpace(journal.RecoveryDirectoryName) ||
            journal.RecoveryDirectoryName is "." or ".." ||
            Path.GetFileName(journal.RecoveryDirectoryName) != journal.RecoveryDirectoryName ||
            !journal.RecoveryDirectoryName.EndsWith("-" + journal.OperationId, StringComparison.Ordinal) ||
            journal.ExistingTargets is null ||
            journal.ExistingTargets.Distinct(StringComparer.Ordinal).Count() != journal.ExistingTargets.Count ||
            journal.ExistingTargets.Any(name => !allowedTargets.Contains(name)) ||
            !Enum.IsDefined(journal.Phase))
        {
            throw new InvalidDataException("The restore recovery journal is malformed.");
        }
    }

    private static void QuarantineJournal(string path, ILoggerService logger)
    {
        var quarantine = Path.Combine(
            Path.GetDirectoryName(path)!, $"operation.invalid-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.json");
        try
        {
            File.Move(path, quarantine);
            logger.Error(LogCategory, $"Quarantined an unreadable restore journal at {quarantine}.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.Error(LogCategory, $"Could not quarantine the unreadable restore journal at {path}.", ex);
        }
    }

    private static void PruneRecoveries(string root, string keep, ILoggerService logger)
    {
        var directory = Path.Combine(root, RecoveryDirectoryName);
        if (!Directory.Exists(directory))
            return;
        foreach (var path in Directory.EnumerateDirectories(directory))
        {
            if (string.Equals(Path.GetFileName(path), keep, StringComparison.Ordinal))
                continue;
            ProfileBackupService.TryDeleteDirectory(path, logger);
        }
    }

    private static void CleanupStagingArtifacts(string staging, ILoggerService logger)
    {
        foreach (var path in Directory.EnumerateFiles(staging, "*.mnemo-backup"))
            ProfileBackupService.TryDeleteFile(path, logger);
        foreach (var path in Directory.EnumerateFiles(staging, "*.part"))
            ProfileBackupService.TryDeleteFile(path, logger);
        foreach (var path in Directory.EnumerateDirectories(staging, "apply-*"))
            ProfileBackupService.TryDeleteDirectory(path, logger);
    }

    private static async Task<RestoreStatus> RecordFailureAsync(
        string staging,
        string? recoveryName,
        string code,
        Exception error,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        var status = new RestoreStatus(false, code, recoveryName, error.Message);
        await WriteStatusAsync(staging, status, cancellationToken).ConfigureAwait(false);
        logger.Error(LogCategory, $"Profile restore failed with {code}.", error);
        return status;
    }

    private static Task WriteJournalAsync(
        string path,
        RestoreJournal journal,
        CancellationToken cancellationToken) =>
        WriteAtomicJsonAsync(path, journal, cancellationToken);

    private static Task WriteStatusAsync(
        string staging,
        RestoreStatus status,
        CancellationToken cancellationToken) =>
        WriteAtomicJsonAsync(Path.Combine(staging, StatusFileName), status, cancellationToken);

    private static async Task WriteAtomicJsonAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var pending = path + ".part";
        await File.WriteAllTextAsync(
            pending, JsonSerializer.Serialize(value, ProfileBackupArchive.SerializerOptions), cancellationToken)
            .ConfigureAwait(false);
        await using (var stream = new FileStream(pending, FileMode.Open, FileAccess.ReadWrite, FileShare.Read))
            stream.Flush(flushToDisk: true);
        File.Move(pending, path, overwrite: true);
    }

    private enum RestorePhase
    {
        Prepared,
        Installing,
        Committed,
    }

    private sealed record RestoreJournal(
        string OperationId,
        string ArchiveFileName,
        string RecoveryDirectoryName,
        IReadOnlyList<string> ExistingTargets,
        RestorePhase Phase,
        DateTimeOffset? BackupCreatedAtUtc = null,
        string? BackupAppVersion = null);

    public sealed record RestoreStatus(
        bool Success,
        string Code,
        string? RecoveryDirectoryName,
        string? Error,
        DateTimeOffset? BackupCreatedAtUtc = null,
        string? BackupAppVersion = null);

    private sealed class DiscardLogger : ILoggerService
    {
        public static readonly DiscardLogger Instance = new();

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
