using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Events;
using Mnemo.Host.Updates;
using Mnemo.Infrastructure.Services.Updates;
using Xunit;

namespace Mnemo.Host.Tests.Updates;

/// <summary>
/// The check / download / apply state machine.
/// <para>
/// Most of what is pinned here is the coordinator declining to do something: not checking
/// when the user turned automatic checks off, not re-checking over a download the user is
/// waiting on, not offering to restart into an update that was never downloaded. Those are
/// the cases with no visible symptom when they go wrong, because the app carries on and
/// only does the wrong amount of work.
/// </para>
/// </summary>
public sealed class UpdateCoordinatorTests
{
    [Fact]
    public async Task TheStatusDescribesTheRunningBuildBeforeAnythingIsChecked()
    {
        var world = new World();

        var status = await world.Coordinator.GetStatusAsync();

        Assert.Equal(UpdateStage.Idle, status.Stage);
        Assert.Equal("0.8.0", status.Version);
        Assert.Equal(UpdateChannels.Stable, status.Channel);
        Assert.Null(status.LastCheckedUtc);
        Assert.Equal(0, world.Updates.Checks);
    }

    [Fact]
    public async Task ABetaBuildOnStableIsWaitingRatherThanUpToDate()
    {
        // Saying "you have the newest version" to someone running 0.9.0-beta.1 would be a
        // lie: Stable has nothing for them until it reaches 0.9.0.
        var world = new World();
        world.Updates.CurrentDisplayVersion = "0.9.0-beta.1+3f2a1b9";

        Assert.True((await world.Coordinator.GetStatusAsync()).AwaitingChannelCatchUp);

        world.Updates.Channel = UpdateChannels.Beta;
        Assert.False((await world.Coordinator.GetStatusAsync()).AwaitingChannelCatchUp);
    }

    [Fact]
    public async Task AFoundUpdateIsReportedWithItsVersionAndNotes()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", "Fixed the thing.", null, false);

        var status = await world.Coordinator.CheckAsync(automatic: false);

        Assert.Equal(UpdateStage.Available, status.Stage);
        Assert.Equal("0.9.0", status.AvailableVersion);
        Assert.Equal("Fixed the thing.", status.ReleaseNotesMarkdown);
        Assert.NotNull(status.LastCheckedUtc);
    }

    [Fact]
    public async Task AnEmptyAnswerIsUpToDate()
    {
        var world = new World();

        var status = await world.Coordinator.CheckAsync(automatic: false);

        Assert.Equal(UpdateStage.UpToDate, status.Stage);
        Assert.Null(status.AvailableVersion);
    }

    [Fact]
    public async Task AFailedCheckSaysSoAndStillCountsAsAnAttempt()
    {
        var world = new World();
        world.Updates.CheckFailure = "Feed unreachable.";

        var status = await world.Coordinator.CheckAsync(automatic: false);

        Assert.Equal(UpdateStage.Failed, status.Stage);
        Assert.Equal("check_failed", status.Error);
        // Recorded even though it failed, so a machine with no network does not retry on
        // every launch of a long session.
        Assert.NotNull(status.LastCheckedUtc);
    }

    [Fact]
    public async Task AnAutomaticCheckObeysTheSettingAndAManualOneDoesNot()
    {
        var world = new World();
        await world.Settings.SetAsync(UpdateSettingsKeys.AutoCheck, false);

        await world.Coordinator.CheckAsync(automatic: true);
        Assert.Equal(0, world.Updates.Checks);

        await world.Coordinator.CheckAsync(automatic: false);
        Assert.Equal(1, world.Updates.Checks);
    }

    [Fact]
    public async Task AnAutomaticCheckWaitsOutTheCooldownAndAManualOneDoesNot()
    {
        var world = new World();
        await world.Settings.SetAsync<DateTime?>(
            UpdateSettingsKeys.LastCheckedUtc,
            DateTime.UtcNow - UpdateCoordinator.AutoCheckCooldown + TimeSpan.FromMinutes(5));

        await world.Coordinator.CheckAsync(automatic: true);
        Assert.Equal(0, world.Updates.Checks);

        await world.Coordinator.CheckAsync(automatic: false);
        Assert.Equal(1, world.Updates.Checks);
    }

    [Fact]
    public async Task AnAutomaticCheckRunsOnceTheCooldownHasPassed()
    {
        var world = new World();
        await world.Settings.SetAsync<DateTime?>(
            UpdateSettingsKeys.LastCheckedUtc,
            DateTime.UtcNow - UpdateCoordinator.AutoCheckCooldown - TimeSpan.FromMinutes(1));

        await world.Coordinator.CheckAsync(automatic: true);

        Assert.Equal(1, world.Updates.Checks);
    }

    [Fact]
    public async Task ChangingChannelForgetsWhatThePreviousOneFound()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0-beta.2", null, null, false);
        world.Updates.Channel = UpdateChannels.Beta;
        Assert.Equal(UpdateStage.Available, (await world.Coordinator.CheckAsync(automatic: false)).Stage);

        world.Updates.Channel = UpdateChannels.Stable;
        var status = await world.Coordinator.GetStatusAsync();

        // Offering a beta build to someone who has just moved to Stable would install the
        // one thing they asked to stop receiving.
        Assert.Equal(UpdateStage.Idle, status.Stage);
        Assert.Null(status.AvailableVersion);
    }

    [Fact]
    public async Task ChangingChannelKeepsADownloadThatHasAlreadyFinished()
    {
        var world = new World();
        world.Updates.Channel = UpdateChannels.Beta;
        await world.ReachReady();

        world.Updates.Channel = UpdateChannels.Stable;
        var status = await world.Coordinator.GetStatusAsync();

        // Those bytes are on disk and the user asked for them. Discarding a finished
        // download because a dropdown moved is the worse surprise.
        Assert.Equal(UpdateStage.Ready, status.Stage);
        Assert.True(world.Coordinator.CanApply);
    }

    [Fact]
    public async Task ADownloadInFlightIsNotRestartedByAnotherRequest()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: false);

        await world.Coordinator.BeginDownloadAsync();
        await world.Updates.DownloadStarted.Task;
        await world.Coordinator.BeginDownloadAsync();
        await world.Coordinator.CheckAsync(automatic: false);

        Assert.Equal(1, world.Updates.Downloads);
        // Re-checking would resolve a new update object and discard the one being written.
        Assert.Equal(1, world.Updates.Checks);
    }

    [Fact]
    public async Task ADownloadReportsProgressAndEndsReady()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: false);

        var started = await world.Coordinator.BeginDownloadAsync();
        Assert.Equal(UpdateStage.Downloading, started.Stage);

        await world.Updates.DownloadStarted.Task;
        world.Updates.Progress!.Report(40);
        await world.Events.WaitFor(s => s.DownloadProgress == 40);

        world.Updates.FinishDownload(Result.Success());
        var ready = await world.Events.WaitFor(s => s.Stage == UpdateStage.Ready);

        Assert.Equal(100, ready.DownloadProgress);
        Assert.True(world.Coordinator.CanApply);
    }

    [Fact]
    public async Task AFailedDownloadIsToldApartFromAFailedCheck()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: false);

        await world.Coordinator.BeginDownloadAsync();
        await world.Updates.DownloadStarted.Task;
        world.Updates.FinishDownload(Result.Failure("Disk full."));

        var failed = await world.Events.WaitFor(s => s.Stage == UpdateStage.Failed);
        // The two read differently to a user: one is worth retrying now, the other is not.
        Assert.Equal("download_failed", failed.Error);
        Assert.False(world.Coordinator.CanApply);
    }

    [Fact]
    public async Task NothingIsDownloadedWithoutAnUpdateToDownload()
    {
        var world = new World();

        var status = await world.Coordinator.BeginDownloadAsync();

        Assert.Equal(UpdateStage.Idle, status.Stage);
        Assert.Equal(0, world.Updates.Downloads);
    }

    [Fact]
    public async Task RestartingIsOnlyPossibleOnceTheBytesAreOnDisk()
    {
        var world = new World();
        Assert.False(world.Coordinator.CanApply);

        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: false);
        // An update that has been found is not one that can be installed.
        Assert.False(world.Coordinator.CanApply);

        await world.ReachReady();
        Assert.True(world.Coordinator.CanApply);

        await world.Coordinator.ApplyAsync();
        Assert.Equal(1, world.Updates.Applies);
    }

    [Fact]
    public async Task EveryTransitionIsPushedAsAWholeStatus()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);

        await world.Coordinator.CheckAsync(automatic: false);

        // A window that was not the one asking has to end up with the same object, so the
        // pushes carry the state rather than a hint to go and read it.
        Assert.Equal(
            [UpdateStage.Checking, UpdateStage.Available],
            world.Events.Statuses.ConvertAll(s => s.Stage));
        Assert.Equal("0.9.0", world.Events.Statuses[^1].AvailableVersion);
    }

    [Fact]
    public async Task AFoundUpdateIsWorthPromptingAboutUntilSomeoneSaysOtherwise()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);

        var status = await world.Coordinator.CheckAsync(automatic: true);

        Assert.True(status.ShouldPrompt);
        Assert.False(status.Skipped);
    }

    [Fact]
    public async Task NothingFoundIsNothingToPromptAbout()
    {
        var world = new World();

        var status = await world.Coordinator.CheckAsync(automatic: true);

        Assert.False(status.ShouldPrompt);
        Assert.False(status.Skipped);
    }

    [Fact]
    public async Task LaterHoldsThePromptOffWithoutHidingTheUpdate()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: true);

        var status = await world.Coordinator.SnoozeAsync();

        Assert.False(status.ShouldPrompt);
        // The row keeps offering it. "Not now" is not "never".
        Assert.Equal(UpdateStage.Available, status.Stage);
        Assert.Equal("0.9.0", status.AvailableVersion);
    }

    [Fact]
    public async Task ASnoozeSurvivesTheNextCheck()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: true);
        await world.Coordinator.SnoozeAsync();

        // The gate is re-read on every check, so a snooze that only lived in memory
        // would be spent by the next one rather than by the day it asked for.
        var status = await world.Coordinator.CheckAsync(automatic: false);

        Assert.False(status.ShouldPrompt);
    }

    [Fact]
    public async Task ASnoozeEndsAfterTwoLaunches()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: true);
        await world.Coordinator.SnoozeAsync();

        // One launch per process, which is why each takes its own coordinator over the
        // same settings.
        Assert.Equal(UpdateCoordinator.SnoozeLaunches, await world.Settings.GetAsync<int?>(UpdateSettingsKeys.SnoozeLaunchesRemaining));
        await world.NextLaunch().BeginLaunchAsync();
        await world.NextLaunch().BeginLaunchAsync();

        var status = await world.Coordinator.CheckAsync(automatic: false);
        Assert.True(status.ShouldPrompt);
    }

    [Fact]
    public async Task ALaunchSpendsOneSnoozeNoMatterHowOftenItIsReported()
    {
        var world = new World();
        await world.Settings.SetAsync(UpdateSettingsKeys.SnoozeLaunchesRemaining, 2);

        await world.Coordinator.BeginLaunchAsync();
        // A reload is not a launch: the window comes back, the process does not.
        await world.Coordinator.BeginLaunchAsync();

        Assert.Equal(1, await world.Settings.GetAsync<int?>(UpdateSettingsKeys.SnoozeLaunchesRemaining));
    }

    [Fact]
    public async Task SkippingStopsThePromptAndNotTheUpdate()
    {
        var world = new World();
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        await world.Coordinator.CheckAsync(automatic: true);

        var status = await world.Coordinator.SkipAvailableVersionAsync();

        Assert.True(status.Skipped);
        Assert.False(status.ShouldPrompt);
        Assert.Equal(UpdateStage.Available, status.Stage);
        Assert.Equal("0.9.0", await world.Settings.GetAsync<string?>(UpdateSettingsKeys.SkippedVersion));
    }

    [Fact]
    public async Task ASkipCoversOnlyTheVersionItWasAskedFor()
    {
        var world = new World();
        await world.Settings.SetAsync(UpdateSettingsKeys.SkippedVersion, "0.9.0");

        // Manual checks, because the second automatic one inside six hours would be
        // declined by the cooldown and answer with the first one's status.
        world.Updates.Available = new AppUpdateInfo("0.9.0", null, null, false);
        Assert.False((await world.Coordinator.CheckAsync(automatic: false)).ShouldPrompt);

        world.Updates.Available = new AppUpdateInfo("0.9.1", null, null, false);
        var status = await world.Coordinator.CheckAsync(automatic: false);

        // Skipping one release is not opting out of the next one.
        Assert.True(status.ShouldPrompt);
        Assert.False(status.Skipped);
    }

    [Fact]
    public async Task SkippingWithNothingFoundChangesNothing()
    {
        var world = new World();

        var status = await world.Coordinator.SkipAvailableVersionAsync();

        Assert.False(status.Skipped);
        Assert.Null(await world.Settings.GetAsync<string?>(UpdateSettingsKeys.SkippedVersion));
    }

    [Fact]
    public async Task TheVersionIsWrittenDownBeforeTheProcessIsReplaced()
    {
        var world = new World();
        await world.ReachReady();

        await world.Coordinator.ApplyAsync();

        // The only process that knows an update was applied is the one about to stop
        // existing, so the next build reads this rather than working it out.
        Assert.Equal("0.9.0", await world.Settings.GetAsync<string?>(UpdateSettingsKeys.PendingPostUpdateToastVersion));
    }

    [Fact]
    public async Task TheLaunchAfterAnUpdateSaysSoOnce()
    {
        var world = new World();
        await world.ReachReady();
        await world.Coordinator.ApplyAsync();

        var next = world.NextLaunch();
        Assert.Equal("0.9.0", await next.BeginLaunchAsync());
        // Cleared as it is read: a marker left on disk would say it again every launch.
        Assert.Null(await world.NextLaunch().BeginLaunchAsync());
    }

    [Fact]
    public async Task ALaunchThatDidNotComeOutOfAnUpdateSaysNothing()
    {
        var world = new World();

        Assert.Null(await world.Coordinator.BeginLaunchAsync());
    }

    /// <summary>The coordinator and the four things it talks to.</summary>
    private sealed class World
    {
        public FakeUpdates Updates { get; } = new();
        public FakeSettings Settings { get; } = new();
        public RecordingEvents Events { get; } = new();
        public UpdateCoordinator Coordinator { get; }

        public World() => Coordinator = new UpdateCoordinator(Updates, Settings, Events, new SilentLogger());

        /// <summary>
        /// A second coordinator over the same settings, standing in for the next run of the
        /// app. Launch bookkeeping happens once per process, so restarting is the only way
        /// to reach it twice.
        /// </summary>
        public UpdateCoordinator NextLaunch() => new(Updates, Settings, Events, new SilentLogger());

        /// <summary>Finds an update, downloads it and waits for the staged state.</summary>
        public async Task ReachReady()
        {
            Updates.Available ??= new AppUpdateInfo("0.9.0", null, null, false);
            await Coordinator.CheckAsync(automatic: false);
            await Coordinator.BeginDownloadAsync();
            await Updates.DownloadStarted.Task;
            Updates.FinishDownload(Result.Success());
            await Events.WaitFor(s => s.Stage == UpdateStage.Ready);
        }
    }

    private sealed class FakeUpdates : IUpdateService
    {
        public bool SupportsInAppApply { get; set; } = true;
        public string CurrentDisplayVersion { get; set; } = "0.8.0";
        public string Channel { get; set; } = UpdateChannels.Stable;

        public AppUpdateInfo? Available { get; set; }
        public string? CheckFailure { get; set; }
        public int Checks { get; private set; }
        public int Downloads { get; private set; }
        public int Applies { get; private set; }

        /// <summary>Completes when the download has been asked for, which happens off the request.</summary>
        public TaskCompletionSource<bool> DownloadStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public IProgress<int>? Progress { get; private set; }

        private readonly TaskCompletionSource<Result> _download = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void FinishDownload(Result result) => _download.TrySetResult(result);

        public Task<string> GetChannelAsync(CancellationToken cancellationToken = default) => Task.FromResult(Channel);

        public Task<Result<AppUpdateInfo?>> CheckForUpdatesAsync(CancellationToken cancellationToken = default)
        {
            Checks++;
            return Task.FromResult(CheckFailure is null
                ? Result<AppUpdateInfo?>.Success(Available)
                : Result<AppUpdateInfo?>.Failure(CheckFailure));
        }

        public Task<Result> DownloadUpdatesAsync(AppUpdateInfo update, IProgress<int>? progress, CancellationToken cancellationToken = default)
        {
            Downloads++;
            Progress = progress;
            DownloadStarted.TrySetResult(true);
            return _download.Task;
        }

        public void ApplyUpdatesAndRestart() => Applies++;
    }

    private sealed class RecordingEvents : IAppEventPublisher
    {
        private readonly object _lock = new();
        private readonly List<UpdateStatus> _statuses = [];

        public List<UpdateStatus> Statuses
        {
            get { lock (_lock) return [.. _statuses]; }
        }

        public void Publish(AppEvent evt)
        {
            Assert.Equal("update-status", evt.Type);
            lock (_lock)
                _statuses.Add(Assert.IsType<UpdateStatus>(evt.Data));
        }

        /// <summary>
        /// Waits for a pushed status to match. The download runs detached from the request
        /// that started it, so its transitions arrive on their own thread.
        /// </summary>
        public async Task<UpdateStatus> WaitFor(Func<UpdateStatus, bool> predicate)
        {
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed < TimeSpan.FromSeconds(5))
            {
                foreach (var status in Statuses)
                    if (predicate(status))
                        return status;

                await Task.Delay(10);
            }

            throw new TimeoutException($"No pushed status matched. Saw: {string.Join(", ", Statuses.ConvertAll(s => s.Stage.ToString()))}");
        }
    }

    private sealed class FakeSettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

        public event EventHandler<string>? SettingChanged;

        public Task<T> GetAsync<T>(string key, T defaultValue = default!)
        {
            if (!_values.TryGetValue(key, out var value) || value is null)
                return Task.FromResult(defaultValue);

            if (value is T typed)
                return Task.FromResult(typed);

            // A DateTime? is boxed as a plain DateTime, so a value written through the
            // nullable overload does not match the pattern above when read back.
            var target = Nullable.GetUnderlyingType(typeof(T));
            return Task.FromResult(target is not null && target.IsInstanceOfType(value) ? (T)value : defaultValue);
        }

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null) { }
    }
}
