namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Length caps for the free text fields flashcards accepts, shared across every endpoint that
/// takes one. Nothing downstream limits these on its own: the columns are SQLite TEXT, so a
/// value that gets past the endpoint is stored and echoed back in full, in every list response
/// that carries it and the fixed-width row that renders it.
/// </summary>
public static class FlashcardTextLimits
{
    /// <summary>Deck, folder, card type, preset and layout names.</summary>
    public const int MaxNameLength = 200;

    /// <summary>A deck's free-text description.</summary>
    public const int MaxDescriptionLength = 4000;

    /// <summary>A single tag on a deck, card or fact.</summary>
    public const int MaxTagLength = 64;

    /// <summary>A card's front/back, a fact field value, and a layout's front/back template.</summary>
    public const int MaxFieldValueLength = 20000;

    /// <summary>An attachment's caption or display name.</summary>
    public const int MaxCaptionLength = 300;
}
