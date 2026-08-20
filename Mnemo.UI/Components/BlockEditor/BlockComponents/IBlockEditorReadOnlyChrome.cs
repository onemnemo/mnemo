namespace Mnemo.UI.Components.BlockEditor.BlockComponents;

/// <summary>Block chrome that must mirror <see cref="BlockEditor.IsReadOnly"/> (non-rich-text surfaces).</summary>
public interface IBlockEditorReadOnlyChrome
{
    void ApplyBlockEditorReadOnly(bool readOnly);
}
