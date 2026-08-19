namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One recipe for turning a fact into a card. Every layout that fires produces exactly one card
/// with its own schedule.
/// </summary>
/// <param name="Id">
/// Stable within its card type, and half of a generated card's identity. Changing it detaches
/// every card the layout has already made from its schedule and history, so it is minted once.
/// </param>
/// <param name="Name">Names the card beside its siblings, for example "Recognition".</param>
/// <param name="Front">Template for the question side, with <c>{{Field}}</c> markers.</param>
/// <param name="Back">Template for the answer side.</param>
/// <param name="Requires">
/// Field id that must hold a value for this layout to make a card, or null to always fire.
/// Stated outright rather than inferred from a non-empty rendered front, so the editor can show
/// which field switches a dormant card on.
/// </param>
public sealed record FlashcardLayout(
    string Id,
    string Name,
    string Front,
    string Back,
    string? Requires = null);
