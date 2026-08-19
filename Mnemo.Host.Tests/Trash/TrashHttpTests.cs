using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Mnemo.Core.Models.Trash;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Host.Tests.Trash;

/// <summary>
/// The shared trash routes, executed rather than asserted about.
/// <para>
/// The protocol underneath is covered against the coordinator. What these tests pin is the part the
/// recovery screen depends on: that a partly completed restore reports per entry rather than as one
/// verdict, that a blocked destruction names what blocked it, and that the two states worth retrying
/// arrive as their own codes instead of a generic failure.
/// </para>
/// </summary>
public sealed class TrashHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task The_trash_is_closed_until_it_has_finished_starting()
    {
        await using var h = new TrashHttpHarness();
        await h.StartAsync(reconciled: false);

        var response = await h.Client.GetAsync("/api/trash");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>(Json);
        Assert.Equal("trash_reconciling", error!.Error);
    }

    [Fact]
    public async Task A_page_carries_what_the_recovery_screen_shows()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji", origin: "Japanese", containedCount: 4);
        await h.StartAsync();
        await h.DeleteAsync("n1");

        var page = await h.Client.GetFromJsonAsync<TrashPageDto>("/api/trash", Json);

        var entry = Assert.Single(page!.Entries);
        Assert.Equal("note", entry.Kind);
        Assert.Equal("Kanji", entry.Title);
        Assert.Equal("Japanese", entry.Origin);
        Assert.Equal(4, entry.ContainedCount);
        Assert.True(entry.SourceAvailable);
        Assert.Equal(30, (entry.ExpiresAt - entry.DeletedAt).Days);
    }

    [Fact]
    public async Task A_page_hands_back_a_cursor_the_next_request_carries()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "First").AddLive("n2", "Second");
        await h.StartAsync();
        await h.DeleteAsync("n1", "n2");

        var first = await h.Client.GetFromJsonAsync<TrashPageDto>("/api/trash?limit=1", Json);
        Assert.Single(first!.Entries);
        Assert.NotNull(first.NextCursor);

        var second = await h.Client.GetFromJsonAsync<TrashPageDto>(
            $"/api/trash?limit=1&cursor={Uri.EscapeDataString(first.NextCursor!)}",
            Json);

        Assert.Single(second!.Entries);
        Assert.Null(second.NextCursor);
        Assert.NotEqual(first.Entries[0].Id, second.Entries[0].Id);
    }

    [Fact]
    public async Task The_badge_counts_what_can_be_recovered()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "First").AddLive("n2", "Second");
        await h.StartAsync();
        await h.DeleteAsync("n1", "n2");

        var count = await h.Client.GetFromJsonAsync<TrashCountDto>("/api/trash/count", Json);

        Assert.Equal(2, count!.Count);
    }

    [Fact]
    public async Task Restoring_one_entry_needs_no_body()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji");
        await h.StartAsync();
        var entry = (await h.DeleteAsync("n1")).Entries[0];

        var response = await h.Client.PostAsync($"/api/trash/{entry.Id}/restore", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TrashRestoreResponseDto>(Json);
        Assert.Equal(1, body!.RestoredCount);
        Assert.Equal("restored", Assert.Single(body.Results).Outcome);
        Assert.True(h.Notes.IsLive("n1"));
    }

    [Fact]
    public async Task Restoring_nothing_is_a_request_error()
    {
        await using var h = new TrashHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/trash/restore", Body("{ }"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>(Json);
        Assert.Equal("no_entries", error!.Error);
    }

    [Fact]
    public async Task A_restore_reports_per_entry_rather_than_as_one_verdict()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji").AddLive("n2", "Hiragana");
        await h.StartAsync();
        var action = await h.DeleteAsync("n1", "n2");
        h.Notes.RestoreOutcome = TrashRestoreOutcome.DestinationRequired;

        var response = await h.Client.PostAsJsonAsync(
            "/api/trash/restore",
            new TrashRestoreRequestDto(action.Entries.Select(e => e.Id).ToList(), null),
            Json);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TrashRestoreResponseDto>(Json);
        Assert.Equal(0, body!.RestoredCount);
        Assert.Equal(2, body.PendingCount);
        Assert.All(body.Results, r => Assert.Equal("destination_required", r.Outcome));
    }

    [Fact]
    public async Task A_destination_supplied_on_the_second_attempt_is_carried_through()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji");
        await h.StartAsync();
        var entry = (await h.DeleteAsync("n1")).Entries[0];
        h.Notes.RestoreOutcome = TrashRestoreOutcome.DestinationRequired;

        var response = await h.Client.PostAsJsonAsync(
            $"/api/trash/{entry.Id}/restore",
            new TrashRestoreRequestDto(null, "deck-live"),
            Json);

        var body = await response.Content.ReadFromJsonAsync<TrashRestoreResponseDto>(Json);
        var result = Assert.Single(body!.Results);
        Assert.Equal("restored", result.Outcome);
        Assert.Equal("deck-live", result.DestinationId);
    }

    [Fact]
    public async Task Undo_puts_back_everything_one_action_took()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji").AddLive("n2", "Hiragana");
        await h.StartAsync();
        var action = await h.DeleteAsync("n1", "n2");

        var response = await h.Client.PostAsync($"/api/trash/batches/{action.BatchId}/restore", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TrashRestoreResponseDto>(Json);
        Assert.Equal(2, body!.RestoredCount);
        Assert.True(h.Notes.IsLive("n1"));
        Assert.True(h.Notes.IsLive("n2"));
    }

    [Fact]
    public async Task Destroying_an_entry_answers_with_what_went()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji");
        await h.StartAsync();
        var entry = (await h.DeleteAsync("n1")).Entries[0];

        var response = await h.Client.DeleteAsync($"/api/trash/{entry.Id}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TrashPurgeResultDto>(Json);
        Assert.True(body!.Purged);
        Assert.Equal("Kanji", body.Title);
        Assert.Equal(0, await h.Service.CountAsync());
    }

    [Fact]
    public async Task An_entry_others_depend_on_is_a_conflict_that_names_them()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji");
        await h.StartAsync();
        var entry = (await h.DeleteAsync("n1")).Entries[0];
        h.Notes.PurgeBlockers = ["child-entry"];

        var response = await h.Client.DeleteAsync($"/api/trash/{entry.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TrashPurgeResultDto>(Json);
        Assert.False(body!.Purged);
        Assert.Equal(["child-entry"], body.BlockingEntryIds);
        Assert.Equal(1, await h.Service.CountAsync());
    }

    [Fact]
    public async Task Emptying_reports_what_it_destroyed()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "First").AddLive("n2", "Second");
        await h.StartAsync();
        await h.DeleteAsync("n1", "n2");

        var response = await h.Client.PostAsync("/api/trash/empty", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<TrashEmptyResultDto>(Json);
        Assert.Equal(2, body!.PurgedCount);
        Assert.Empty(body.Blocked);
    }

    [Fact]
    public async Task A_module_that_could_not_answer_is_a_retryable_failure()
    {
        await using var h = new TrashHttpHarness();
        h.Notes.AddLive("n1", "Kanji");
        await h.StartAsync();
        var entry = (await h.DeleteAsync("n1")).Entries[0];
        h.Notes.RestoreFailure = new InvalidOperationException("write failed");
        h.Notes.HoldsFailure = new InvalidOperationException("database is locked");

        var response = await h.Client.PostAsync($"/api/trash/{entry.Id}/restore", content: null);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>(Json);
        Assert.Equal("trash_source_unavailable", error!.Error);
    }

    [Fact]
    public async Task An_entry_from_a_module_this_build_does_not_ship_is_shown_but_not_acted_on()
    {
        await using var h = new TrashHttpHarness();
        var deletedAt = DateTimeOffset.UtcNow;
        await h.Store.InsertAsync(new TrashEntry
        {
            Id = "e1",
            Kind = "mindmap",
            ItemId = "m1",
            Title = "Rock cycle",
            BatchId = "batch",
            State = TrashEntryState.Held,
            DeletedAt = deletedAt,
            ExpiresAt = TrashRetention.ExpiresAt(deletedAt),
        });
        await h.StartAsync();

        var page = await h.Client.GetFromJsonAsync<TrashPageDto>("/api/trash", Json);
        var entry = Assert.Single(page!.Entries);
        Assert.Equal("Rock cycle", entry.Title);
        Assert.False(entry.SourceAvailable);

        var response = await h.Client.PostAsync("/api/trash/e1/restore", content: null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>(Json);
        Assert.Equal("unknown_trash_kind", error!.Error);
    }

    private static StringContent Body(string json) => new(json, Encoding.UTF8, "application/json");
}
