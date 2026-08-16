using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A toast pushed to the SPA over the app-events channel. Mirrors the arguments
/// the desktop toast host receives; the wire <see cref="Type"/> is the lowercase
/// enum name the browser's toast store keys on.
/// </summary>
public sealed record ToastEventDto(string Type, string Title, string? Description, double DurationMs)
{
    public static ToastEventDto From(ToastType type, TimeSpan duration, string title, string description)
        => new(
            type.ToString().ToLowerInvariant(),
            title,
            string.IsNullOrEmpty(description) ? null : description,
            duration.TotalMilliseconds);
}
