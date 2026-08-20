using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// The material behind cards, and the card types that turn it into them. Saving material rebuilds
/// its cards; nothing else writes card content for a fact that has one.
/// </summary>
public interface IFlashcardFactService
{
    Task<IReadOnlyList<FlashcardCardType>> ListCardTypesAsync(CancellationToken cancellationToken = default);
    Task<FlashcardCardType?> GetCardTypeAsync(string typeId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves a card type and rebuilds every fact that uses it, so a template edit reaches the cards
    /// it describes instead of showing up only on the next one written.
    /// </summary>
    Task<FlashcardCardType> SaveCardTypeAsync(FlashcardCardType type, CancellationToken cancellationToken = default);

    /// <summary>Refuses while material still uses the type, and never removes a built-in.</summary>
    Task<bool> DeleteCardTypeAsync(string typeId, CancellationToken cancellationToken = default);

    /// <summary>How much material a type holds, which is what makes deleting one a decision.</summary>
    Task<int> CountFactsUsingTypeAsync(string typeId, CancellationToken cancellationToken = default);

    Task<FlashcardFact?> GetFactAsync(string factId, CancellationToken cancellationToken = default);

    /// <summary>The material behind a card, for opening the editor on the card someone clicked.</summary>
    Task<FlashcardFact?> GetFactForCardAsync(string cardId, CancellationToken cancellationToken = default);

    Task<FlashcardFactSaved> SaveFactAsync(FlashcardFactDraft draft, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves several pieces of material at once, each rebuilding its own cards, all in one write.
    /// What an import calls: a collection arrives whole, and a write per note would cost a commit
    /// per note. A draft that would make no cards fails the whole call, exactly as it would alone.
    /// </summary>
    Task<IReadOnlyList<FlashcardFactSaved>> SaveFactsAsync(
        IReadOnlyList<FlashcardFactDraft> drafts, CancellationToken cancellationToken = default);
    Task DeleteFactsAsync(IReadOnlyList<string> factIds, CancellationToken cancellationToken = default);
}
