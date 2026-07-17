namespace Mnemo.Host.Events;

/// <summary>
/// One server-to-client push. <see cref="Type"/> becomes the SSE <c>event:</c>
/// name the browser dispatches on; <see cref="Data"/> is serialized as the JSON
/// <c>data:</c> payload.
/// </summary>
public sealed record AppEvent(string Type, object? Data);
