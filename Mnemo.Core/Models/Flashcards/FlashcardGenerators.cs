namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Card types whose card count comes from the content rather than from a layout list. Everything
/// else about them is an ordinary card type, so this is a flag on the type rather than a separate
/// branch of the model.
/// </summary>
public static class FlashcardGenerators
{
    /// <summary>One card per <c>{{cN::}}</c> deletion in the source field.</summary>
    public const string Cloze = "cloze";

    /// <summary>One card per mask on the source image.</summary>
    public const string Occlusion = "occlusion";
}
