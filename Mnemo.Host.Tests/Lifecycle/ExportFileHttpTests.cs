using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// The write route against the real filesystem, because the whole point of the route is that a file
/// exists afterwards. Everything the SPA can no longer check for itself is checked here: the bytes
/// land unchanged, the path that comes back is the path that was written, and a destination the
/// route refuses leaves nothing behind.
/// </summary>
public sealed class ExportFileHttpTests : IAsyncDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("mnemo-export-http").FullName;
    private readonly WebApplication _app;

    /// <summary>The grants the write route consumes. Issued here because no window can raise a
    /// chooser in a headless host, which is the only other way one is minted.</summary>
    private ExportGrants Grants { get; } = new();
    private HttpClient? _client;
    private bool _started;

    public ExportFileHttpTests()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton<ILoggerService>(new SilentLogger());
        builder.Services.AddSingleton<ISettingsService>(new MemorySettings());
        builder.Services.AddSingleton<NativeFileDialogs>();
        builder.Services.AddSingleton(Grants);

        _app = builder.Build();
        _app.MapExportFile();
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

    private static MultipartFormDataContent Upload(string grant, byte[] bytes, string fileName)
    {
        var form = new MultipartFormDataContent { { new StringContent(grant), "grant" } };
        form.Add(new ByteArrayContent(bytes), "file", fileName);
        return form;
    }

    /// <summary>A grant for a destination, standing in for the chooser the headless host has not got.</summary>
    private string GrantFor(string fullPath) =>
        Grants.Issue(new ExportTarget(Path.GetDirectoryName(fullPath)!, fullPath));

    [Fact]
    public async Task WritesTheBytesToTheGrantedPathAndReportsIt()
    {
        var target = Path.Combine(_folder, "deck.mnemo");
        var bytes = new byte[256];
        for (var i = 0; i < bytes.Length; i += 1)
            bytes[i] = (byte)i;

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), bytes, "deck.mnemo"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(target.Replace("\\", "\\\\"), await response.Content.ReadAsStringAsync());
        Assert.True(File.Exists(target));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(target));
    }

    [Fact]
    public async Task WritesTextAsTheBytesItWasGivenRatherThanReencodingIt()
    {
        var target = Path.Combine(_folder, "notes.md");
        var bytes = System.Text.Encoding.UTF8.GetBytes("# 見出し\n\nAccents: éàü\n");

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), bytes, "notes.md"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(target));
    }

    [Fact]
    public async Task CarriesAPayloadFarPastAnyJsonBodyLimit()
    {
        // Well over Kestrel's 30 MB default, which the route lifts. A body this size in JSON would
        // have to be base64, and this proves neither the framework nor the transport truncates it.
        var target = Path.Combine(_folder, "collection.mnemo");
        var bytes = new byte[48 * 1024 * 1024];
        Random.Shared.NextBytes(bytes);

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), bytes, "collection.mnemo"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(bytes.Length, new FileInfo(target).Length);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(target));
    }

    [Fact]
    public async Task RemembersTheFolderOnlyOnceSomethingLandedInIt()
    {
        var settings = _app.Services.GetRequiredService<ISettingsService>();
        var target = Path.Combine(_folder, "deck.mnemo");

        var client = await ClientAsync();
        await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), [1], "deck.mnemo"));

        Assert.Equal([_folder], await settings.GetAsync<string[]>(ExportFolders.SettingKey, []));
    }

    [Fact]
    public async Task RefusesAWriteThatCarriesNoGrant()
    {
        // The whole of the protection. Without this the body could name any path the process can
        // reach, which is a way to drop a file into a startup folder or a config the app reads.
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent([1]), "file", "deck.mnemo");

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("unknown_grant", await response.Content.ReadAsStringAsync());
        Assert.Empty(Directory.GetFiles(_folder));
    }

    [Fact]
    public async Task IgnoresAPathInTheBodyBecauseNothingReadsOne()
    {
        var granted = Path.Combine(_folder, "granted.mnemo");
        var elsewhere = Path.Combine(_folder, "elsewhere.desktop");

        var form = new MultipartFormDataContent
        {
            { new StringContent(GrantFor(granted)), "grant" },
            { new StringContent(elsewhere), "path" },
        };
        form.Add(new ByteArrayContent([1]), "file", "deck.mnemo");

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", form);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(File.Exists(granted));
        Assert.False(File.Exists(elsewhere));
    }

    [Fact]
    public async Task SpendsAGrantSoTheSameTokenCannotWriteTwice()
    {
        var target = Path.Combine(_folder, "deck.mnemo");
        var grant = GrantFor(target);

        var client = await ClientAsync();
        var first = await client.PostAsync("/api/app/export-file", Upload(grant, [1], "deck.mnemo"));
        var second = await client.PostAsync("/api/app/export-file", Upload(grant, [2], "deck.mnemo"));

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
        Assert.Equal([1], await File.ReadAllBytesAsync(target));
    }

    [Fact]
    public async Task ReportsAWriteItCouldNotPerformRatherThanClaimingSuccess()
    {
        // A directory standing where the file should go. The open fails the same way a read-only
        // folder does, and the caller has to hear about it either way.
        var target = Path.Combine(_folder, "occupied.mnemo");
        Directory.CreateDirectory(target);

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), [1], "occupied.mnemo"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("write_failed", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task LeavesTheOldExportIntactWhenTheWriteCannotFinish()
    {
        // Why the bytes land beside the target first: writing straight over it would mean a failure
        // part way through costs the user the export that was already there.
        var target = Path.Combine(_folder, "deck.mnemo");
        await File.WriteAllBytesAsync(target, [9, 9, 9]);
        // A directory where the sibling wants to go, which is what makes the write fail after the
        // destination already exists.
        Directory.CreateDirectory(target + ".part");

        var client = await ClientAsync();
        var response = await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), [1, 2], "deck.mnemo"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal([9, 9, 9], await File.ReadAllBytesAsync(target));
    }

    [Fact]
    public async Task LeavesNoHalfWrittenSiblingBehind()
    {
        var target = Path.Combine(_folder, "deck.mnemo");

        var client = await ClientAsync();
        await client.PostAsync("/api/app/export-file", Upload(GrantFor(target), [1, 2, 3], "deck.mnemo"));

        Assert.Equal([target], Directory.GetFiles(_folder));
    }

    [Fact]
    public async Task AnswersThatNoChooserCanBeRaisedWithoutAWindow()
    {
        // The headless host has no window, which is exactly the state the dev server runs in. The
        // client reads this as permission to fall back to the browser's own download.
        var client = await ClientAsync();
        var response = await client.PostAsync(
            "/api/app/export-file/target",
            new StringContent(
                """{"title":"Save export as","fileName":"deck.mnemo"}""",
                System.Text.Encoding.UTF8,
                "application/json"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"available\":false", body);
        Assert.Contains("\"path\":null", body);
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync();
        await _app.DisposeAsync();
        Directory.Delete(_folder, recursive: true);
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null) { }
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
