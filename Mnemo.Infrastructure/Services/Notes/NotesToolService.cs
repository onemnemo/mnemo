using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Identity;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Notes;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Markdown;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Services.Notes;

/// <summary>
/// Agent-facing tools for the Notes module, registered via <see cref="Mnemo.Infrastructure.Services.Tools.NotesToolRegistrar"/>.
/// </summary>
/// <remarks>
/// The surface follows an editor-agent loop: <c>search_notes</c> to discover, <c>outline_note</c>
/// to map a note cheaply, <c>read_note</c> to pull only the parts that matter, and <c>edit_note</c>
/// to apply a batch of surgical block operations atomically. Blocks are addressed by sid and
/// resolved across the whole tree (including nested two-column cells). Reads are lossless
/// (markdown + typed payloads) so edits are never made blind.
/// <para>
/// A body edit is a body edit whoever makes it, so <c>edit_note</c> goes through the same
/// compare-and-swap the editor's own saves use, on the same version. The version token these tools
/// hand out is that version: an agent and a person writing at once now see one conflict between them
/// rather than each quietly overwriting the other.
/// </para>
/// </remarks>
public sealed class NotesToolService
{
    private static readonly JsonSerializerOptions CloneOptions = new();

    private readonly INoteService _notes;
    private readonly INoteCommitStore _commits;
    private readonly INavigationService _nav;
    private readonly IMainThreadDispatcher _ui;
    private readonly INoteFolderService? _folders;

    public NotesToolService(
        INoteService notes,
        INoteCommitStore commits,
        INavigationService nav,
        IMainThreadDispatcher ui,
        INoteFolderService? folders = null)
    {
        _notes = notes;
        _commits = commits;
        _nav = nav;
        _ui = ui;
        _folders = folders;
    }

    // ---------------------------------------------------------------- discovery

    public async Task<ToolInvocationResult> SearchNotesAsync(SearchNotesParameters p)
    {
        var limit = p.Limit is > 0 and <= 50 ? p.Limit!.Value : 10;
        var fuzzy = p.Fuzzy ?? true;
        var matchAll = p.MatchAll ?? false;

        var all = (await _notes.GetAllNotesAsync().ConfigureAwait(false)).ToList();

        string? folderId = null;
        string? folderName = null;
        if (!string.IsNullOrWhiteSpace(p.Folder))
            (folderId, folderName) = await ResolveFolderAsync(p.Folder!.Trim()).ConfigureAwait(false);

        IEnumerable<Note> scope = all;
        if (p.Favorite == true)
            scope = scope.Where(n => n.IsFavorite);
        if (folderId != null)
            scope = scope.Where(n => string.Equals(n.FolderId, folderId, StringComparison.Ordinal));
        else if (folderName != null)
            scope = scope.Where(n => (n.FolderPath ?? string.Empty).Contains(folderName, StringComparison.OrdinalIgnoreCase));

        // List mode: no query → newest-first listing.
        if (string.IsNullOrWhiteSpace(p.Query))
        {
            var listed = scope
                .OrderByDescending(n => n.ModifiedAt)
                .Take(limit)
                .Select(NoteSummary)
                .ToList();

            return listed.Count == 0
                ? ToolInvocationResult.Success("No notes found.", new { notes = listed })
                : ToolInvocationResult.Success($"{listed.Count} note(s).", new { notes = listed });
        }

        var tokens = TextSearchMatch.ResolveSearchTokens(p.Query.Trim());
        if (tokens.Count == 0)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "query has no searchable tokens.");

        var hits = new List<(double score, DateTime modified, Dictionary<string, object?> dto)>();
        foreach (var note in scope)
        {
            NoteDocumentHelper.EnsureBlocks(note);
            CollectHits(note, tokens, matchAll, fuzzy, hits);
        }

        var ranked = hits
            .OrderByDescending(h => h.score)
            .ThenByDescending(h => h.modified)
            .Take(limit)
            .Select(h => h.dto)
            .ToList();

        return ToolInvocationResult.Success($"Found {ranked.Count} match(es).", new { hits = ranked });
    }

    // ---------------------------------------------------------------- mapping

    public async Task<ToolInvocationResult> OutlineNoteAsync(OutlineNoteParameters p)
    {
        var (note, error) = await LoadAsync(p.NoteId).ConfigureAwait(false);
        if (error != null) return error;

        var previewChars = p.PreviewChars is > 0 and <= 200 ? p.PreviewChars!.Value : 60;
        var headingsOnly = p.HeadingsOnly ?? false;

        var entries = new List<Dictionary<string, object?>>();
        var ordinal = 0;
        foreach (var located in NoteBlockTree.Walk(note!.Blocks!))
        {
            if (headingsOnly && !NoteBlockTree.IsHeading(located.Block.Type))
                continue;
            ordinal++;
            var entry = NotesAgentBlockMapper.ToOutlineEntry(located.Block, ordinal, previewChars);
            entry["depth"] = located.Depth;
            entries.Add(entry);
        }

        return ToolInvocationResult.Success($"{entries.Count} block(s).", new
        {
            note_id = Handle(note),
            title = note.Title,
            version = Version(note),
            folder = note.FolderPath,
            favorite = note.IsFavorite,
            block_count = entries.Count,
            blocks = entries
        });
    }

    public async Task<ToolInvocationResult> ReadNoteAsync(ReadNoteParameters p)
    {
        var (note, error) = await LoadAsync(p.NoteId).ConfigureAwait(false);
        if (error != null) return error;

        var roots = note!.Blocks!;
        var selected = new List<Block>();
        var unresolved = new List<string>();

        if (p.BlockIds is { Count: > 0 })
        {
            foreach (var raw in p.BlockIds)
            {
                if (NoteBlockTree.TryLocate(roots, raw, out var loc, out _, out _))
                    selected.Add(loc.Block);
                else
                    unresolved.Add(raw);
            }
        }
        else if (!string.IsNullOrWhiteSpace(p.Section))
        {
            if (!NoteBlockTree.TryLocate(roots, p.Section!, out var loc, out var ambiguous, out var candidates))
                return ResolveFailure(p.Section!, ambiguous, candidates);
            selected.AddRange(SectionBlocks(roots, loc.Block));
        }
        else if (p.From is > 0 || p.To is > 0)
        {
            var from = Math.Max(1, p.From ?? 1);
            var to = p.To is > 0 ? p.To!.Value : roots.Count;
            for (var i = from; i <= Math.Min(to, roots.Count); i++)
                selected.Add(roots[i - 1]);
        }
        else
        {
            selected.AddRange(roots);
        }

        var noteHandle = await BuildNoteHandleResolverAsync(selected).ConfigureAwait(false);
        var blocks = selected.Select(b => NotesAgentBlockMapper.ToReadEntry(b, 0, noteHandle)).ToList();
        return ToolInvocationResult.Success($"{blocks.Count} block(s).", new
        {
            note_id = Handle(note),
            title = note.Title,
            version = Version(note),
            blocks,
            unresolved = unresolved.Count > 0 ? unresolved : null
        });
    }

    /// <summary>
    /// A GUID-to-handle lookup for <c>Page</c> block references, built only when one of the selected
    /// blocks (or its descendants) actually is a Page block. An ordinary read has nothing to resolve
    /// and should not pay for scanning the library.
    /// </summary>
    private async Task<Func<string, string>> BuildNoteHandleResolverAsync(List<Block> selected)
    {
        if (!NoteBlockTree.Walk(selected).Any(l => l.Block.Type == BlockType.Page))
            return static id => id;

        var summaries = await _notes.GetAllNoteSummariesAsync().ConfigureAwait(false);
        var sidByNoteId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in summaries)
        {
            if (!string.IsNullOrEmpty(s.Sid))
                sidByNoteId[s.NoteId] = s.Sid;
        }

        return id => !string.IsNullOrEmpty(id) && sidByNoteId.TryGetValue(id, out var sid) ? sid : id;
    }

    // ---------------------------------------------------------------- editing

    public async Task<ToolInvocationResult> EditNoteAsync(EditNoteParameters p)
    {
        var (note, error) = await LoadAsync(p.NoteId).ConfigureAwait(false);
        if (error != null) return error;
        if (p.Ops == null || p.Ops.Count == 0)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "ops is required and must be non-empty.");

        if (!string.IsNullOrWhiteSpace(p.ExpectedVersion) &&
            !string.Equals(p.ExpectedVersion.Trim(), Version(note!), StringComparison.Ordinal))
        {
            return ToolInvocationResult.Failure(ToolResultCodes.Conflict,
                "The note changed since it was read. Re-read it (outline_note/read_note) and retry with the new version.",
                new { note_id = Handle(note!), version = Version(note) });
        }

        // Apply to a clone so a failure mid-batch leaves the note untouched (all-or-nothing).
        var working = Clone(note!.Blocks!);

        for (var i = 0; i < p.Ops.Count; i++)
        {
            var opError = ApplyOp(working, p.Ops[i]);
            if (opError != null)
                return ToolInvocationResult.Failure(opError.Value.code, $"op[{i}] ({p.Ops[i].Op}): {opError.Value.message}",
                    new { note_id = Handle(note) });
        }

        NoteBlockTree.ReindexByPosition(working);
        // Blocks the ops built have no sid yet, and a copied one carries the sid it was copied from.
        // Repaired here rather than only at the write so the ids reported back address the tree that
        // was actually stored.
        BlockSids.Repair(working, new SidGenerator());

        // The version read at the top of this call is the base: an edit that took long enough for the
        // person in the editor to save must lose, not overwrite them.
        var commit = await _commits.CommitAsync(note.NoteId, working, note.Ver, Guid.NewGuid().ToString("N")).ConfigureAwait(false);
        switch (commit.Outcome)
        {
            case NoteCommitOutcome.Stale:
                return ToolInvocationResult.Failure(ToolResultCodes.Conflict,
                    "The note changed while this edit was being applied. Re-read it (outline_note/read_note) and retry with the new version.",
                    new { note_id = Handle(note), version = VersionOf(commit.Ver) });
            case NoteCommitOutcome.NotFound:
                return ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"No note with id \"{Handle(note)}\".");
            case NoteCommitOutcome.Applied or NoteCommitOutcome.AlreadyApplied:
                break;
            default:
                return ToolInvocationResult.Failure(ToolResultCodes.InternalError, "Save failed.");
        }

        return ToolInvocationResult.Success($"Applied {p.Ops.Count} op(s).", new
        {
            note_id = Handle(note),
            version = VersionOf(commit.Ver),
            applied = p.Ops.Count,
            block_count = working.Count
        });
    }

    // ---------------------------------------------------------------- create

    public async Task<ToolInvocationResult> CreateNoteAsync(CreateNoteParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Title))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "title is required.");

        var note = new Note { Title = p.Title.Trim(), IsFavorite = p.Favorite ?? false };

        if (p.Blocks is { Count: > 0 })
            note.Blocks = NoteToolBlockFactory.FromSpecs(p.Blocks);
        else if (!string.IsNullOrEmpty(p.Markdown))
            note.Blocks = NoteBlockMarkdownConverter.Deserialize(p.Markdown);
        else
            note.Blocks = [];

        NoteBlockTree.ReindexByPosition(note.Blocks);
        BlockSids.Repair(note.Blocks, new SidGenerator());
        note.Content = string.Empty;

        if (!string.IsNullOrWhiteSpace(p.Folder))
        {
            var (folderId, folderName) = await ResolveFolderAsync(p.Folder!.Trim()).ConfigureAwait(false);
            note.FolderId = folderId;
            note.FolderPath = folderName ?? p.Folder!.Trim();
        }

        var res = await _notes.SaveNoteAsync(note).ConfigureAwait(false);
        return res.IsSuccess
            ? ToolInvocationResult.Success($"Note created (id: {Handle(note)}).",
                new { note_id = Handle(note), title = note.Title, version = Version(note), block_count = note.Blocks.Count })
            : ToolInvocationResult.Failure(ToolResultCodes.InternalError, res.ErrorMessage ?? "Save failed.");
    }

    // ---------------------------------------------------------------- manage

    public async Task<ToolInvocationResult> ManageNoteAsync(ManageNoteParameters p)
    {
        var (note, error) = await LoadAsync(p.NoteId).ConfigureAwait(false);
        if (error != null) return error;

        if (p.Delete == true)
        {
            var del = await _notes.DeleteNoteAsync(note!.NoteId).ConfigureAwait(false);
            return del.IsSuccess
                ? ToolInvocationResult.Success($"Note deleted (id: {Handle(note)}).", new { note_id = Handle(note), deleted = true })
                : ToolInvocationResult.Failure(ToolResultCodes.InternalError, del.ErrorMessage ?? "Delete failed.");
        }

        // Filing and favouriting are metadata, so they go through the metadata write and leave the
        // note's version where it is. Renaming a note somebody has open must not end their session.
        var metadata = NoteMetadata.FromNote(note!);
        var changed = false;

        if (!string.IsNullOrWhiteSpace(p.Rename))
        {
            metadata = metadata with { Title = p.Rename.Trim() };
            changed = true;
        }

        if (p.ClearFolder == true)
        {
            metadata = metadata with { FolderId = null, FolderPath = string.Empty };
            changed = true;
        }
        else if (!string.IsNullOrWhiteSpace(p.MoveToFolder))
        {
            var (folderId, folderName) = await ResolveFolderAsync(p.MoveToFolder!.Trim()).ConfigureAwait(false);
            metadata = metadata with { FolderId = folderId, FolderPath = folderName ?? p.MoveToFolder!.Trim() };
            changed = true;
        }

        if (p.Favorite.HasValue)
        {
            metadata = metadata with { IsFavorite = p.Favorite.Value };
            changed = true;
        }

        if (!changed)
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError,
                "Nothing to do. Provide rename, move_to_folder, clear_folder, favorite, or delete.");

        var result = await _commits.UpdateMetadataAsync(note!.NoteId, metadata).ConfigureAwait(false);
        return result.Outcome switch
        {
            NoteCommitOutcome.Applied => ToolInvocationResult.Success($"Note updated (id: {Handle(note)}).",
                new { note_id = Handle(note), title = metadata.Title, favorite = metadata.IsFavorite, folder = metadata.FolderPath }),
            NoteCommitOutcome.NotFound => ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"No note with id \"{Handle(note)}\"."),
            _ => ToolInvocationResult.Failure(ToolResultCodes.InternalError, "Save failed."),
        };
    }

    // ---------------------------------------------------------------- UI

    public async Task<ToolInvocationResult> OpenNoteAsync(OpenNoteParameters p)
    {
        var (note, error) = await LoadAsync(p.NoteId).ConfigureAwait(false);
        if (error != null) return error;

        await _ui.InvokeAsync(() =>
        {
            _nav.NavigateTo("notes", note!.NoteId);
            return Task.CompletedTask;
        }).ConfigureAwait(false);

        return ToolInvocationResult.Success($"Opened note \"{note!.Title}\" (id: {Handle(note)}).", new { note_id = Handle(note) });
    }

    // ---------------------------------------------------------------- edit ops

    private static (string code, string message)? ApplyOp(List<Block> roots, NoteEditOp op)
    {
        var kind = (op.Op ?? string.Empty).Trim().ToLowerInvariant();
        switch (kind)
        {
            case "set_text":
                return ApplySetText(roots, op);
            case "replace":
                return ApplyReplace(roots, op);
            case "insert":
                return ApplyInsert(roots, op);
            case "delete":
                return ApplyDelete(roots, op);
            case "move":
                return ApplyMove(roots, op);
            case "convert":
                return ApplyConvert(roots, op);
            case "set_checked":
                return ApplySetChecked(roots, op);
            default:
                return ("validation_error",
                    $"unknown op \"{op.Op}\". Use set_text, replace, insert, delete, move, convert, or set_checked.");
        }
    }

    private static (string, string)? ApplySetText(List<Block> roots, NoteEditOp op)
    {
        if (!Locate(roots, op.Id, out var loc, out var fail)) return fail;
        var block = loc.Block;

        switch (block.Type)
        {
            case BlockType.Equation:
                block.Payload = new EquationPayload((op.Latex ?? op.Markdown ?? string.Empty).Trim());
                break;
            case BlockType.Code:
                var existing = block.Payload as CodePayload;
                var lang = !string.IsNullOrWhiteSpace(op.Language)
                    ? op.Language!.Trim()
                    : (existing?.Language ?? "csharp");
                var src = op.Markdown ?? string.Empty;
                // Rewriting the source is not a reason to undo the reader's wrap,
                // line-number and caption choices for this block.
                block.Payload = new CodePayload(
                    lang,
                    src,
                    existing?.Wrap ?? false,
                    existing?.Numbers ?? false,
                    existing?.Caption ?? string.Empty);
                block.Spans = new List<InlineSpan> { InlineSpan.Plain(src) };
                break;
            default:
                block.Spans = InlineMarkdownParser.ToSpans(op.Markdown ?? string.Empty);
                if (NoteBlockTree.IsHeading(block.Type))
                    EnsureHeadingBold(block);
                break;
        }

        return null;
    }

    private static (string, string)? ApplyReplace(List<Block> roots, NoteEditOp op)
    {
        if (!Locate(roots, op.Id, out var loc, out var fail)) return fail;

        var spec = new NoteBlockSpec
        {
            Type = string.IsNullOrWhiteSpace(op.Type) ? loc.Block.Type.ToString() : op.Type!,
            Markdown = op.Markdown,
            Latex = op.Latex,
            Language = op.Language,
            Checked = op.Checked
        };

        var replacement = NoteToolBlockFactory.FromSpec(spec, loc.Block.Order);
        replacement.Id = loc.Block.Id;
        replacement.Sid = loc.Block.Sid;
        loc.Container[loc.Index] = replacement;
        return null;
    }

    private static (string, string)? ApplyInsert(List<Block> roots, NoteEditOp op)
    {
        var specs = op.Blocks is { Count: > 0 }
            ? op.Blocks
            : new List<NoteBlockSpec> { new() { Type = string.IsNullOrWhiteSpace(op.Type) ? "Text" : op.Type!, Markdown = op.Markdown, Latex = op.Latex, Language = op.Language, Checked = op.Checked } };

        if (specs.Count == 1 && string.IsNullOrEmpty(specs[0].Markdown) && string.IsNullOrEmpty(specs[0].Latex)
            && specs[0].Type.Equals("Text", StringComparison.OrdinalIgnoreCase) && specs[0].Children is null)
            return ("validation_error", "insert has no content. Provide blocks[] or markdown.");

        var blocks = NoteToolBlockFactory.FromSpecs(specs);
        var position = (op.Position ?? "end").Trim().ToLowerInvariant();

        List<Block> container;
        int index;

        if (!string.IsNullOrWhiteSpace(op.Anchor))
        {
            if (!Locate(roots, op.Anchor, out var anchor, out var fail)) return fail;
            container = anchor.Container;
            index = position == "before" ? anchor.Index : anchor.Index + 1;
        }
        else
        {
            container = roots;
            index = position == "start" ? 0 : roots.Count;
        }

        container.InsertRange(Math.Clamp(index, 0, container.Count), blocks);
        return null;
    }

    private static (string, string)? ApplyDelete(List<Block> roots, NoteEditOp op)
    {
        var ids = new List<string>();
        if (op.Ids is { Count: > 0 }) ids.AddRange(op.Ids);
        if (!string.IsNullOrWhiteSpace(op.Id)) ids.Add(op.Id!);
        if (ids.Count == 0)
            return ("validation_error", "delete requires id or ids.");

        foreach (var raw in ids)
        {
            if (!Locate(roots, raw, out var loc, out var fail)) return fail;
            loc.Container.RemoveAt(loc.Index);
        }

        return null;
    }

    private static (string, string)? ApplyMove(List<Block> roots, NoteEditOp op)
    {
        if (!Locate(roots, op.Id, out var loc, out var fail)) return fail;
        if (string.IsNullOrWhiteSpace(op.Anchor))
            return ("validation_error", "move requires an anchor.");

        var moving = loc.Block;
        loc.Container.RemoveAt(loc.Index);

        if (!Locate(roots, op.Anchor, out var anchor, out var anchorFail))
            return anchorFail;

        var position = (op.Position ?? "after").Trim().ToLowerInvariant();
        var index = position == "before" ? anchor.Index : anchor.Index + 1;
        anchor.Container.Insert(Math.Clamp(index, 0, anchor.Container.Count), moving);
        return null;
    }

    private static (string, string)? ApplyConvert(List<Block> roots, NoteEditOp op)
    {
        if (!Locate(roots, op.Id, out var loc, out var fail)) return fail;
        if (!Enum.TryParse<BlockType>(op.Type, true, out var newType))
            return ("validation_error", $"invalid type \"{op.Type}\".");

        var block = loc.Block;
        block.Type = newType;
        if (newType == BlockType.Checklist)
            block.Payload = new ChecklistPayload(op.Checked ?? (block.Payload is ChecklistPayload cp && cp.Checked));
        else if (block.Payload is ChecklistPayload)
            block.Payload = new EmptyPayload();

        if (NoteBlockTree.IsHeading(newType))
            EnsureHeadingBold(block);

        return null;
    }

    private static (string, string)? ApplySetChecked(List<Block> roots, NoteEditOp op)
    {
        if (!Locate(roots, op.Id, out var loc, out var fail)) return fail;
        var block = loc.Block;
        if (block.Type != BlockType.Checklist)
            return ("validation_error", "set_checked targets a Checklist block.");
        block.Payload = new ChecklistPayload(op.Checked ?? true);
        return null;
    }

    // ---------------------------------------------------------------- helpers

    private static bool Locate(List<Block> roots, string? idOrPrefix, out NoteBlockTree.Located located, out (string, string)? failure)
    {
        located = default;
        failure = null;
        if (string.IsNullOrWhiteSpace(idOrPrefix))
        {
            failure = ("validation_error", "block id is required.");
            return false;
        }

        if (NoteBlockTree.TryLocate(roots, idOrPrefix, out located, out var ambiguous, out var candidates))
            return true;

        failure = ambiguous
            ? ("validation_error", $"id \"{idOrPrefix}\" is ambiguous; candidates: {string.Join(", ", candidates)}.")
            : ("not_found", $"no block matching \"{idOrPrefix}\".");
        return false;
    }

    private static ToolInvocationResult ResolveFailure(string id, bool ambiguous, IReadOnlyList<string> candidates) =>
        ambiguous
            ? ToolInvocationResult.Failure(ToolResultCodes.ValidationError,
                $"id \"{id}\" is ambiguous; candidates: {string.Join(", ", candidates)}.")
            : ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"no block matching \"{id}\".");

    /// <summary>
    /// Resolves <paramref name="rawId"/> as a note sid first, then as its GUID. A sid is the address
    /// the model was handed back by every other tool, but the GUID still works so a caller holding
    /// one from before the sid migration, or from storage, is not left stranded.
    /// </summary>
    private async Task<(Note? note, ToolInvocationResult? error)> LoadAsync(string rawId)
    {
        var id = rawId?.Trim() ?? string.Empty;
        if (id.Length == 0)
            return (null, ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "note_id is required."));

        Note? note = null;
        var summaries = await _notes.GetAllNoteSummariesAsync().ConfigureAwait(false);
        var bySid = summaries.FirstOrDefault(s => string.Equals(s.Sid, id, StringComparison.OrdinalIgnoreCase));
        if (bySid != null)
            note = await _notes.GetNoteAsync(bySid.NoteId).ConfigureAwait(false);

        note ??= await _notes.GetNoteAsync(id).ConfigureAwait(false);
        if (note == null)
            return (null, ToolInvocationResult.Failure(ToolResultCodes.NotFound, $"No note with id \"{id}\"."));

        NoteDocumentHelper.EnsureBlocks(note);
        return (note, null);
    }

    /// <summary>The model-facing handle for a note: its sid, or its GUID when no sid has been minted yet.</summary>
    private static string Handle(Note note) => string.IsNullOrEmpty(note.Sid) ? note.NoteId : note.Sid;

    private async Task<(string? folderId, string? folderName)> ResolveFolderAsync(string value)
    {
        if (_folders == null)
            return (value, value);

        var folders = (await _folders.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
        var byId = folders.FirstOrDefault(f => string.Equals(f.FolderId, value, StringComparison.Ordinal));
        if (byId != null)
            return (byId.FolderId, byId.Name);

        var byName = folders.FirstOrDefault(f => string.Equals(f.Name, value, StringComparison.OrdinalIgnoreCase));
        if (byName != null)
            return (byName.FolderId, byName.Name);

        // Unknown folder: keep the raw value so the note still carries a breadcrumb.
        return (null, value);
    }

    private static IEnumerable<Block> SectionBlocks(List<Block> roots, Block heading)
    {
        if (!NoteBlockTree.IsHeading(heading.Type))
        {
            yield return heading;
            yield break;
        }

        var level = NoteBlockTree.HeadingLevel(heading.Type);
        var started = false;
        foreach (var b in roots)
        {
            if (!started)
            {
                if (ReferenceEquals(b, heading))
                {
                    started = true;
                    yield return b;
                }

                continue;
            }

            if (NoteBlockTree.IsHeading(b.Type) && NoteBlockTree.HeadingLevel(b.Type) <= level)
                yield break;
            yield return b;
        }
    }

    private void CollectHits(
        Note note,
        IReadOnlyList<string> tokens,
        bool matchAll,
        bool fuzzy,
        List<(double, DateTime, Dictionary<string, object?>)> hits)
    {
        var title = note.Title ?? string.Empty;
        var titleMatched = TextSearchMatch.MatchTokens(title, tokens, matchAll, fuzzy);
        var path = new List<string>();

        foreach (var located in NoteBlockTree.Walk(note.Blocks!))
        {
            var b = located.Block;
            b.EnsureSpans();

            if (NoteBlockTree.IsHeading(b.Type))
            {
                var level = NoteBlockTree.HeadingLevel(b.Type);
                while (path.Count >= level) path.RemoveAt(path.Count - 1);
                while (path.Count < level - 1) path.Add(string.Empty);
                path.Add(b.Content);
            }

            var text = b.Content ?? string.Empty;
            if (text.Length == 0 || !TextSearchMatch.MatchTokens(text, tokens, matchAll, fuzzy))
                continue;

            var matched = tokens.Count(t => TextSearchMatch.MatchTokens(text, new[] { t }, false, fuzzy));
            var score = matched + (titleMatched ? 0.5 : 0) + (NoteBlockTree.IsHeading(b.Type) ? 0.5 : 0);

            string snippet;
            if (TextSearchMatch.TryGetSnippetSpan(text, tokens, fuzzy, out var start, out var len))
                snippet = text.Substring(start, len);
            else
                snippet = text.Length <= 120 ? text : text[..120];

            hits.Add((score, note.ModifiedAt, new Dictionary<string, object?>
            {
                ["note_id"] = Handle(note),
                ["title"] = note.Title,
                ["block_id"] = NoteBlockTree.Handle(b),
                ["type"] = b.Type.ToString(),
                ["heading_path"] = string.Join(" > ", path.Where(s => s.Length > 0)),
                ["snippet"] = snippet
            }));
        }
    }

    private static object NoteSummary(Note n) => new
    {
        id = Handle(n),
        title = n.Title,
        folder = n.FolderPath,
        favorite = n.IsFavorite,
        modifiedUtc = n.ModifiedAt
    };

    /// <summary>
    /// The note's stored version, which is the same token the editor commits against. It was the
    /// modification timestamp once, which moved for a rename and so reported a conflict for a change
    /// to the body that had not happened.
    /// </summary>
    private static string Version(Note note) => VersionOf(note.Ver);

    private static string VersionOf(long ver) => ver.ToString(CultureInfo.InvariantCulture);

    private static List<Block> Clone(List<Block> blocks)
    {
        var json = JsonSerializer.Serialize(blocks, CloneOptions);
        return JsonSerializer.Deserialize<List<Block>>(json, CloneOptions) ?? new List<Block>();
    }

    private static void EnsureHeadingBold(Block b)
    {
        b.EnsureSpans();
        var list = new List<InlineSpan>();
        foreach (var s in b.Spans)
            list.Add(s is TextSpan t ? t with { Style = t.Style.WithSet(Mnemo.Core.Formatting.InlineFormatKind.Bold) } : s);
        b.Spans = Mnemo.Core.Formatting.InlineSpanFormatApplier.Normalize(list);
    }
}
