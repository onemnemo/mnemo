using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// Manages shared scheduling presets. Editing a preset changes every deck bound to it.
/// </summary>
public interface IFlashcardPresetService
{
    Task<IReadOnlyList<FlashcardPreset>> ListPresetsAsync(CancellationToken cancellationToken = default);
    Task<FlashcardPreset?> GetPresetAsync(string presetId, CancellationToken cancellationToken = default);

    /// <summary>Ensures the seeded "Standard" preset exists and returns it.</summary>
    Task<FlashcardPreset> GetOrCreateStandardAsync(CancellationToken cancellationToken = default);

    Task<FlashcardPreset> SavePresetAsync(FlashcardPreset preset, CancellationToken cancellationToken = default);
    Task AssignDeckPresetAsync(string deckId, string presetId, CancellationToken cancellationToken = default);

    /// <summary>Number of decks bound to a preset (e.g. "Standard · 4 decks").</summary>
    Task<int> CountDecksUsingAsync(string presetId, CancellationToken cancellationToken = default);

    /// <summary>Deletes a preset. Returns false (no-op) if any deck still references it.</summary>
    Task<bool> DeletePresetAsync(string presetId, CancellationToken cancellationToken = default);
}
