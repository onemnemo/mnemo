using System;
using System.Globalization;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// How long an assistant turn took, rendered the way the collapsed process trace shows it.
/// Invariant culture, because the text is stored on the persisted message rather than
/// recomputed per reader.
/// </summary>
public static class ChatTurnDuration
{
    /// <summary>Formats a turn duration as "20s", or "1m 5s" past a minute.</summary>
    public static string FormatShort(TimeSpan elapsed)
    {
        if (elapsed.TotalSeconds < 1)
            return "0s";
        if (elapsed.TotalSeconds < 60)
            return string.Create(CultureInfo.InvariantCulture, $"{(int)elapsed.TotalSeconds}s");
        var minutes = (int)elapsed.TotalMinutes;
        var seconds = elapsed.Seconds;
        return string.Create(CultureInfo.InvariantCulture, $"{minutes}m {seconds}s");
    }
}
