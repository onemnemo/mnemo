namespace Mnemo.Core.Models;

/// <summary>
/// A single turn in a multi-turn conversation (one user or assistant message).
/// Used to pass real conversation history to the AI layer instead of a flat text blob.
/// </summary>
public sealed record ConversationTurn(ConversationRole Role, string Content);

public enum ConversationRole
{
    User,
    Assistant
}
