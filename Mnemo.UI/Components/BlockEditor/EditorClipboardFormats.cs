namespace Mnemo.UI.Components.BlockEditor;

public static class EditorClipboardFormats
{
    /// <summary>
    /// Application clipboard id for structured note payload (UTF-8 JSON).
    /// Must match Avalonia rules: only A through Z, a through z, 0 through 9, dot, hyphen (no slashes or '+').
    /// </summary>
    public const string MnemoNoteBlocksJson = "mnemo.noteblocks.v1";
}
