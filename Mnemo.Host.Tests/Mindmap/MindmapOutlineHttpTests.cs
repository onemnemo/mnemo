using System.Collections.Concurrent;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Mindmap;
using Xunit;

namespace Mnemo.Host.Tests.Mindmap;

/// <summary>
/// The one export the host produces for a map. It answers two ways from the same render: with the
/// file, for a browser tab that has nowhere to put it, and with a path, when a grant says where it
/// goes. The second is the one worth pinning, because it is what keeps a package off the round trip
/// out to the page and back again.
/// </summary>
public sealed class MindmapOutlineHttpTests : IDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("mnemo-outline").FullName;
    private readonly ExportGrants _grants = new();
    private readonly MemorySettings _settings = new();
    private readonly SilentLogger _logger = new();

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public async Task WritesTheOutlineToTheGrantedPathAndReportsIt()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);
        var destination = Path.Combine(_folder, "Kanji.md");

        var result = await MindmapEndpoints.OutlineAsync(
            map.Id,
            _grants.Issue(new ExportTarget(_folder, destination)),
            h.Service,
            _grants,
            _settings,
            _logger);

        var response = await Execute(result);
        Assert.Equal(StatusCodes.Status200OK, response.Status);
        Assert.Contains(destination.Replace("\\", "\\\\"), response.Body);

        // The file is on disk, and nothing half-written is beside it.
        Assert.Contains("Kanji", await File.ReadAllTextAsync(destination));
        Assert.False(File.Exists(destination + ".part"));
    }

    [Fact]
    public async Task HandsBackTheFileWhenNoDestinationWasChosen()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var response = await Execute(await MindmapEndpoints.OutlineAsync(
            map.Id, grant: null, h.Service, _grants, _settings, _logger));

        Assert.Equal(StatusCodes.Status200OK, response.Status);
        Assert.Contains("Kanji", response.Body);
        Assert.Empty(Directory.GetFiles(_folder));
    }

    [Fact]
    public async Task RefusesAGrantNobodyIssued()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var response = await Execute(await MindmapEndpoints.OutlineAsync(
            map.Id, "not-a-token", h.Service, _grants, _settings, _logger));

        Assert.Equal(StatusCodes.Status400BadRequest, response.Status);
        Assert.Contains("unknown_grant", response.Body);
        Assert.Empty(Directory.GetFiles(_folder));
    }

    [Fact]
    public async Task SpendsTheGrantSoTheSameTokenCannotWriteTwice()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);
        var token = _grants.Issue(new ExportTarget(_folder, Path.Combine(_folder, "Kanji.md")));

        await Execute(await MindmapEndpoints.OutlineAsync(map.Id, token, h.Service, _grants, _settings, _logger));
        var again = await Execute(await MindmapEndpoints.OutlineAsync(map.Id, token, h.Service, _grants, _settings, _logger));

        Assert.Equal(StatusCodes.Status400BadRequest, again.Status);
    }

    private static async Task<MindmapDocument> SeededMap(MindmapHostHarness h)
    {
        var map = (await h.Service.CreateAsync("Kanji")).Value!;
        await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "add", "nodes": [ { "ref": "r", "t": "Kanji",
                  "c": [ { "t": "Stage one" }, { "t": "Stage two" } ] } ] }
            ] }
            """), h.Service);
        return (await h.Service.GetAsync(map.Id)).Value!;
    }

    private static Stream Body(string json) => new MemoryStream(Encoding.UTF8.GetBytes(json));

    private static async Task<Response> Execute(IResult result)
    {
        var services = new ServiceCollection();
        services.AddLogging();

        await using var provider = services.BuildServiceProvider();
        using var body = new MemoryStream();
        var context = new DefaultHttpContext { RequestServices = provider };
        context.Response.Body = body;

        await result.ExecuteAsync(context);

        return new Response(context.Response.StatusCode, Encoding.UTF8.GetString(body.ToArray()));
    }

    private sealed record Response(int Status, string Body);

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
