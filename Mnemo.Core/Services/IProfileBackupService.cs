using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

public interface IProfileBackupService
{
    Task<ProfileBackupManifest> CreateAsync(
        string outputFilePath,
        string appVersion,
        CancellationToken cancellationToken = default);

    Task<ProfileBackupInspection> InspectAsync(
        string backupFilePath,
        string currentAppVersion,
        CancellationToken cancellationToken = default);

    Task<ProfileRestoreStage> StageRestoreAsync(
        string backupFilePath,
        string currentAppVersion,
        CancellationToken cancellationToken = default);

    bool IsRestoreStaged(string? operationId);

    Task<bool> CancelStagedRestoreAsync(
        string? operationId,
        CancellationToken cancellationToken = default);
}
