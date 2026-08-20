namespace Mnemo.Infrastructure.Services.AI;

/// <summary>Controls reveal pacing for chat streaming (see <c>Chat.StreamingReveal</c>).</summary>
public readonly record struct ChatStreamingDisplayOptions(int TickMs, int CharsPerTick, bool IsInstant)
{
    /// <summary>Minimum interval between UI content callbacks during streaming (reveal + instant paths).</summary>
    public const int DefaultUiThrottleMs = 20;

    /// <summary>Default preset: faster on-screen reveal while still paced (tick ms, chars per tick).</summary>
    public static ChatStreamingDisplayOptions Balanced => new(22, 6, false);

    public static ChatStreamingDisplayOptions Parse(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored))
            return Balanced;

        switch (stored.Trim().ToLowerInvariant())
        {
            case "instant":
                return new ChatStreamingDisplayOptions(0, 0, true);
            case "smooth":
                return new ChatStreamingDisplayOptions(36, 4, false);
            default:
                return Balanced;
        }
    }
}
