using System.Text.Json;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Host.Contracts;

/// <summary>
/// Wire shapes for the mindmap surface.
/// <para>
/// Documents, deltas, elements, edges and styles are NOT re-declared here: they go over the wire as
/// the storage records themselves, serialized with <c>MindmapDocumentSerializer.Options</c>. That
/// keeps the wire and the file byte-identical in shape, so a content kind added to the model reaches
/// the SPA without a DTO to update and cannot silently lose a field in translation. What lives here
/// is only the request/response envelopes, which have no storage counterpart.
/// </para>
/// </summary>
public sealed record MindmapFolderDto(string Id, string Name, string? ParentId, int Order);

/// <summary>
/// Creates an empty map. Seeding from an outline is deliberately not here: the SPA creates the map
/// and sends an <c>add</c> op, which is the same path every other node it ever creates takes, and one
/// wire grammar for "make nodes" instead of two that have to agree.
/// </summary>
public sealed record CreateMindmapDto(
    string? Title,
    string? LayoutAlgorithm,
    string? TemplateId,
    string? FolderId);

public sealed record RenameMindmapDto(string Title);

public sealed record DuplicateMindmapDto(string? Title);

public sealed record MoveMindmapDto(string? FolderId);

/// <summary>An edit batch: the revision the client edited, and the ops in the shared wire grammar.</summary>
public sealed record ApplyMindmapOpsDto(long ExpectedRevision, JsonElement Ops);

public sealed record RestoreMindmapDto(long ExpectedRevision, MindmapRestoreDelta Delta);

/// <summary>
/// What an accepted batch hands back.
/// <para>
/// <paramref name="Redo"/> carries the batch's own effect, so the client folds it into the document it
/// already holds instead of refetching the whole map on every keystroke-sized edit; <paramref name="Undo"/>
/// is its inverse and goes straight onto the undo stack. <paramref name="Order"/> is the load-bearing
/// companion to both: sibling order lives in the edge array's ORDER, which a set-shaped delta cannot
/// express, so an inserted sibling would land last without it. Applying the delta and then sorting to
/// these id lists reproduces the server's document exactly.
/// </para>
/// <para>
/// All three are null when a concurrent commit interleaved with this one. The client cannot fold a
/// delta it cannot trust, so it refetches; <paramref name="Revision"/> is still authoritative.
/// </para>
/// </summary>
public sealed record MindmapOpsResultDto(
    long Revision,
    IReadOnlyDictionary<string, string> CreatedIds,
    int DeletedCount,
    MindmapRestoreDelta? Undo,
    MindmapRestoreDelta? Redo,
    MindmapDocumentOrderDto? Order);

/// <summary>Element and edge ids in document order; see <see cref="MindmapOpsResultDto"/>.</summary>
public sealed record MindmapDocumentOrderDto(
    IReadOnlyList<string> Elements,
    IReadOnlyList<string> Edges);

/// <summary>What a restore hands back: the new revision, and the order the restored document settled into.</summary>
public sealed record MindmapRestoreResultDto(long Revision, MindmapDocumentOrderDto Order);

/// <summary>
/// A rejected batch. <paramref name="Code"/> is the machine-readable reason
/// (<c>rev_conflict</c>, <c>not_found</c>, <c>would_cycle</c>, <c>bad_content_type</c>,
/// <c>validation_error</c>), matching the codes the AI tool layer already returns.
/// </summary>
public sealed record MindmapEditErrorDto(
    string Code,
    string Message,
    long Revision,
    int? FailedOpIndex,
    IReadOnlyList<string>? ContendedIds,
    IReadOnlyList<string>? Suggestions);

public sealed record MindmapFindResultDto(long Revision, IReadOnlyList<MindmapFindHitDto> Hits);

public sealed record MindmapFindHitDto(string ElementId, string Text, string Path);

/// <summary>The style templates a map can draw from: the six built-ins plus whatever the user saved.</summary>
public sealed record MindmapTemplatesDto(IReadOnlyList<StyleTemplate> Templates);
