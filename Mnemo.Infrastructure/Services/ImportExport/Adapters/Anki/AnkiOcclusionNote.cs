namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>
/// An image occlusion note with its shapes mapped and its fields found by tag, since their names are translated.
/// </summary>
/// <param name="BackFields">The fields shown under the picture on the answer, in order.</param>
internal sealed record AnkiOcclusionNote(
    AnkiOcclusionMapped Mapped,
    int ImageField,
    int? HeaderField,
    IReadOnlyList<int> BackFields,
    int? CommentsField)
{
    private const int OcclusionTag = 0;
    private const int ImageTag = 1;
    private const int HeaderTag = 2;
    private const int BackExtraTag = 3;
    private const int CommentsTag = 4;

    /// <summary>Null for any other note, and for one with no shape that can become a mask.</summary>
    public static AnkiOcclusionNote? From(long noteId, string[] fields, AnkiNoteType? type)
    {
        if (type is not { IsImageOcclusion: true }
            || type.FieldIndexByTag(OcclusionTag) is not { } occlusion || occlusion >= fields.Length
            || type.FieldIndexByTag(ImageTag) is not { } image)
            return null;

        var mapped = AnkiOcclusionMapper.Map(noteId, AnkiOcclusionParser.Parse(fields[occlusion]));
        return mapped is null
            ? null
            : new AnkiOcclusionNote(
                mapped,
                image,
                type.FieldIndexByTag(HeaderTag),
                type.FieldIndexByTag(BackExtraTag) is { } backExtra ? [backExtra] : [],
                type.FieldIndexByTag(CommentsTag));
    }

    /// <summary>A set of Image Occlusion Enhanced notes as one note.</summary>
    /// <param name="noteId">The note the set lands as, which seeds the mask ids.</param>
    public static AnkiOcclusionNote? FromEnhanced(long noteId, EnhancedLayout layout, IReadOnlyList<AnkiOcclusionShape> shapes) =>
        AnkiOcclusionMapper.Map(noteId, shapes) is { } mapped
            ? new AnkiOcclusionNote(mapped, layout.Image, layout.Header, layout.Back, CommentsField: null)
            : null;
}
