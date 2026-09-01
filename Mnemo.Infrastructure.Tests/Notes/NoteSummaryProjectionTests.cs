using System.Text.Json;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests.Notes;

/// <summary>
/// The bodyless read of the library against the read that loads every note whole. The two are the
/// same answer or the faster one is wrong, so most of what is here is that comparison, run over a
/// corpus built to carry the rows that make the two paths disagree: absent fields, unset fields,
/// timestamps written with different kinds, and notes sharing a modification instant.
/// </summary>
public sealed class NoteSummaryProjectionTests
{
    [Fact]
    public async Task The_summary_read_answers_what_loading_every_note_answers()
    {
        await using var h = new NoteSidMigrationHarness();
        await SeedCorpusAsync(h);

        var whole = (await h.Notes.GetAllNotesAsync()).Select(NoteSummary.FromNote).Select(Describe).ToList();
        var projected = (await h.Notes.GetAllNoteSummariesAsync()).Select(Describe).ToList();

        // Compared as a sequence, so the order is part of what is being asserted and not just the
        // contents. A corpus with two notes on the same instant is what makes that assertion bite.
        Assert.Equal(whole, projected);
        Assert.Equal(7, projected.Count);
    }

    [Fact]
    public async Task Tag_lists_survive_the_projection()
    {
        await using var h = new NoteSidMigrationHarness();
        var tagged = await h.SeedAsync(new Note
        {
            Title = "Tagged",
            Tags = ["geology", "exam", "unicode aeiou"],
            CreatedAt = Utc(2025, 1, 1),
            ModifiedAt = Utc(2025, 1, 1),
        });
        await h.SeedAsync(new Note { Title = "Untagged", CreatedAt = Utc(2024, 1, 1), ModifiedAt = Utc(2024, 1, 1) });

        var summaries = await h.Notes.GetAllNoteSummariesAsync();

        Assert.Equal(["geology", "exam", "unicode aeiou"], summaries.Single(s => s.NoteId == tagged.NoteId).Tags);
        Assert.Empty(summaries.Single(s => s.NoteId != tagged.NoteId).Tags);
    }

    /// <summary>
    /// A timestamp stored without a kind is relabelled by the layer that presents it, not moved. If
    /// the projection normalised it to UTC on the way out it would be read as local time first, so a
    /// note's date would jump by the machine's offset the moment this read replaced the other one.
    /// </summary>
    [Fact]
    public async Task A_timestamp_stored_without_a_kind_comes_back_without_one_and_at_the_same_instant()
    {
        await using var h = new NoteSidMigrationHarness();
        var unspecified = new DateTime(2025, 3, 4, 5, 6, 7, DateTimeKind.Unspecified);
        var note = await h.SeedAsync(new Note
        {
            Title = "No kind",
            CreatedAt = unspecified,
            ModifiedAt = unspecified,
        });

        var summary = (await h.Notes.GetAllNoteSummariesAsync()).Single(s => s.NoteId == note.NoteId);

        Assert.Equal(DateTimeKind.Unspecified, summary.ModifiedAt.Kind);
        Assert.Equal(DateTimeKind.Unspecified, summary.CreatedAt.Kind);
        Assert.Equal(unspecified.Ticks, summary.ModifiedAt.Ticks);
        Assert.Equal(unspecified.Ticks, summary.CreatedAt.Ticks);

        // And the same for a row that was stored as UTC, so the test cannot pass by flattening every
        // kind to one answer.
        var utcNote = await h.SeedAsync(new Note { Title = "Utc", CreatedAt = Utc(2025, 6, 7), ModifiedAt = Utc(2025, 6, 7) });
        var utcSummary = (await h.Notes.GetAllNoteSummariesAsync()).Single(s => s.NoteId == utcNote.NoteId);
        Assert.Equal(DateTimeKind.Utc, utcSummary.ModifiedAt.Kind);
        Assert.Equal(Utc(2025, 6, 7).Ticks, utcSummary.ModifiedAt.Ticks);
    }

    /// <summary>
    /// The stored field is NoteId. A projection reading Id would find nothing on every row in the
    /// corpus, and a row that happens to carry both would answer with the wrong one.
    /// </summary>
    [Fact]
    public async Task The_id_is_read_from_the_stored_note_id_and_not_from_a_field_named_id()
    {
        await using var h = new NoteSidMigrationHarness();
        await SeedRawAsync(h, "real-id", """
            {"NoteId":"real-id","Id":"decoy-id","Title":"Two names","CreatedAt":"2025-01-01T00:00:00Z","ModifiedAt":"2025-01-01T00:00:00Z"}
            """);

        var summary = Assert.Single(await h.Notes.GetAllNoteSummariesAsync());

        Assert.Equal("real-id", summary.NoteId);
        Assert.Equal("Two names", summary.Title);
    }

    /// <summary>
    /// Notes written before short ids and the version counter existed are still in the corpus, and
    /// their rows simply have no such key. Each one reads as the value the model gives a note that
    /// was never told otherwise.
    /// </summary>
    [Fact]
    public async Task A_row_from_before_a_field_existed_reads_as_that_fields_default()
    {
        await using var h = new NoteSidMigrationHarness();
        await SeedRawAsync(h, "legacy", """
            {"NoteId":"legacy","Title":"Old","Content":"","CreatedAt":"2020-05-06T07:08:09Z","ModifiedAt":"2020-05-06T07:08:09Z"}
            """);

        var summary = Assert.Single(await h.Notes.GetAllNoteSummariesAsync());

        Assert.Equal(0, summary.Ver);
        Assert.Equal(string.Empty, summary.Sid);
        Assert.Empty(summary.Tags);
        Assert.Null(summary.FolderId);
        Assert.Null(summary.ParentNoteId);
        Assert.Null(summary.Emoji);
        Assert.Null(summary.Cover);
        Assert.Null(summary.CoverCrop);
        Assert.Equal(0, summary.Order);
        Assert.False(summary.IsFavorite);

        // The same row loaded whole reads the same way, which is the point of the defaults.
        var whole = NoteSummary.FromNote((await h.Notes.GetAllNotesAsync()).Single());
        Assert.Equal(Describe(whole), Describe(summary));
    }

    [Fact]
    public async Task A_note_the_trash_holds_is_missing_from_the_summary_read_too()
    {
        await using var h = new NoteSidMigrationHarness();
        var kept = await h.SeedAsync(new Note { Title = "Kept", CreatedAt = Utc(2025, 1, 1), ModifiedAt = Utc(2025, 1, 1) });
        var held = await h.SeedAsync(new Note { Title = "Held", CreatedAt = Utc(2026, 1, 1), ModifiedAt = Utc(2026, 1, 1) });

        await h.Store.CaptureNoteAsync(held.NoteId, "e1");

        var summaries = await h.Notes.GetAllNoteSummariesAsync();

        Assert.Equal([kept.NoteId], summaries.Select(s => s.NoteId));
    }

    [Fact]
    public async Task An_index_entry_with_no_stored_note_is_passed_over_by_the_summary_read()
    {
        await using var h = new NoteSidMigrationHarness();
        var real = await h.SeedAsync(new Note { Title = "Real", CreatedAt = Utc(2025, 1, 1), ModifiedAt = Utc(2025, 1, 1) });

        var index = (await h.Storage.LoadAsync<List<string>>("notes_index")).Value ?? [];
        index.Insert(0, "missing-note");
        await h.Storage.SaveAsync("notes_index", index);

        var summaries = await h.Notes.GetAllNoteSummariesAsync();

        Assert.Equal([real.NoteId], summaries.Select(s => s.NoteId));
    }

    [Fact]
    public async Task An_empty_library_reads_as_nothing_rather_than_as_a_query()
    {
        await using var h = new NoteSidMigrationHarness();

        Assert.Empty(await h.Notes.GetAllNoteSummariesAsync());
    }

    /// <summary>
    /// Seven notes covering what the two reads could disagree about: unset optional fields, set
    /// optional fields, a tag list, a favourite, a version and short id, a filed note and a child
    /// page, timestamps in every kind a row can carry, and two notes sharing an instant so the
    /// order of equals is exercised.
    /// </summary>
    private static async Task SeedCorpusAsync(NoteSidMigrationHarness h)
    {
        var shared = Utc(2025, 4, 1);

        await h.SeedAsync(new Note
        {
            Title = "Bare",
            CreatedAt = Utc(2023, 1, 2),
            ModifiedAt = Utc(2023, 1, 2),
        });

        await h.SeedAsync(new Note
        {
            Title = "Decorated",
            Sid = "n7k2",
            Ver = 41,
            FolderId = "folder-1",
            ParentNoteId = "parent-1",
            Order = 3,
            IsFavorite = true,
            Emoji = "*",
            Cover = "asset:cover-1",
            CoverCrop = """{"x":0,"y":0.1,"w":0.8,"h":0.6,"aspect":1.5}""",
            Tags = ["one", "two"],
            CreatedAt = Utc(2024, 8, 9),
            ModifiedAt = Utc(2026, 2, 2),
        });

        await h.SeedAsync(new Note
        {
            Title = "Written without a kind",
            CreatedAt = new DateTime(2025, 7, 7, 7, 7, 7, DateTimeKind.Unspecified),
            ModifiedAt = new DateTime(2025, 7, 7, 7, 7, 7, DateTimeKind.Unspecified),
        });

        await h.SeedAsync(new Note
        {
            Title = "Written as local time",
            CreatedAt = new DateTime(2025, 9, 9, 9, 9, 9, DateTimeKind.Local),
            ModifiedAt = new DateTime(2025, 9, 9, 9, 9, 9, DateTimeKind.Local),
        });

        // Two on the same instant, so the order the sort leaves equals in is compared as well.
        await h.SeedAsync(new Note { Title = "Tied first", CreatedAt = shared, ModifiedAt = shared });
        await h.SeedAsync(new Note { Title = "Tied second", CreatedAt = shared, ModifiedAt = shared });

        // A body, to prove the projection is reading past one rather than being handed simple rows.
        await h.SeedAsync(new Note
        {
            Title = "With a body",
            Content = "legacy markdown",
            Blocks = [NoteSidMigrationHarness.TextBlock("b1"), NoteSidMigrationHarness.TextBlock("b2")],
            CreatedAt = Utc(2022, 3, 4),
            ModifiedAt = Utc(2022, 3, 4),
        });
    }

    /// <summary>
    /// Plants a note row exactly as written, for the shapes no current writer produces: a row from an
    /// older build, or one carrying a field the model does not have.
    /// </summary>
    private static async Task SeedRawAsync(NoteSidMigrationHarness h, string noteId, string json)
    {
        using var document = JsonDocument.Parse(json);
        await h.Storage.SaveAsync($"note_{noteId}", document.RootElement);

        var index = (await h.Storage.LoadAsync<List<string>>("notes_index")).Value ?? [];
        index.Add(noteId);
        await h.Storage.SaveAsync("notes_index", index);
    }

    /// <summary>
    /// Every field of a summary as one line, with the kind of each timestamp spelled out, so a
    /// comparison catches a value that moved as well as one that changed.
    /// </summary>
    private static string Describe(NoteSummary summary) => string.Join(
        " | ",
        summary.NoteId,
        summary.Sid,
        summary.Ver,
        summary.Title,
        summary.FolderId ?? "<none>",
        summary.ParentNoteId ?? "<none>",
        summary.Order,
        summary.IsFavorite,
        $"{summary.CreatedAt.Ticks}/{summary.CreatedAt.Kind}",
        $"{summary.ModifiedAt.Ticks}/{summary.ModifiedAt.Kind}",
        summary.Emoji ?? "<none>",
        summary.Cover ?? "<none>",
        summary.CoverCrop ?? "<none>",
        string.Join(",", summary.Tags));

    private static DateTime Utc(int year, int month, int day) => new(year, month, day, 12, 0, 0, DateTimeKind.Utc);
}
