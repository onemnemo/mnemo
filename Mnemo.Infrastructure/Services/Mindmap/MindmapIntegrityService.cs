using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// Loads a map and reports its dangling references (see <see cref="IMindmapIntegrityService"/>). Note and
/// flashcard refs are checked with the cheapest existence lookup on their services; image assets resolve by
/// the same rule the editor uses — a bare asset id lives under the images directory, a rooted path is used
/// as-is. Cancellation is honored between element lookups.
/// </summary>
public sealed class MindmapIntegrityService : IMindmapIntegrityService
{
    private readonly IMindmapService _mindmaps;
    private readonly INoteService _notes;
    private readonly IFlashcardLibraryService _decks;
    private readonly ILoggerService _logger;

    public MindmapIntegrityService(
        IMindmapService mindmaps,
        INoteService notes,
        IFlashcardLibraryService decks,
        ILoggerService logger)
    {
        _mindmaps = mindmaps;
        _notes = notes;
        _decks = decks;
        _logger = logger;
    }

    public async Task<Result<MindmapIntegrityReport>> SweepAsync(string mapId, CancellationToken cancellationToken = default)
    {
        try
        {
            var loaded = await _mindmaps.GetAsync(mapId, cancellationToken).ConfigureAwait(false);
            if (!loaded.IsSuccess || loaded.Value is null)
                return Result<MindmapIntegrityReport>.Failure(loaded.ErrorMessage ?? $"Mindmap '{mapId}' was not found.");

            var document = loaded.Value;
            var imagesDirectory = MnemoAppPaths.GetImagesDirectory();
            var issues = new List<MindmapIntegrityIssue>();

            foreach (var element in document.Elements)
            {
                cancellationToken.ThrowIfCancellationRequested();
                switch (element.Content)
                {
                    case NoteContent note when !string.IsNullOrWhiteSpace(note.NoteId):
                        if (await _notes.GetNoteAsync(note.NoteId).ConfigureAwait(false) is null)
                            issues.Add(Issue(element, MindmapIntegrityIssueKind.MissingNote, note.NoteId));
                        break;

                    case FlashcardContent card when !string.IsNullOrWhiteSpace(card.DeckId):
                        if (await _decks.GetDeckAsync(card.DeckId, cancellationToken).ConfigureAwait(false) is null)
                            issues.Add(Issue(element, MindmapIntegrityIssueKind.MissingDeck, card.DeckId));
                        break;

                    case ImageContent image when !string.IsNullOrWhiteSpace(image.AssetId):
                        if (!AssetExists(imagesDirectory, image.AssetId))
                            issues.Add(Issue(element, MindmapIntegrityIssueKind.MissingImageAsset, image.AssetId));
                        break;

                    case CanvasImageContent canvas when !string.IsNullOrWhiteSpace(canvas.AssetId):
                        if (!AssetExists(imagesDirectory, canvas.AssetId))
                            issues.Add(Issue(element, MindmapIntegrityIssueKind.MissingImageAsset, canvas.AssetId));
                        break;
                }
            }

            return Result<MindmapIntegrityReport>.Success(new MindmapIntegrityReport
            {
                MapId = document.Id,
                Revision = document.Revision,
                Issues = issues,
            });
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Integrity sweep failed for '{mapId}'.", ex);
            return Result<MindmapIntegrityReport>.Failure($"Integrity sweep failed for '{mapId}'.", ex);
        }
    }

    private static MindmapIntegrityIssue Issue(MindmapElement element, MindmapIntegrityIssueKind kind, string targetId) => new()
    {
        ElementId = element.Id,
        Kind = kind,
        TargetId = targetId,
        ElementText = MindmapSearchText.Extract(element),
    };

    private static bool AssetExists(string imagesDirectory, string assetId)
    {
        var path = Path.IsPathRooted(assetId) ? assetId : Path.Combine(imagesDirectory, assetId);
        return File.Exists(path);
    }
}
