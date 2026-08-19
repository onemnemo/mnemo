namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// What fields exist and which layouts to build from them. Card types are collection wide rather
/// than per deck, so one type can be edited once and every deck using it follows.
/// </summary>
/// <param name="IsBuiltIn">
/// Shipped with the app. Fields and layouts can still be edited; the generator cannot, because
/// changing it would change how many cards every existing fact makes.
/// </param>
/// <param name="SortFieldId">The field that stands for a fact in lists and search results.</param>
/// <param name="Generator">
/// <see cref="FlashcardGenerators.Cloze"/>, <see cref="FlashcardGenerators.Occlusion"/>, or null
/// for an ordinary type whose cards come from <see cref="Layouts"/>. A token rather than an enum:
/// it is persisted as text, so a value written by a later build reads back as itself instead of
/// as an out of range number.
/// </param>
/// <param name="GenerateFrom">
/// The field the generator reads, or null to fall back to <see cref="SortFieldId"/>. Cloze reads
/// text; occlusion reads an image.
/// </param>
public sealed record FlashcardCardType(
    string Id,
    string Name,
    bool IsBuiltIn,
    IReadOnlyList<FlashcardField> Fields,
    string SortFieldId,
    IReadOnlyList<FlashcardLayout> Layouts,
    string? Generator = null,
    string? GenerateFrom = null,
    DateTimeOffset CreatedAt = default,
    DateTimeOffset UpdatedAt = default)
{
    /// <summary>Id of the seeded two field type every migrated classic card belongs to.</summary>
    public const string BasicId = "basic";

    /// <summary>Id of the seeded type that asks the same two fields in both directions.</summary>
    public const string BasicReverseId = "basic-reverse";

    /// <summary>Id of the seeded three field type for vocabulary.</summary>
    public const string VocabularyId = "vocabulary";

    /// <summary>Id of the seeded type every migrated cloze card belongs to.</summary>
    public const string ClozeId = "cloze";

    /// <summary>Field id holding the question on <see cref="BasicId"/>.</summary>
    public const string BasicFrontFieldId = "front";

    /// <summary>Field id holding the answer on <see cref="BasicId"/>.</summary>
    public const string BasicBackFieldId = "back";

    /// <summary>Field id holding the deletion bearing text on <see cref="ClozeId"/>.</summary>
    public const string ClozeTextFieldId = "text";

    /// <summary>Field id shown on every card a cloze fact makes.</summary>
    public const string ClozeExtraFieldId = "extra";

    /// <summary>Layout id of the single card a basic fact makes.</summary>
    public const string RecognitionLayoutId = "recognition";

    /// <summary>Layout id of the reversed card.</summary>
    public const string RecallLayoutId = "recall";

    /// <summary>The layouts this type would use, ignoring any generator.</summary>
    public string EffectiveGenerateFrom => string.IsNullOrEmpty(GenerateFrom) ? SortFieldId : GenerateFrom;

    /// <summary>
    /// The types that ship. Field and layout ids here are written into every fact and card the
    /// moment a collection upgrades, so they are frozen: rename the display name, never the id.
    /// </summary>
    /// <remarks>
    /// Basic and Basic + reverse are separate types rather than one type with a switch, because a
    /// switch would silently change how many cards every fact already using it makes.
    /// </remarks>
    public static IReadOnlyList<FlashcardCardType> CreateBuiltIns(DateTimeOffset now) =>
    [
        new(
            Id: BasicId,
            Name: "Basic",
            IsBuiltIn: true,
            Fields:
            [
                new FlashcardField(BasicFrontFieldId, "Front", "The question"),
                new FlashcardField(BasicBackFieldId, "Back", "The answer"),
            ],
            SortFieldId: BasicFrontFieldId,
            Layouts: [new FlashcardLayout(RecognitionLayoutId, "Recognition", "{{Front}}", "{{Back}}")],
            CreatedAt: now,
            UpdatedAt: now),
        new(
            Id: BasicReverseId,
            Name: "Basic and reverse",
            IsBuiltIn: true,
            Fields:
            [
                new FlashcardField(BasicFrontFieldId, "Front"),
                new FlashcardField(BasicBackFieldId, "Back"),
            ],
            SortFieldId: BasicFrontFieldId,
            Layouts:
            [
                new FlashcardLayout(RecognitionLayoutId, "Recognition", "{{Front}}", "{{Back}}"),
                new FlashcardLayout(RecallLayoutId, "Recall", "{{Back}}", "{{Front}}"),
            ],
            CreatedAt: now,
            UpdatedAt: now),
        new(
            Id: VocabularyId,
            Name: "Vocabulary",
            IsBuiltIn: true,
            Fields:
            [
                new FlashcardField("word", "Word"),
                new FlashcardField("meaning", "Meaning"),
                new FlashcardField("example", "Example", "A sentence using it, optional"),
            ],
            SortFieldId: "word",
            Layouts:
            [
                new FlashcardLayout(RecognitionLayoutId, "Recognition", "{{Word}}", "{{Meaning}}\n\n{{Example}}"),
                new FlashcardLayout("production", "Production", "{{Meaning}}", "{{Word}}"),
                new FlashcardLayout("in-context", "In context", "{{Example}}", "{{Word}}\n\n{{Meaning}}", Requires: "example"),
            ],
            CreatedAt: now,
            UpdatedAt: now),
        new(
            Id: ClozeId,
            Name: "Cloze",
            IsBuiltIn: true,
            Fields:
            [
                new FlashcardField(ClozeTextFieldId, "Text"),
                new FlashcardField(ClozeExtraFieldId, "Extra", "Shown on every card from this fact"),
            ],
            SortFieldId: ClozeTextFieldId,
            Layouts: [],
            Generator: FlashcardGenerators.Cloze,
            GenerateFrom: ClozeTextFieldId,
            CreatedAt: now,
            UpdatedAt: now),
    ];
}
