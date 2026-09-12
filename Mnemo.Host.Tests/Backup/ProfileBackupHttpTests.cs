using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Backup;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.ProfileBackup;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Backup;

public sealed class ProfileBackupHttpTests : IAsyncDisposable
{
    private readonly FakeBackups _backups = new();
    private readonly WebApplication _app;
    private HttpClient? _client;
    private bool _started;

    public ProfileBackupHttpTests()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton<ILoggerService>(new SilentLogger());
        builder.Services.AddSingleton<IProfileBackupService>(_backups);
        builder.Services.AddSingleton<IUpdateService>(new FakeUpdates());
        builder.Services.AddSingleton<ISettingsService>(new MemorySettings());
        builder.Services.AddSingleton<NativeFileDialogs>();
        builder.Services.AddSingleton<ExportGrants>();
        builder.Services.AddSingleton(new ProfileRestoreGrants(TimeProvider.System));
        builder.Services.AddSingleton<AppRestartCoordinator>();

        _app = builder.Build();
        _app.MapProfileBackup();
    }

    [Fact]
    public async Task RestoreStatus_ReturnsNoContentWhenThereIsNoOutcome()
    {
        DeleteStatus();

        var response = await (await ClientAsync()).GetAsync("/api/backups/restore-status");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task RestoreStatus_ReturnsAndConsumesTheOutcome()
    {
        var staging = StagingDirectory();
        Directory.CreateDirectory(staging);
        await File.WriteAllTextAsync(
            Path.Combine(staging, ProfileRestoreStartup.StatusFileName),
            JsonSerializer.Serialize(
                new ProfileRestoreStartup.RestoreStatus(
                    true,
                    "restore_complete",
                    "recovery-copy",
                    null,
                    new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero),
                    "0.8.0-beta"),
                ProfileBackupArchive.SerializerOptions));

        var client = await ClientAsync();
        var first = await client.GetAsync("/api/backups/restore-status");
        var second = await client.GetAsync("/api/backups/restore-status");

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Contains("\"success\":true", await first.Content.ReadAsStringAsync());
        Assert.Contains("\"recoveryDirectoryName\":\"recovery-copy\"", await first.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
    }

    [Fact]
    public async Task CancelRestore_UsesTheOperationNamedByTheRoute()
    {
        _backups.CancelResult = true;

        var response = await (await ClientAsync()).DeleteAsync("/api/backups/restore/abc123");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("abc123", _backups.CancelledOperationId);
    }

    [Fact]
    public async Task RestoreState_ReportsWhetherTheNamedOperationIsStillStaged()
    {
        _backups.StagedOperationId = "abc123";

        var response = await (await ClientAsync()).GetAsync("/api/backups/restore/abc123/state");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            "{\"staged\":true,\"restartRequested\":false}",
            await response.Content.ReadAsStringAsync());
    }

    private async Task<HttpClient> ClientAsync()
    {
        if (!_started)
        {
            await _app.StartAsync();
            _started = true;
        }
        return _client ??= _app.GetTestClient();
    }

    private static string StagingDirectory() => Path.Combine(
        MnemoAppPaths.GetLocalUserDataRoot(), ProfileBackupService.RestoreStagingDirectoryName);

    private static void DeleteStatus()
    {
        var path = Path.Combine(StagingDirectory(), ProfileRestoreStartup.StatusFileName);
        if (File.Exists(path))
            File.Delete(path);
    }

    public async ValueTask DisposeAsync()
    {
        DeleteStatus();
        _client?.Dispose();
        if (_started)
            await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private sealed class FakeBackups : IProfileBackupService
    {
        public bool CancelResult { get; set; }
        public string? StagedOperationId { get; set; }
        public string? CancelledOperationId { get; private set; }

        public Task<ProfileBackupManifest> CreateAsync(
            string outputFilePath, string appVersion, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<ProfileBackupInspection> InspectAsync(
            string backupFilePath, string currentAppVersion, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<ProfileRestoreStage> StageRestoreAsync(
            string backupFilePath, string currentAppVersion, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public bool IsRestoreStaged(string? operationId) => operationId == StagedOperationId;

        public Task<bool> CancelStagedRestoreAsync(
            string? operationId, CancellationToken cancellationToken = default)
        {
            CancelledOperationId = operationId;
            return Task.FromResult(CancelResult);
        }
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }

    private sealed class MemorySettings : ISettingsService
    {
        public event EventHandler<string>? SettingChanged;

        public Task<T> GetAsync<T>(string key, T defaultValue = default!) => Task.FromResult(defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string key) => Task.FromResult(false);
    }

    private sealed class FakeUpdates : IUpdateService
    {
        public bool SupportsInAppApply => false;
        public string CurrentDisplayVersion => "0.8.0-beta";

        public Task<string> GetChannelAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult("stable");

        public Task<Result<AppUpdateInfo?>> CheckForUpdatesAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<AppUpdateInfo?>.Success(null));

        public Task<Result> DownloadUpdatesAsync(
            AppUpdateInfo update,
            IProgress<int>? progress,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Result.Failure("Updates are unavailable in this test."));

        public Result ApplyUpdatesAndRestart() => Result.Failure("Updates are unavailable in this test.");
    }
}
