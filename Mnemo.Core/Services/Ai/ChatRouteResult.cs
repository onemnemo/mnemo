namespace Mnemo.Core.Services.Ai;

/// <summary>Outcome of resolving a chat-plane role.</summary>
/// <param name="Status">
/// Availability outcome; <see cref="AiRouteStatus.Available"/> exactly when
/// <paramref name="Binding"/> is non-null.
/// </param>
/// <param name="Binding">The bound client and model id, when available.</param>
public sealed record ChatRouteResult(AiRouteStatus Status, ChatModelBinding? Binding = null);
