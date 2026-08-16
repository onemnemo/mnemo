using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace Mnemo.Host.Events;

/// <summary>
/// Writes the SSE wire format to a response body. Payloads are compact JSON (no
/// embedded newlines), so each event is a single <c>data:</c> line.
/// </summary>
internal static class ServerSentEvents
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task WriteEventAsync(HttpResponse response, AppEvent evt, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(evt.Data, Json);
        await response.WriteAsync($"event: {evt.Type}\ndata: {payload}\n\n", cancellationToken).ConfigureAwait(false);
        await response.Body.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Writes an SSE comment line - used for heartbeats to keep the connection warm.</summary>
    public static async Task WriteCommentAsync(HttpResponse response, string comment, CancellationToken cancellationToken)
    {
        await response.WriteAsync($": {comment}\n\n", cancellationToken).ConfigureAwait(false);
        await response.Body.FlushAsync(cancellationToken).ConfigureAwait(false);
    }
}
