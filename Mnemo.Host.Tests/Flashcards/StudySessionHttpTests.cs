using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The study session through its real routes. The card id on a grade is the one thing standing
/// between a retried request and a grade landing on the wrong card's schedule, so the tests here
/// read the review log and the schedules back off the database after every call rather than
/// trusting the state the response reports.
/// </summary>
public sealed class StudySessionHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task StartingAReviewSessionQueuesTheDecksNewCardsAndWritesNothing()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, cards) = await h.SeedDeckAsync("alpha", "beta");

        var session = await StartAsync(h, deckId);

        Assert.Equal("review", session.Mode);
        Assert.True(session.WritesSchedule);
        Assert.False(session.IsFinished);
        Assert.False(session.StartedEmpty);
        Assert.Equal(0, session.Graded);
        Assert.False(session.CanUndo);
        Assert.Equal(2, session.Progress.Total);
        Assert.Equal(2, session.Progress.New);
        Assert.NotNull(session.Current);
        Assert.Contains(cards, c => c.Id == session.Current!.Id);
        Assert.NotNull(session.Intervals);

        Assert.Empty(await h.ReadReviewsAsync(deckId));
    }

    [Fact]
    public async Task GradingTheCurrentCardWritesOneReviewAndOneScheduleForThatCardOnly()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, cards) = await h.SeedDeckAsync("alpha", "beta");
        var session = await StartAsync(h, deckId);
        var gradedId = session.Current!.Id;
        var otherId = cards.Single(c => c.Id != gradedId).Id;

        var response = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = gradedId,
            grade = "good",
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = Parse<StudySessionDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, after.Graded);
        Assert.True(after.CanUndo);
        Assert.Equal(otherId, after.Current!.Id);

        var reviews = await h.ReadReviewsAsync(deckId);
        var review = Assert.Single(reviews);
        Assert.Equal(gradedId, review.CardId);
        Assert.Equal(FlashcardReviewGrade.Good, review.Grade);
        Assert.Equal(FlashcardFsrsState.New, review.StateBefore);

        var graded = await h.ReadScheduleAsync(gradedId);
        Assert.NotNull(graded);
        Assert.Equal(1, graded!.Reps);
        Assert.NotEqual(FlashcardFsrsState.New, graded.FsrsState);
        Assert.NotNull(graded.LastReviewedAt);

        var other = await h.ReadScheduleAsync(otherId);
        Assert.NotNull(other);
        Assert.Equal(0, other!.Reps);
        Assert.Equal(FlashcardFsrsState.New, other.FsrsState);
        Assert.Null(other.LastReviewedAt);
    }

    /// <summary>
    /// A grade that was applied but never acknowledged comes back a second time naming the card
    /// that has since left the head of the queue. It must be answered with the live state and
    /// must not be written again.
    /// </summary>
    [Fact]
    public async Task ReplayingAGradeForACardNoLongerAtTheHeadIsA409ThatWritesNothing()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha", "beta");
        var session = await StartAsync(h, deckId);
        var gradedId = session.Current!.Id;

        var first = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = gradedId,
            grade = "good",
        }));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var scheduleAfterFirst = await h.ReadScheduleAsync(gradedId);

        var replay = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = gradedId,
            grade = "good",
        }));

        Assert.Equal(HttpStatusCode.Conflict, replay.StatusCode);
        var state = Parse<StudySessionDto>(await replay.Content.ReadAsStringAsync());
        Assert.Equal(session.SessionId, state.SessionId);
        Assert.Equal(1, state.Graded);
        Assert.NotEqual(gradedId, state.Current!.Id);

        Assert.Single(await h.ReadReviewsAsync(deckId));
        Assert.Equal(scheduleAfterFirst, await h.ReadScheduleAsync(gradedId));
    }

    /// <summary>
    /// Undo over the route reverses the stored review and puts the card back at the head, so a
    /// misclick costs nothing. The counters follow the engine: after the undo there is nothing
    /// further to undo.
    /// </summary>
    [Fact]
    public async Task UndoingAGradeDeletesItsReviewAndRestoresTheSchedule()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha", "beta");
        var session = await StartAsync(h, deckId);
        var gradedId = session.Current!.Id;
        var before = await h.ReadScheduleAsync(gradedId);

        var graded = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = gradedId,
            grade = "good",
        }));
        Assert.Equal(HttpStatusCode.OK, graded.StatusCode);

        var response = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/undo", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = Parse<StudySessionDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, after.Graded);
        Assert.False(after.CanUndo);
        Assert.Equal(gradedId, after.Current!.Id);

        Assert.Empty(await h.ReadReviewsAsync(deckId));
        Assert.Equal(before, await h.ReadScheduleAsync(gradedId));
    }

    [Fact]
    public async Task UndoWithNothingGradedIsAnsweredWithTheLiveState()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha");
        var session = await StartAsync(h, deckId);

        var response = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/undo", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var state = Parse<StudySessionDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, state.Graded);
        Assert.False(state.CanUndo);
        Assert.Equal(session.Current!.Id, state.Current!.Id);
        Assert.Empty(await h.ReadReviewsAsync(deckId));
    }

    [Fact]
    public async Task AnUnknownGradeIsRefusedBeforeAnythingIsWritten()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha");
        var session = await StartAsync(h, deckId);

        var response = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = session.Current!.Id,
            grade = "brilliant",
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_grade", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Empty(await h.ReadReviewsAsync(deckId));
    }

    [Fact]
    public async Task AGradeWithoutACardIdIsRefusedBeforeAnythingIsWritten()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha");
        var session = await StartAsync(h, deckId);

        var response = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = "",
            grade = "good",
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("card_required", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Empty(await h.ReadReviewsAsync(deckId));
    }

    [Fact]
    public async Task GradingAgainstAnUnknownSessionIsA404()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/study/sessions/nope/grade", JsonBody(new
        {
            cardId = "card",
            grade = "good",
        }));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("unknown_session", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task StartingWithTestModeOrAMissingDeckIsRefusedWithAReason()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha");

        var test = await h.Client.PostAsync("/api/study/sessions", JsonBody(new { deckId, mode = "test" }));
        Assert.Equal(HttpStatusCode.BadRequest, test.StatusCode);
        Assert.Equal("unsupported_mode", Parse<ErrorDto>(await test.Content.ReadAsStringAsync()).Error);

        var unknownMode = await h.Client.PostAsync("/api/study/sessions", JsonBody(new { deckId, mode = "exam" }));
        Assert.Equal(HttpStatusCode.BadRequest, unknownMode.StatusCode);
        Assert.Equal("invalid_mode", Parse<ErrorDto>(await unknownMode.Content.ReadAsStringAsync()).Error);

        var missing = await h.Client.PostAsync("/api/study/sessions", JsonBody(new { deckId = "absent", mode = "review" }));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal("unknown_deck", Parse<ErrorDto>(await missing.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task CramGradesWriteNoScheduleAndNoReview()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha", "beta");
        var session = await StartAsync(h, deckId, mode: "cram", scope: "all");
        Assert.False(session.WritesSchedule);
        var gradedId = session.Current!.Id;

        var response = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = gradedId,
            grade = "good",
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, Parse<StudySessionDto>(await response.Content.ReadAsStringAsync()).Graded);
        Assert.Empty(await h.ReadReviewsAsync(deckId));
        var schedule = await h.ReadScheduleAsync(gradedId);
        Assert.Equal(FlashcardFsrsState.New, schedule!.FsrsState);
        Assert.Equal(0, schedule.Reps);
    }

    [Fact]
    public async Task EndingASessionRecordsItsGradesOnceAndEndingAgainIsAQuiet204()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var (deckId, _) = await h.SeedDeckAsync("alpha", "beta");
        var session = await StartAsync(h, deckId);
        var grade = await h.Client.PostAsync($"/api/study/sessions/{session.SessionId}/grade", JsonBody(new
        {
            cardId = session.Current!.Id,
            grade = "good",
        }));
        Assert.Equal(HttpStatusCode.OK, grade.StatusCode);

        var end = await h.Client.DeleteAsync($"/api/study/sessions/{session.SessionId}");
        Assert.Equal(HttpStatusCode.NoContent, end.StatusCode);

        var dayKey = await h.StudyDay.TodayKeyAsync();
        var daily = (await h.Statistics.GetAsync(StatisticsNamespaces.Flashcards, FlashcardStatKinds.DailySummary, dayKey)).Value;
        Assert.NotNull(daily);
        Assert.Equal(1, daily!.Fields["cards_reviewed"].AsInt());
        Assert.Equal(1, daily.Fields["sessions_completed"].AsInt());

        var again = await h.Client.DeleteAsync($"/api/study/sessions/{session.SessionId}");
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        var dailyAfter = (await h.Statistics.GetAsync(StatisticsNamespaces.Flashcards, FlashcardStatKinds.DailySummary, dayKey)).Value;
        Assert.Equal(1, dailyAfter!.Fields["sessions_completed"].AsInt());

        var gone = await h.Client.GetAsync($"/api/study/sessions/{session.SessionId}");
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);

        // The recorder logs its own failures instead of throwing, so an empty record would
        // otherwise be indistinguishable from a session that graded nothing.
        Assert.Empty(h.Logger.Errors);
    }

    private static async Task<StudySessionDto> StartAsync(
        StudySessionHttpHarness h, string deckId, string mode = "review", string? scope = null)
    {
        var response = await h.Client.PostAsync("/api/study/sessions", JsonBody(new { deckId, mode, scope }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return Parse<StudySessionDto>(await response.Content.ReadAsStringAsync());
    }

    private static StringContent JsonBody(object body) =>
        new(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");

    private static T Parse<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Json) ?? throw new InvalidOperationException("empty body");
}
