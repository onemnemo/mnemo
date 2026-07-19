using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A note without its body, for the sidebar and lists. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
public sealed record NoteSummaryDto(
    string Id,
    string Title,
    string? FolderId,
    string? ParentNoteId,
    int Order,
    bool IsFavorite,
    DateTime CreatedAt,
    DateTime ModifiedAt)
{
    public static NoteSummaryDto FromModel(Note model) => new(
        model.NoteId,
        model.Title,
        model.FolderId,
        model.ParentNoteId,
        model.Order,
        model.IsFavorite,
        DtoTime.AsUtc(model.CreatedAt),
        DtoTime.AsUtc(model.ModifiedAt));
}

/// <summary>
/// A note with its body. <c>Blocks</c> is the stored block list, not a reshaping of it:
/// <c>Block</c> carries its own converter, so what a client reads here is byte-for-byte
/// what the editor persisted, and the same JSON the desktop app loads.
/// <para>
/// Null <c>Blocks</c> means the note predates the block editor and only has
/// <c>Content</c>; the reader is responsible for the fallback, exactly as the desktop
/// app is, rather than the server inventing a block that was never saved.
/// </para>
/// </summary>
public sealed record NoteDto(
    string Id,
    string Title,
    string? FolderId,
    string? ParentNoteId,
    int Order,
    bool IsFavorite,
    DateTime CreatedAt,
    DateTime ModifiedAt,
    string Content,
    IReadOnlyList<Block>? Blocks)
{
    public static NoteDto FromModel(Note model) => new(
        model.NoteId,
        model.Title,
        model.FolderId,
        model.ParentNoteId,
        model.Order,
        model.IsFavorite,
        DtoTime.AsUtc(model.CreatedAt),
        DtoTime.AsUtc(model.ModifiedAt),
        model.Content,
        model.Blocks);
}

/// <summary>
/// Note create body. Every field is optional: a new note is empty and untitled until
/// the editor says otherwise, and its position is the server's to assign.
/// </summary>
public sealed record CreateNoteDto(string? Title, string? FolderId, string? ParentNoteId);

/// <summary>
/// Full replace of a note's editable metadata — deliberately every field a client may
/// set, and deliberately nothing else. There is no content or block field here and no
/// content write endpoint anywhere: the versioned commit contract is the only way a
/// body is ever written, and a general update shape would quietly become a second one.
/// <para>
/// A replace rather than a patch for the same reason deck updates are: in JSON an
/// absent field and an explicit null read the same, so a patch shape could never move
/// a note back to the root or unlink it from its parent page.
/// </para>
/// </summary>
public sealed record UpdateNoteMetadataDto(
    string Title,
    string? FolderId,
    string? ParentNoteId,
    int Order,
    bool IsFavorite);

/// <summary>A folder in the notes tree.</summary>
public sealed record NoteFolderDto(string Id, string Name, string? ParentId, int Order)
{
    public static NoteFolderDto FromModel(NoteFolder model)
        => new(model.FolderId, model.Name, model.ParentId, model.Order);
}

/// <summary>Note folder create/update body. The id comes from the route on update.</summary>
public sealed record SaveNoteFolderDto(string Name, string? ParentId, int Order);
