namespace Mnemo.Core.Services;

/// <summary>
/// Centralized access point for the AI assistant. The same conversation engine backs
/// several surfaces (a compact "Ask" overlay, an inline response window, and the full
/// chat module) so the assistant can be reached from anywhere in the application.
/// </summary>
public interface IAssistantOverlayService
{
    /// <summary>
    /// Opens the compact Ask overlay: a small box that grows as the user types and
    /// expands again to host the streamed answer.
    /// </summary>
    /// <param name="seedContext">
    /// Optional context (e.g. selected text) sent to the assistant alongside the prompt
    /// but not shown as the user's typed message.
    /// </param>
    /// <param name="seedPrompt">Optional initial prompt text to pre-fill the input.</param>
    /// <param name="autoSend">When true and a prompt is supplied, the turn is sent immediately.</param>
    /// <param name="anchorPointX">Optional screen-space X to anchor the overlay near (e.g. a text selection).</param>
    /// <param name="anchorPointY">Optional screen-space Y to anchor the overlay near.</param>
    void OpenAsk(
        string? seedContext = null,
        string? seedPrompt = null,
        bool autoSend = false,
        double? anchorPointX = null,
        double? anchorPointY = null);

    /// <summary>
    /// Convenience entry point for the "Explain selected text" inline tool: opens the Ask
    /// overlay anchored to the selection and immediately asks the assistant to explain it.
    /// </summary>
    void ExplainSelection(string selectedText, double? anchorPointX = null, double? anchorPointY = null);

    /// <summary>Opens the full conversational chat surface (the dedicated chat module).</summary>
    void OpenChat();

    /// <summary>Closes the compact Ask overlay if it is open.</summary>
    void CloseAsk();
}
