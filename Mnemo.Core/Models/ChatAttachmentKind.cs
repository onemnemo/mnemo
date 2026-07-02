namespace Mnemo.Core.Models;

/// <summary>Type of chat attachment for multimodal prompts.</summary>
public enum ChatAttachmentKind
{
    /// <summary>Generic file (e.g. text included in prompt or filename referenced).</summary>
    File,

    /// <summary>Image (sent to vision model as base64).</summary>
    Image
}
