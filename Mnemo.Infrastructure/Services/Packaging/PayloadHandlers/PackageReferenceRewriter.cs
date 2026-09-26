using System.Text.RegularExpressions;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Points the references an imported item carries at the ids its targets were actually stored
/// under. Only ids in a rename table move; a reference to anything the import did not rename is left
/// exactly as it arrived, and nothing is read out of free text such as a typed link's URL.
/// </summary>
internal static partial class PackageReferenceRewriter
{
    /// <summary>Rewrites a note's parent, its sub-page blocks, and the page lines of legacy markdown content.</summary>
    public static void RewriteNote(Note note, IReadOnlyDictionary<string, string> noteIds)
    {
        if (noteIds.Count == 0)
            return;

        if (note.ParentNoteId is { } parent && noteIds.TryGetValue(parent, out var movedParent))
            note.ParentNoteId = movedParent;

        RewriteBlocks(note.Blocks, noteIds);

        if (!string.IsNullOrEmpty(note.Content) && note.Content.Contains("[[page:", StringComparison.Ordinal))
        {
            note.Content = PageLine().Replace(note.Content, match =>
                noteIds.TryGetValue(match.Groups["id"].Value, out var moved)
                    ? $"{match.Groups["lead"].Value}[[page:{moved}]]{match.Groups["tail"].Value}"
                    : match.Value);
        }
    }

    private static void RewriteBlocks(List<Block>? blocks, IReadOnlyDictionary<string, string> noteIds)
    {
        if (blocks is null)
            return;

        foreach (var block in blocks)
        {
            if (block.Payload is PagePayload page && noteIds.TryGetValue(page.ReferenceNoteId, out var moved))
                block.Payload = page with { ReferenceNoteId = moved };
            RewriteBlocks(block.Children, noteIds);
        }
    }

    /// <summary>The same document with its note and flashcard nodes pointed at what was stored.</summary>
    public static MindmapDocument RewriteMap(
        MindmapDocument document,
        IReadOnlyDictionary<string, string> noteIds,
        IReadOnlyDictionary<string, string> deckIds,
        IReadOnlyDictionary<string, string> cardIds)
    {
        if (noteIds.Count == 0 && deckIds.Count == 0 && cardIds.Count == 0)
            return document;

        var changed = false;
        var elements = new List<MindmapElement>(document.Elements.Count);
        foreach (var element in document.Elements)
        {
            var content = element.Content switch
            {
                NoteContent note when noteIds.TryGetValue(note.NoteId, out var moved) => note with { NoteId = moved },
                FlashcardContent card => RewriteFlashcard(card, deckIds, cardIds),
                _ => element.Content,
            };

            if (!ReferenceEquals(content, element.Content))
            {
                changed = true;
                elements.Add(element with { Content = content });
            }
            else
            {
                elements.Add(element);
            }
        }

        return changed ? document with { Elements = elements } : document;
    }

    private static IElementContent RewriteFlashcard(
        FlashcardContent card,
        IReadOnlyDictionary<string, string> deckIds,
        IReadOnlyDictionary<string, string> cardIds)
    {
        var deckMoved = deckIds.TryGetValue(card.DeckId, out var deckId);
        string? cardId = null;
        var cardMoved = card.CardId is { } id && cardIds.TryGetValue(id, out cardId);
        if (!deckMoved && !cardMoved)
            return card;

        return card with
        {
            DeckId = deckMoved ? deckId! : card.DeckId,
            CardId = cardMoved ? cardId : card.CardId,
        };
    }

    /// <summary>A page block in markdown content: the token alone on its line, as the markdown reader requires.</summary>
    [GeneratedRegex(@"^(?<lead>[ \t]*)\[\[page:(?<id>[^\]\r\n]+)\]\](?<tail>[ \t]*\r?)$", RegexOptions.Multiline)]
    private static partial Regex PageLine();
}
