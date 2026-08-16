namespace Mnemo.Infrastructure.Services.Updates;

public static class UpdateSettingsKeys
{
    public const string AutoCheck = "Updates.AutoCheck";

    /// <summary>Which track this install follows. One of <see cref="UpdateChannels"/>; absent means Stable.</summary>
    public const string Channel = "Updates.Channel";
    public const string RemindAtUtc = "Updates.RemindAtUtc";
    public const string SnoozeLaunchesRemaining = "Updates.SnoozeLaunchesRemaining";
    public const string SkippedVersion = "Updates.SkippedVersion";
    public const string LastCheckedUtc = "Updates.LastCheckedUtc";
    public const string PromptCountByVersion = "Updates.PromptCountByVersion";

    /// <summary>Serialized pending update offer from the last successful check; used to resume prompts while the network check is cooldown-gated.</summary>
    public const string PendingOfferJson = "Updates.PendingOfferJson";

    /// <summary>Set immediately before in-app restart so the next launch can show a one-shot success toast.</summary>
    public const string PendingPostUpdateToastVersion = "Updates.PendingPostUpdateToastVersion";
}
