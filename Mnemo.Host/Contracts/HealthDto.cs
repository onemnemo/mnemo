namespace Mnemo.Host.Contracts;

/// <summary>Response of the unauthenticated <c>GET /api/health</c> liveness probe.</summary>
public sealed record HealthDto(string Status);
