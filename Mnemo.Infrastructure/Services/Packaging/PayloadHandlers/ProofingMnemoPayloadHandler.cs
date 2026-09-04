using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// The words and per-note choices the user authored: the personal dictionary, the notes that are
/// checked in something other than the default languages, and the words a single note accepts.
/// <para>
/// A payload of its own rather than three more keys on the settings one. That handler serves flat
/// string settings, and none of these is one; more to the point, this is content the user typed and
/// cannot get back, where a theme choice is a preference they can set again in a second.
/// </para>
/// <para>
/// The per-note halves are keyed by note id and travel with the notes payload, so an export limited
/// to a selection carries only those notes' choices. On the way back in they follow whatever the
/// notes payload renamed, because a note that landed under a fresh id would otherwise hand its
/// languages and its ignored words to the unrelated note that already held the old one.
/// </para>
/// <para>
/// A restored word carries the date it was restored. The package records when it was first added,
/// so a later build can put that back, but the store stamps its own and the list is ordered by it.
/// </para>
/// </summary>
public sealed class ProofingMnemoPayloadHandler : IMnemoPayloadHandler
{
    private const string FileName = "proofing.json";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IPersonalDictionaryService _personal;
    private readonly INoteLanguageService _noteLanguages;
    private readonly INoteIgnoreService _noteIgnores;

    public ProofingMnemoPayloadHandler(
        IPersonalDictionaryService personal,
        INoteLanguageService noteLanguages,
        INoteIgnoreService noteIgnores)
    {
        _personal = personal;
        _noteLanguages = noteLanguages;
        _noteIgnores = noteIgnores;
    }

    public string PayloadType => "proofing";

    public async Task<MnemoPayloadExportData> ExportAsync(
        MnemoPayloadExportContext context,
        CancellationToken cancellationToken = default)
    {
        var words = await _personal.ListAsync(cancellationToken).ConfigureAwait(false);
        var languages = await _noteLanguages.GetAllAsync(cancellationToken).ConfigureAwait(false);
        var ignores = await _noteIgnores.GetAllAsync(cancellationToken).ConfigureAwait(false);

        // The dictionary is the user's own vocabulary and belongs to the whole profile, so it is
        // carried whole. The per-note halves belong to the notes the package holds, and a package
        // holding one note has no business carrying every other note's choices.
        var selectedNotes = ResolveSelectedNoteIds(context.Options);
        var payloadWords = words
            .Select(w => new ProofingPayloadWord { Word = w.Word, Language = w.Language, AddedAt = w.AddedAt })
            .ToList();
        var payloadLanguages = languages
            .Where(pair => selectedNotes.Count == 0 || selectedNotes.Contains(pair.Key))
            .ToDictionary(
                pair => pair.Key,
                pair => new ProofingPayloadNoteLanguages { Mode = pair.Value.Mode, Languages = [.. pair.Value.Languages] },
                StringComparer.Ordinal);
        var payloadIgnores = ignores
            .Where(pair => selectedNotes.Count == 0 || selectedNotes.Contains(pair.Key))
            .ToDictionary(pair => pair.Key, pair => pair.Value.ToArray(), StringComparer.Ordinal);

        var snapshot = new ProofingPayloadSnapshot
        {
            PersonalWords = payloadWords,
            NoteLanguages = payloadLanguages,
            NoteIgnores = payloadIgnores
        };

        return new MnemoPayloadExportData
        {
            ItemCount = payloadWords.Count + payloadLanguages.Count + payloadIgnores.Count,
            SchemaVersion = 1,
            Files = new Dictionary<string, byte[]>
            {
                [FileName] = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot, JsonOptions))
            }
        };
    }

    public async Task<MnemoPayloadImportResult> ImportAsync(
        MnemoPayloadImportContext context,
        CancellationToken cancellationToken = default)
    {
        if (!context.Files.TryGetValue(FileName, out var bytes))
            return new MnemoPayloadImportResult { Warnings = { TransferWarning.Of("ProofingPayloadMissingFile") } };

        var snapshot = JsonSerializer.Deserialize<ProofingPayloadSnapshot>(bytes, JsonOptions)
            ?? new ProofingPayloadSnapshot();

        // A file that spells a member as an explicit null deserializes to a null collection rather
        // than to the initializer, so each one is read through its own fallback.
        var personalWords = snapshot.PersonalWords ?? [];
        var noteLanguages = snapshot.NoteLanguages ?? [];
        var noteIgnores = snapshot.NoteIgnores ?? [];

        var result = new MnemoPayloadImportResult();
        var storedNoteIds = context.RemappedIds.TryGetValue("notes", out var noteRenames)
            ? noteRenames
            : null;

        // Everything here merges rather than replaces. A package is restored into a profile that has
        // been used, and a word the user added since the backup is not one the backup may take back.
        var wordsSkipped = 0;
        foreach (var word in personalWords)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (word is null || string.IsNullOrWhiteSpace(word.Word))
            {
                wordsSkipped++;
                result.SkippedCount++;
                continue;
            }

            var outcome = await _personal.AddAsync(word.Word, word.Language, cancellationToken).ConfigureAwait(false);
            switch (outcome)
            {
                case PersonalWordAddResult.Added:
                    result.ImportedCount++;
                    break;
                case PersonalWordAddResult.AlreadyPresent:
                    result.DuplicatedCount++;
                    break;
                default:
                    wordsSkipped++;
                    result.SkippedCount++;
                    break;
            }
        }

        // Counted apart from the running total, which the per-note loops below also raise. Warning
        // on the total would tell the user a number their result never shows.
        if (wordsSkipped > 0)
            result.Warnings.Add(TransferWarning.Of("ProofingWordsSkipped", ("count", wordsSkipped.ToString())));

        foreach (var (packagedNoteId, entry) in noteLanguages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (entry is null || string.IsNullOrWhiteSpace(entry.Mode))
                continue;

            var stored = await _noteLanguages
                .SetAsync(StoredNoteId(storedNoteIds, packagedNoteId), new NoteLanguageEntry(entry.Mode, entry.Languages ?? []), cancellationToken)
                .ConfigureAwait(false);
            if (stored)
                result.ImportedCount++;
            else
                result.SkippedCount++;
        }

        foreach (var (packagedNoteId, words) in noteIgnores)
        {
            if (words is null)
                continue;

            var noteId = StoredNoteId(storedNoteIds, packagedNoteId);
            foreach (var word in words)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (string.IsNullOrWhiteSpace(word))
                    continue;

                var stored = await _noteIgnores.AddAsync(noteId, word, cancellationToken).ConfigureAwait(false);
                if (stored)
                    result.ImportedCount++;
                else
                    result.SkippedCount++;
            }
        }

        return result;
    }

    /// <summary>
    /// The id the note this entry belongs to is actually stored under. Unchanged when the notes
    /// payload kept the id, or when the package carried no notes for this one to follow.
    /// </summary>
    private static string StoredNoteId(IReadOnlyDictionary<string, string>? renames, string packagedNoteId)
    {
        return renames is not null && renames.TryGetValue(packagedNoteId, out var stored) ? stored : packagedNoteId;
    }

    /// <summary>The notes the export was limited to, empty when it covers the whole profile.</summary>
    private static HashSet<string> ResolveSelectedNoteIds(MnemoPackageExportOptions options)
    {
        if (options.PayloadOptions.TryGetValue(MnemoPayloadOptionKeys.NoteIds, out var value) && value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(id => !string.IsNullOrWhiteSpace(id)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }

    /// <summary>
    /// Every member is nullable because the file is read from wherever the user got it, and a member
    /// written as an explicit null lands as null rather than as the initializer a reader would want.
    /// </summary>
    private sealed class ProofingPayloadSnapshot
    {
        public List<ProofingPayloadWord>? PersonalWords { get; set; }
        public Dictionary<string, ProofingPayloadNoteLanguages>? NoteLanguages { get; set; }
        public Dictionary<string, string[]>? NoteIgnores { get; set; }
    }

    private sealed class ProofingPayloadWord
    {
        public string Word { get; set; } = string.Empty;
        public string? Language { get; set; }
        public DateTimeOffset AddedAt { get; set; }
    }

    private sealed class ProofingPayloadNoteLanguages
    {
        public string Mode { get; set; } = string.Empty;
        public string[]? Languages { get; set; }
    }
}
