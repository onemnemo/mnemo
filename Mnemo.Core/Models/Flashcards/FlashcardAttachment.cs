namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// An image attached to one side of a flashcard, rendered as a framed figure under the text
/// (up to three per side). The binary lives on disk under the app images directory; only the
/// path/id is persisted in the card row. Replaces the legacy embedded <c>![alt](path)</c> tokens.
/// </summary>
public sealed record FlashcardAttachment(
    string Id,
    string Side,
    string FilePath,
    string DisplayName,
    long SizeBytes,
    string? Caption = null)
{
    /// <summary>Side discriminator for the front of a card.</summary>
    public const string FrontSide = "front";

    /// <summary>Side discriminator for the back of a card.</summary>
    public const string BackSide = "back";
}
