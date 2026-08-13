namespace Mnemo.Host.Contracts;

/// <summary>
/// Error body every failing API response carries: a stable machine-readable
/// <paramref name="Error"/> code and a human-readable <paramref name="Message"/>.
/// </summary>
public sealed record ErrorDto(string Error, string Message);
