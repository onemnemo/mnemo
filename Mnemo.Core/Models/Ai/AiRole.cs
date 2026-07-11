namespace Mnemo.Core.Models.Ai;

/// <summary>
/// The AI function a feature needs. Every feature declares a role and resolves it through
/// the model router — nothing asks for "the model" — so individual roles can migrate
/// between providers (cloud today, local later) without feature changes.
/// </summary>
public enum AiRole
{
    /// <summary>Agentic chat: multi-turn conversation with tool calling. Chat plane.</summary>
    Assistant = 0,

    /// <summary>Schema-constrained artifact generation (flashcards, mindmaps, learning paths). Chat plane.</summary>
    StructuredGenerator = 1,

    /// <summary>Conversation and note summarization. Text plane.</summary>
    Summarizer = 2,

    /// <summary>Selection rewrite and grammar fixes in the notes editor. Text plane.</summary>
    Rewriter = 3,

    /// <summary>Inline tab completion (fill-in-the-middle). Text plane.</summary>
    TabCompleter = 4,

    /// <summary>Short titles for conversations and artifacts. Text plane.</summary>
    TitleGenerator = 5,
}
