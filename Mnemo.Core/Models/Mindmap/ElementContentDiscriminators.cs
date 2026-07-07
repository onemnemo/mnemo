namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Stable <c>$type</c> discriminator strings for every built-in <see cref="IElementContent"/>. Shared
/// between the content records and the Infrastructure serializer so both agree on one source of truth.
/// These strings are persisted — never rename an existing one (add a new kind instead).
/// </summary>
public static class ElementContentDiscriminators
{
    // Node contents.
    public const string Text = "text";
    public const string Image = "image";
    public const string Link = "link";
    public const string Flashcard = "flashcard";
    public const string Note = "note";
    public const string Task = "task";
    public const string Code = "code";
    public const string Math = "math";

    // Non-node element contents.
    public const string Shape = "shape";
    public const string FreeText = "freeText";
    public const string CanvasImage = "canvasImage";
    public const string Frame = "frame";
}
