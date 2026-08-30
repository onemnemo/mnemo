using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// What every route that produces a file shares: it writes to the destination the user chose, and
/// it writes beside it rather than over it. The seam matters because the alternative it replaced
/// sent a package out to the page and took the same bytes back, so the checks here are that the
/// file goes straight to its place and that a failure leaves the last good export alone.
/// </summary>
public sealed class ExportDestinationTests : IDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("mnemo-export-destination").FullName;
    private readonly ExportGrants _grants = new();
    private readonly MemorySettings _settings = new();

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    private ExportTarget Target(string name = "deck.mnemo") =>
        new(_folder, Path.Combine(_folder, name));

    [Fact]
    public void CarriesOnWithNoDestinationWhenNothingWasChosen()
    {
        // A caller with nowhere to put a file is the dev server in a browser tab, and it gets the
        // bytes in the response as before rather than an error.
        Assert.Null(ExportDestination.Claim(null, _grants, out var target));
        Assert.Null(target);
    }

    [Fact]
    public void RefusesAGrantItNeverIssued()
    {
        Assert.NotNull(ExportDestination.Claim("not-a-token", _grants, out var target));
        Assert.Null(target);
    }

    [Fact]
    public void SpendsTheGrantOnceAndAnswersTheDestinationItStandsFor()
    {
        var token = _grants.Issue(Target());

        Assert.Null(ExportDestination.Claim(token, _grants, out var first));
        Assert.Equal(Target().FullPath, first!.FullPath);

        // The same token a second time is a write nobody chose.
        Assert.NotNull(ExportDestination.Claim(token, _grants, out var second));
        Assert.Null(second);
    }

    [Fact]
    public async Task LeavesTheOldExportIntactUntilTheNewOneIsFinished()
    {
        var target = Target();
        await File.WriteAllTextAsync(target.FullPath, "the last good export");

        var pending = ExportDestination.PathFor(target);
        await File.WriteAllTextAsync(pending, "half of a new one");

        // Still the old file: nothing has been committed yet.
        Assert.NotEqual(target.FullPath, pending);
        Assert.Equal("the last good export", await File.ReadAllTextAsync(target.FullPath));

        ExportDestination.Discard(pending);
        Assert.False(File.Exists(pending));
        Assert.Equal("the last good export", await File.ReadAllTextAsync(target.FullPath));
    }

    [Fact]
    public void MakesAFolderTheChooserNamedButNobodyCreated()
    {
        var fresh = Path.Combine(_folder, "Exports");
        var target = new ExportTarget(fresh, Path.Combine(fresh, "deck.mnemo"));

        var pending = ExportDestination.PathFor(target);

        Assert.True(Directory.Exists(fresh));
        Assert.Equal(fresh, Path.GetDirectoryName(pending));
    }

    [Fact]
    public async Task PutsTheFinishedFileInPlaceAndRemembersWhereItWent()
    {
        var target = Target();
        var pending = ExportDestination.PathFor(target);
        await File.WriteAllTextAsync(pending, "a whole export");

        await ExportDestination.CommitAsync(target, pending, _settings);

        Assert.False(File.Exists(pending));
        Assert.Equal("a whole export", await File.ReadAllTextAsync(target.FullPath));
        Assert.Equal(_folder, (await ExportFolders.ListAsync(_settings))[0]);
    }

    [Fact]
    public async Task ReplacesWhatWasThereBecauseTheChooserAlreadyAsked()
    {
        var target = Target();
        await File.WriteAllTextAsync(target.FullPath, "the old one");

        var pending = ExportDestination.PathFor(target);
        await File.WriteAllTextAsync(pending, "the new one");
        await ExportDestination.CommitAsync(target, pending, _settings);

        Assert.Equal("the new one", await File.ReadAllTextAsync(target.FullPath));
    }

    [Fact]
    public void StagesWellAwayFromTheUserWhenThereIsNoDestination()
    {
        var staged = ExportDestination.PathFor(null, ".mnemo");

        Assert.False(staged.StartsWith(_folder, StringComparison.Ordinal));
        Assert.Equal(".mnemo", Path.GetExtension(staged));
    }

    private sealed class MemorySettings : ISettingsService
    {
        private readonly ConcurrentDictionary<string, object?> _values = new(StringComparer.Ordinal);

        public Task<T> GetAsync<T>(string key, T defaultValue = default!) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is T typed ? typed : defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string key) => Task.FromResult(_values.ContainsKey(key));

        public event EventHandler<string>? SettingChanged;
    }
}
