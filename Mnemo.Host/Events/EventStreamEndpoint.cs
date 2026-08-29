using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Hosting;

namespace Mnemo.Host.Events;

/// <summary>
/// Maps <c>GET /api/events</c>, the server-sent-events channel the SPA holds open
/// for the session. Server code pushes <see cref="AppEvent"/>s through
/// <see cref="IAppEventPublisher"/>; each connected client receives them here.
/// </summary>
public static class EventStreamEndpoint
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(15);

    public static IEndpointConventionBuilder MapEventStream(this IEndpointRouteBuilder endpoints)
        => endpoints.MapGet("/api/events", HandleAsync);

    private static async Task HandleAsync(
        HttpContext context,
        IAppEventSource source,
        IHostApplicationLifetime lifetime,
        CancellationToken cancellationToken)
    {
        var response = context.Response;
        response.Headers.CacheControl = "no-cache";
        response.Headers.ContentType = "text/event-stream";
        // Ask any intermediary (the Vite proxy in dev) not to buffer the stream.
        response.Headers["X-Accel-Buffering"] = "no";
        context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        await using var subscription = source.Subscribe();
        var reader = subscription.Reader;

        // WebKitGTK connections can outlive the window. The host token prevents them from delaying
        // shutdown until the drain timeout.
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, lifetime.ApplicationStopping);
        var streamToken = linked.Token;

        using var heartbeat = new PeriodicTimer(HeartbeatInterval);
        // Keep each wait outstanding across loop turns: the channel is single-reader
        // and PeriodicTimer allows only one pending tick, so we never start a second.
        Task<bool>? readWait = null;
        Task<bool>? beatWait = null;

        try
        {
            // Flush the greeting immediately. Cancellation must be caught if shutdown began before
            // the stream opened.
            await ServerSentEvents.WriteEventAsync(
                response, new AppEvent("hello", new { serverTime = DateTimeOffset.UtcNow }), streamToken).ConfigureAwait(false);

            while (!streamToken.IsCancellationRequested)
            {
                readWait ??= reader.WaitToReadAsync(streamToken).AsTask();
                beatWait ??= heartbeat.WaitForNextTickAsync(streamToken).AsTask();

                if (await Task.WhenAny(readWait, beatWait).ConfigureAwait(false) == readWait)
                {
                    if (!await readWait.ConfigureAwait(false))
                        break; // hub completed the channel
                    readWait = null;
                    while (reader.TryRead(out var evt))
                        await ServerSentEvents.WriteEventAsync(response, evt, streamToken).ConfigureAwait(false);
                }
                else
                {
                    if (!await beatWait.ConfigureAwait(false))
                        break; // timer disposed
                    beatWait = null;
                    await ServerSentEvents.WriteCommentAsync(response, "ping", streamToken).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Client disconnect and host shutdown are normal stream termination.
        }
    }
}
