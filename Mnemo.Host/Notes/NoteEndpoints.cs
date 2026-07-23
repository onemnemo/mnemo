using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Notes;

/// <summary>
/// Reading, creating, retitling, filing and deleting notes, and the one endpoint that
/// writes a note's body.
/// <para>
/// That last one is <c>PUT /api/notes/{id}/content</c>, and it is deliberately the only
/// one: it takes the version the client edited and applies the write only if the note is
/// still on it. A plain content <c>PUT</c> alongside it would be a second way to write the
/// same bytes with none of those checks, and the two would drift the first time the commit
/// path learned something the plain one did not. The metadata endpoint keeps its half of
/// that bargain by loading the stored note and replacing only metadata fields, so it cannot
/// lose content even by accident.
/// </para>
/// <para>
/// Every route here is closed until the sid migration completes; see <see cref="NotesReady"/>.
/// </para>
/// </summary>
public static class NoteEndpoints
{
    private const string DefaultTitle = "Untitled";

    public static void MapNotes(this IEndpointRouteBuilder endpoints)
    {
        // Ordered newest-first by the service. The sidebar re-sorts into tree order
        // itself, and reads the body of nothing it lists.
        endpoints.MapGet("/api/notes", async (INoteService notes) =>
        {
            var all = await notes.GetAllNotesAsync().ConfigureAwait(false);
            return all.Select(NoteSummaryDto.FromModel).ToList();
        }).RequireNotesMigrated();

        endpoints.MapGet("/api/notes/{id}", async (string id, INoteService notes) =>
        {
            var note = await notes.GetNoteAsync(id).ConfigureAwait(false);
            return note is null
                ? Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."))
                : Results.Ok(NoteDto.FromModel(note));
        }).RequireNotesMigrated();

        endpoints.MapPost("/api/notes", async (
            CreateNoteDto body,
            INoteService notes,
            INoteFolderService folderService) =>
        {
            var folderId = Blank(body.FolderId);
            var folders = (await folderService.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
            if (folderId is not null && !folders.Any(f => f.FolderId == folderId))
                return Results.BadRequest(new ErrorDto("unknown_folder", $"No note folder '{folderId}'."));

            var parentNoteId = Blank(body.ParentNoteId);
            if (parentNoteId is not null && await notes.GetNoteAsync(parentNoteId).ConfigureAwait(false) is null)
                return Results.BadRequest(new ErrorDto("unknown_note", $"No note '{parentNoteId}'."));

            var existing = (await notes.GetAllNotesAsync().ConfigureAwait(false)).ToList();
            var note = new Note
            {
                Title = Blank(body.Title) ?? DefaultTitle,
                FolderId = folderId,
                ParentNoteId = parentNoteId,
                FolderPath = NoteTree.BuildFolderPath(folders, folderId),
                Order = NoteTree.NextNoteOrder(existing, folderId),
            };

            var saved = await notes.SaveNoteAsync(note).ConfigureAwait(false);
            return saved.IsSuccess
                ? Results.Ok(NoteDto.FromModel(note))
                : Results.StatusCode(StatusCodes.Status500InternalServerError);
        }).RequireNotesMigrated();

        endpoints.MapPut("/api/notes/{id}/metadata", async (
            string id,
            UpdateNoteMetadataDto body,
            INoteService notes,
            INoteFolderService folderService) =>
        {
            var note = await notes.GetNoteAsync(id).ConfigureAwait(false);
            if (note is null)
                return Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."));

            var title = body.Title?.Trim();
            if (string.IsNullOrEmpty(title))
                return Results.BadRequest(new ErrorDto("invalid_name", "A note title is required."));

            var folderId = Blank(body.FolderId);
            var folders = (await folderService.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
            if (folderId is not null && !folders.Any(f => f.FolderId == folderId))
                return Results.BadRequest(new ErrorDto("unknown_folder", $"No note folder '{folderId}'."));

            var parentNoteId = Blank(body.ParentNoteId);
            if (parentNoteId is not null)
            {
                if (await notes.GetNoteAsync(parentNoteId).ConfigureAwait(false) is null)
                    return Results.BadRequest(new ErrorDto("unknown_note", $"No note '{parentNoteId}'."));
                if (await WouldCycleAsync(notes, id, parentNoteId).ConfigureAwait(false))
                    return Results.BadRequest(new ErrorDto("invalid_parent", "A note cannot be filed under itself."));
            }

            note.Title = title;
            note.FolderId = folderId;
            note.ParentNoteId = parentNoteId;
            note.Order = body.Order;
            note.IsFavorite = body.IsFavorite;
            // Recomputed on every write rather than only at creation, so the stored
            // breadcrumb still matches the tree after a note moves. The desktop app
            // writes it once and leaves it, which is why old notes can carry a path
            // naming a folder they no longer live in.
            note.FolderPath = NoteTree.BuildFolderPath(folders, folderId);

            var saved = await notes.SaveNoteAsync(note).ConfigureAwait(false);
            return saved.IsSuccess
                ? Results.NoContent()
                : Results.StatusCode(StatusCodes.Status500InternalServerError);
        }).RequireNotesMigrated();

        // Matches the desktop app: a hard delete of this note only. Child pages and
        // page blocks pointing here are left alone and render as a missing note,
        // rather than a delete of one note quietly taking a subtree with it.
        endpoints.MapDelete("/api/notes/{id}", async (string id, INoteService notes, NoteAssets assets) =>
        {
            if (await notes.GetNoteAsync(id).ConfigureAwait(false) is null)
                return Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."));

            var deleted = await notes.DeleteNoteAsync(id).ConfigureAwait(false);
            if (deleted.IsSuccess)
            {
                // The deleted note's images just lost their last reference; collect them.
                // The desktop never did this, which is how its images directory accretes
                // files no note can reach.
                assets.Sweeper.SweepInBackground();
                return Results.NoContent();
            }
            return Results.StatusCode(StatusCodes.Status500InternalServerError);
        }).RequireNotesMigrated();

        // The only way a note's body is ever written.
        endpoints.MapPut("/api/notes/{id}/content", async (
            string id,
            CommitNoteContentDto body,
            INoteService notes,
            INoteCommitStore commits) =>
        {
            if (string.IsNullOrWhiteSpace(body.RequestId))
                return Results.BadRequest(new ErrorDto("invalid_request", "A commit needs a request id so a retry is not mistaken for a second edit."));

            var stored = await notes.GetNoteAsync(id).ConfigureAwait(false);
            if (stored is null)
                return Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'."));

            var blocks = body.Blocks?.ToList() ?? [];
            if (BlockSids.TryPrepareForCommit(blocks, new SidGenerator()) is { } problem)
                return Results.BadRequest(new ErrorDto("invalid_block_sid", problem));

            // Only the body moves. Everything the metadata endpoint owns is read from storage, so a
            // commit racing a rename cannot revert the rename.
            stored.Blocks = blocks;

            var result = await commits.CommitAsync(stored, body.BaseVer, body.RequestId).ConfigureAwait(false);
            var payload = new NoteCommitResultDto(result.Outcome.ToString(), result.Ver);

            return result.Outcome switch
            {
                NoteCommitOutcome.Applied or NoteCommitOutcome.AlreadyApplied => Results.Ok(payload),
                // 409 rather than 400: the request was well formed, the note simply moved on. The
                // client rebases on the returned version instead of correcting anything.
                NoteCommitOutcome.Stale => Results.Conflict(payload),
                _ => Results.NotFound(new ErrorDto("unknown_note", $"No note '{id}'.")),
            };
        }).RequireNotesMigrated();
    }

    /// <summary>
    /// Walks up the page-parent chain from the proposed parent. Reaching the note being
    /// edited means the move would detach it and its descendants from the tree into a
    /// ring that no root walk could ever reach.
    /// </summary>
    private static async Task<bool> WouldCycleAsync(INoteService notes, string noteId, string parentNoteId)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var current = parentNoteId;

        while (current is not null && seen.Add(current))
        {
            if (string.Equals(current, noteId, StringComparison.Ordinal))
                return true;

            var parent = await notes.GetNoteAsync(current).ConfigureAwait(false);
            if (parent is null)
                return false;
            current = Blank(parent.ParentNoteId);
        }

        return false;
    }

    /// <summary>Null and empty both mean "unset", and a client may send either.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
