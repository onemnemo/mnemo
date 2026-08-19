namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One card a fact currently makes, before a schedule is attached. Produced by a pure function of
/// the fact and its type and never persisted as a count, because the count changes as a deletion
/// is typed and a stored one would already be stale.
/// </summary>
/// <param name="Key">
/// Stable within the fact, so a card keeps its schedule and history across an ordinary edit.
/// A layout id for an ordinary type, <c>c</c> plus the deletion number for cloze, <c>m</c> plus
/// the mask number for occlusion.
/// </param>
/// <param name="LayoutName">
/// The layout's authored name, or null for a generated card whose label belongs to the
/// presentation layer because it is built from a number rather than written by anyone.
/// </param>
public sealed record FlashcardGeneratedCard(
    string Key,
    string? LayoutName,
    string Front,
    string Back,
    IReadOnlyList<FlashcardAttachment> FrontMedia,
    IReadOnlyList<FlashcardAttachment> BackMedia);
