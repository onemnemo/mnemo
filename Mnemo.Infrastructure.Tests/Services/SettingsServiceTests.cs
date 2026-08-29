using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Services;

/// <summary>
/// What a settings write does when storage refuses it.
/// </summary>
/// <remarks>
/// The cache is what answers reads for the rest of the session, so a value cached for a
/// write that never landed is a setting that looks saved right up until the next launch.
/// The API key is the one where that costs a person real time to work out.
/// </remarks>
public sealed class SettingsServiceTests
{
    [Fact]
    public async Task A_refused_write_is_reported_rather_than_returning_quietly()
    {
        var settings = new SettingsService(new FailingStorageProvider());

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => settings.SetAsync("Ai.ApiKey", "sk-not-saved"));
    }

    [Fact]
    public async Task A_refused_write_does_not_leave_the_value_readable()
    {
        var settings = new SettingsService(new FailingStorageProvider());

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => settings.SetAsync("Ai.ApiKey", "sk-not-saved"));

        Assert.Equal("unset", await settings.GetAsync("Ai.ApiKey", "unset"));
    }

    [Fact]
    public async Task A_refused_write_announces_no_change()
    {
        var settings = new SettingsService(new FailingStorageProvider());
        var raised = 0;
        settings.SettingChanged += (_, _) => raised++;

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => settings.SetAsync("App.Theme", "dark"));

        Assert.Equal(0, raised);
    }

    [Fact]
    public async Task An_accepted_write_is_readable_and_announced()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());
        var raised = new List<string>();
        settings.SettingChanged += (_, key) => raised.Add(key);

        await settings.SetAsync("App.Theme", "dark");

        Assert.Equal("dark", await settings.GetAsync("App.Theme", "light"));
        Assert.Equal(new[] { "App.Theme" }, raised);
    }

    [Fact]
    public async Task An_absent_key_does_not_exist()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());

        Assert.False(await settings.ExistsAsync("Updates.Channel"));
    }

    [Fact]
    public async Task A_written_key_exists()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());

        await settings.SetAsync("Updates.Channel", "beta");

        Assert.True(await settings.ExistsAsync("Updates.Channel"));
    }

    /// <summary>
    /// A stored null must be distinguishable from a missing setting.
    /// </summary>
    [Fact]
    public async Task A_key_written_as_null_does_not_exist()
    {
        var settings = new SettingsService(new InMemoryStorageProvider());

        await settings.SetAsync<string?>("Updates.Channel", null);

        Assert.False(await settings.ExistsAsync("Updates.Channel"));
        Assert.Null(await settings.GetAsync<string?>("Updates.Channel"));
    }

    /// <summary>The branch a real first launch takes, with nothing in the cache yet.</summary>
    [Fact]
    public async Task A_value_only_in_storage_exists_before_anything_reads_it()
    {
        var storage = new InMemoryStorageProvider();
        storage.Seed("Updates.Channel", "\"nightly\"");

        Assert.True(await new SettingsService(storage).ExistsAsync("Updates.Channel"));
    }

    /// <summary>
    /// A failed read must not authorize overwriting an existing setting with a default.
    /// </summary>
    [Fact]
    public async Task A_key_that_cannot_be_read_is_not_reported_as_absent()
    {
        var storage = new InMemoryStorageProvider();
        storage.Seed("Updates.Channel", "{ not valid json");

        Assert.True(await new SettingsService(storage).ExistsAsync("Updates.Channel"));
    }

    /// <summary>Storage that accepts nothing, the way a locked or broken database behaves.</summary>
    private sealed class FailingStorageProvider : IStorageProvider
    {
        public Task<Result> SaveAsync<T>(string key, T data) =>
            Task.FromResult(Result.Failure($"Failed to save data for key: {key}"));

        public Task<Result<T?>> LoadAsync<T>(string key) =>
            Task.FromResult(Result<T?>.Failure("Key not found"));

        public Task<Result> DeleteAsync(string key) =>
            Task.FromResult(Result.Success());
    }
}
