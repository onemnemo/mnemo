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
/// A request to lay the map out.
/// <para>
/// <paramref name="Sizes"/> is <c>id -&gt; [width, height]</c> as the client rendered them. A node's size
/// is the width of its rendered text, which only the client that measured it knows; without them every
/// layout would space the map by a guess. <paramref name="Algorithm"/> overrides each cluster's own
/// choice for this one pass, for an arrange that asks for a particular arrangement.
/// </para>
/// </summary>
public sealed record ArrangeMindmapDto(
    long ExpectedRevision,
    string? Algorithm,
    IReadOnlyDictionary<string, double[]>? Sizes);

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
/// <paramref name="BaseRevision"/> is the precondition for using any of them: the deltas describe the
/// step from that revision to <paramref name="Revision"/>, and folding <paramref name="Redo"/> into a
/// document at any other revision produces a state neither side ever had. A stale batch that the server
/// rebased commits against a document the client never held, and this is how the client finds out.
/// </para>
/// <para>
/// The deltas and the order are null when the write changed nothing, which is not a failure: there is
/// simply nothing to fold and nothing to undo.
/// </para>
/// </summary>
public sealed record MindmapOpsResultDto(
    long Revision,
    long BaseRevision,
    IReadOnlyDictionary<string, string> CreatedIds,
    int DeletedCount,
    MindmapRestoreDelta? Undo,
    MindmapRestoreDelta? Redo,
    MindmapDocumentOrderDto? Order);

/// <summary>Element and edge ids in document order; see <see cref="MindmapOpsResultDto"/>.</summary>
public sealed record MindmapDocumentOrderDto(
    IReadOnlyList<string> Elements,
    IReadOnlyList<string> Edges);

/// <summary>
/// What a restore hands back. The client already holds both directions of the delta it sent, so this is
/// only the revision the map landed on, the one it applied against, and the order it settled into.
/// </summary>
public sealed record MindmapRestoreResultDto(long Revision, long BaseRevision, MindmapDocumentOrderDto? Order);

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

/// <summary>
/// The style templates a map can draw from: the six built-ins plus whatever the user saved, and which
/// of them a document that names none resolves against.
/// <para>
/// <paramref name="BuiltInIds"/> is what tells the two apart, since a template carries no flag saying
/// where it came from. The client needs to know because only a saved one can be deleted, and the id
/// prefix the store happens to mint is a contract nobody wrote down.
/// </para>
/// </summary>
public sealed record MindmapTemplatesDto(
    string DefaultId,
    IReadOnlyList<StyleTemplate> Templates,
    IReadOnlyList<string> BuiltInIds);

/// <summary>
/// How much of a subtree is worth saving: the depth bands under the chosen node that actually carry a
/// style override. Zero means nothing there was styled, and there is no template to make.
/// </summary>
public sealed record MindmapCaptureInfoDto(int AvailableLevels);

/// <summary>
/// Save the subtree at <paramref name="RootId"/> as a template named <paramref name="Name"/>, taking
/// <paramref name="Levels"/> depth bands from it.
/// </summary>
public sealed record MindmapCaptureTemplateDto(string RootId, string Name, int Levels);

/// <summary>
/// A stored canvas image: the file name an image element carries, and how big the upload was.
/// <para>
/// No pixel size, deliberately. The client decoded the file to place the element and already knows
/// it, and reading it here would mean an image decoder in the host for a number it would then send
/// back to whoever just measured it.
/// </para>
/// </summary>
public sealed record MindmapAssetDto(string AssetId, long SizeBytes);
