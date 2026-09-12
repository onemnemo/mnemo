using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Transfer;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.ProfileBackup;

namespace Mnemo.Host.Backup;

public static class ProfileBackupEndpoints
{
    private const string ContentType = "application/vnd.mnemo.backup+zip";
    private const string LogCategory = "App.Backup";

    public static void MapProfileBackup(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/backups/export", ExportAsync);
        endpoints.MapPost("/api/backups/select", SelectAsync);
        endpoints.MapPost("/api/backups/restore", RestoreAsync);
        endpoints.MapPost("/api/backups/restore/restart", RestartAsync);
        endpoints.MapGet("/api/backups/restore/{operationId}/state", RestoreState);
        endpoints.MapDelete("/api/backups/restore/{operationId}", CancelRestoreAsync);
        endpoints.MapGet("/api/backups/restore-status", (ILoggerService logger) =>
            ProfileRestoreStartup.ConsumeStatus(MnemoAppPaths.GetLocalUserDataRoot(), logger) is { } status
                ? Results.Ok(status)
                : Results.NoContent());
    }

    private static async Task<IResult> ExportAsync(
        BackupExportRequest body,
        IProfileBackupService backups,
        IUpdateService updates,
        ExportGrants grants,
        ISettingsService settings,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        if (ExportDestination.Claim(body.Grant, grants, out var target) is { } refusal)
            return refusal;

        var path = ExportDestination.PathFor(target, ".mnemo-backup");
        try
        {
            await backups.CreateAsync(path, updates.CurrentDisplayVersion, cancellationToken).ConfigureAwait(false);
            if (target is not null)
                return await ExportDestination.CommitAsync(target, path, settings).ConfigureAwait(false);

            var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024,
                FileOptions.DeleteOnClose | FileOptions.Asynchronous);
            return Results.File(stream, ContentType);
        }
        catch (OperationCanceledException)
        {
            ExportDestination.Discard(path);
            throw;
        }
        catch (ProfileBackupException ex)
        {
            ExportDestination.Discard(path);
            logger.Warning(LogCategory, $"Backup failed with {ex.Code}: {ex.Message}");
            return Results.Json(new ErrorDto(ex.Code, ex.Message), statusCode: StatusCodes.Status409Conflict);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SqliteException)
        {
            if (target is not null)
                return ExportDestination.Failed(target, path, logger, LogCategory, ex);
            ExportDestination.Discard(path);
            return Results.Json(
                new ErrorDto("backup_failed", "Mnemo could not create the backup."),
                statusCode: StatusCodes.Status409Conflict);
        }
    }

    private static async Task<IResult> SelectAsync(
        BackupSelectRequest body,
        NativeFileDialogs dialogs,
        IProfileBackupService backups,
        IUpdateService updates,
        ProfileRestoreGrants grants,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        if (!dialogs.IsAvailable)
            return Results.Ok(new BackupSelectionResponse(false, true, null, null));

        if (string.IsNullOrWhiteSpace(body.Title))
            return Results.BadRequest(new ErrorDto("invalid_title", "A dialog title is required."));

        var selected = await dialogs.PickOpenFileAsync(
            body.Title.Trim(), "mnemo-backup", ["mnemo-backup"]).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(selected))
            return Results.Ok(new BackupSelectionResponse(true, true, null, null));

        try
        {
            var inspection = await backups.InspectAsync(selected, updates.CurrentDisplayVersion, cancellationToken)
                .ConfigureAwait(false);
            return Results.Ok(new BackupSelectionResponse(
                true,
                false,
                grants.Issue(selected),
                BackupInspectionResponse.From(inspection)));
        }
        catch (ProfileBackupException ex)
        {
            logger.Warning(LogCategory, $"Backup inspection failed with {ex.Code}: {ex.Message}");
            return Results.Json(new ErrorDto(ex.Code, ex.Message), statusCode: StatusCodes.Status400BadRequest);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SqliteException or InvalidCastException)
        {
            logger.Error(LogCategory, "Could not inspect the selected profile backup.", ex);
            return Results.Json(
                new ErrorDto("backup_inspection_failed", "Mnemo could not inspect the selected backup."),
                statusCode: StatusCodes.Status409Conflict);
        }
    }

    private static async Task<IResult> RestoreAsync(
        BackupRestoreRequest body,
        ProfileRestoreGrants grants,
        IProfileBackupService backups,
        IUpdateService updates,
        ILoggerService logger,
        CancellationToken cancellationToken)
    {
        if (!grants.TryConsume(body.Grant, out var selected))
            return Results.BadRequest(new ErrorDto("unknown_backup_grant", "That backup selection has lapsed."));

        try
        {
            var staged = await backups.StageRestoreAsync(selected!, updates.CurrentDisplayVersion, cancellationToken)
                .ConfigureAwait(false);
            return Results.Accepted(value: staged);
        }
        catch (ProfileBackupException ex)
        {
            logger.Warning(LogCategory, $"Backup restore staging failed with {ex.Code}: {ex.Message}");
            return Results.Json(new ErrorDto(ex.Code, ex.Message), statusCode: StatusCodes.Status400BadRequest);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SqliteException or InvalidCastException)
        {
            logger.Error(LogCategory, "Could not stage the profile restore.", ex);
            return Results.Json(
                new ErrorDto("restore_stage_failed", "Mnemo could not prepare the backup for restore."),
                statusCode: StatusCodes.Status409Conflict);
        }
    }

    private static IResult RestartAsync(
        BackupRestartRequest body,
        IProfileBackupService backups,
        AppRestartCoordinator restart)
    {
        if (!backups.IsRestoreStaged(body.OperationId))
            return Results.BadRequest(new ErrorDto("restore_not_staged", "That prepared restore is no longer available."));
        if (!restart.Available || !restart.Request())
        {
            return Results.Json(
                new ErrorDto("restart_unavailable", "Restart Mnemo to finish restoring the backup."),
                statusCode: StatusCodes.Status409Conflict);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> CancelRestoreAsync(
        string operationId,
        IProfileBackupService backups,
        CancellationToken cancellationToken) =>
        await backups.CancelStagedRestoreAsync(operationId, cancellationToken).ConfigureAwait(false)
            ? Results.NoContent()
            : Results.NotFound(new ErrorDto("restore_not_staged", "That prepared restore is no longer available."));

    private static IResult RestoreState(
        string operationId,
        IProfileBackupService backups,
        AppRestartCoordinator restart) =>
        Results.Ok(new BackupRestoreStateResponse(
            backups.IsRestoreStaged(operationId),
            restart.Requested));

    public sealed record BackupExportRequest(string? Grant);
    public sealed record BackupSelectRequest(string Title);
    public sealed record BackupRestoreRequest(string? Grant);
    public sealed record BackupRestartRequest(string? OperationId);
    public sealed record BackupRestoreStateResponse(bool Staged, bool RestartRequested);
    public sealed record BackupSelectionResponse(
        bool Available,
        bool Cancelled,
        string? Grant,
        BackupInspectionResponse? Inspection);

    public sealed record BackupInspectionResponse(
        DateTimeOffset CreatedAtUtc,
        string CreatedByAppVersion,
        bool FromThisCollection,
        ProfileBackupContentSummary Contents)
    {
        public static BackupInspectionResponse From(ProfileBackupInspection inspection) => new(
            inspection.Manifest.CreatedAtUtc,
            inspection.Manifest.CreatedByAppVersion,
            inspection.FromThisCollection,
            inspection.Manifest.Contents);
    }
}
