using System.IO;
using System.Net.Http;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Mnemo.Host.Events;

namespace Mnemo.Host.Tests.Events;

/// <summary>
/// Exercises the production event route through TestServer. It does not measure socket draining or
/// packaged shutdown time.
/// </summary>
internal sealed class EventStreamHttpHarness : IAsyncDisposable
{
    private readonly WebApplication _app;
    private HttpClient? _client;
    private bool _started;

    public EventStreamHttpHarness()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton<AppEventHub>();
        builder.Services.AddSingleton<IAppEventPublisher>(sp => sp.GetRequiredService<AppEventHub>());
        builder.Services.AddSingleton<IAppEventSource>(sp => sp.GetRequiredService<AppEventHub>());

        _app = builder.Build();
        _app.MapEventStream();
    }

    /// <summary>The hub the endpoint subscribes to, for pushing an event and for counting who took it.</summary>
    public AppEventHub Hub => _app.Services.GetRequiredService<AppEventHub>();

    /// <summary>
    /// Cancels the stopping token without stopping TestServer, isolating the endpoint response.
    /// </summary>
    public IHostApplicationLifetime Lifetime => _app.Services.GetRequiredService<IHostApplicationLifetime>();

    /// <summary>Only valid once the application has been started.</summary>
    public HttpClient Client => _client ?? throw new InvalidOperationException(
        "Call StartAsync before using Client.");

    public async Task StartAsync()
    {
        if (_started)
            return;

        await _app.StartAsync().ConfigureAwait(false);
        _started = true;
        _client = _app.GetTestClient();
    }

    /// <summary>Opens the stream and hands the response back as soon as the headers are in.</summary>
    public Task<HttpResponseMessage> OpenStreamAsync(CancellationToken cancellationToken = default) =>
        Client.SendAsync(
            new HttpRequestMessage(HttpMethod.Get, "/api/events"),
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

    /// <summary>
    /// Reads the next frame with a timeout so a stalled stream fails the test. Returns null at end
    /// of stream.
    /// </summary>
    public static async Task<string?> ReadFrameAsync(Stream body, TimeSpan bound)
    {
        var buffer = new byte[512];
        var frame = new StringBuilder();
        var deadline = DateTime.UtcNow + bound;

        while (true)
        {
            var remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero)
                Assert.Fail($"No complete frame arrived inside {bound}. Read so far: '{frame}'.");

            var read = body.ReadAsync(buffer.AsMemory()).AsTask();
            if (await Task.WhenAny(read, Task.Delay(remaining)).ConfigureAwait(false) != read)
                Assert.Fail($"A read was still pending after {bound}. Read so far: '{frame}'.");

            var count = await read.ConfigureAwait(false);
            if (count == 0)
                return null;

            frame.Append(Encoding.UTF8.GetString(buffer, 0, count));
            var text = frame.ToString();
            if (text.Contains("\n\n", StringComparison.Ordinal))
                return text;
        }
    }

    /// <summary>False when the body was still open at the end of the bound.</summary>
    public static async Task<bool> ReachedEndOfStreamAsync(Stream body, TimeSpan bound)
    {
        var buffer = new byte[512];
        var deadline = DateTime.UtcNow + bound;

        while (true)
        {
            var remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero)
                return false;

            var read = body.ReadAsync(buffer.AsMemory()).AsTask();
            if (await Task.WhenAny(read, Task.Delay(remaining)).ConfigureAwait(false) != read)
                return false;

            if (await read.ConfigureAwait(false) == 0)
                return true;
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync().ConfigureAwait(false);
        await _app.DisposeAsync().ConfigureAwait(false);
    }
}
