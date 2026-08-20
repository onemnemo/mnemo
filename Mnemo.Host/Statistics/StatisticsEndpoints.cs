using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Statistics;

/// <summary>
/// Read-only access to the statistics store, which is where every Overview widget's numbers come
/// from. Nothing here writes: records are produced by the modules that own the activity.
/// </summary>
public static class StatisticsEndpoints
{
    public static void MapStatistics(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/stats/record", async (
            string? ns,
            string? kind,
            string? key,
            IStatisticsManager statistics,
            CancellationToken cancellationToken) =>
            (await StatisticsHandler.GetRecordAsync(statistics, ns, kind, key, cancellationToken).ConfigureAwait(false))
                .ToHttpResult());

        endpoints.MapGet("/api/stats/records", async (
            string? ns,
            string? kind,
            string? keyPrefix,
            int? limit,
            bool? desc,
            IStatisticsManager statistics,
            CancellationToken cancellationToken) =>
            (await StatisticsHandler.QueryRecordsAsync(statistics, ns, kind, keyPrefix, limit, desc, cancellationToken).ConfigureAwait(false))
                .ToHttpResult());

        endpoints.MapGet("/api/stats/daily", async (
            string? ns,
            string? kind,
            string? from,
            string? to,
            IStatisticsManager statistics,
            CancellationToken cancellationToken) =>
            (await StatisticsHandler.QueryDailyAsync(statistics, ns, kind, from, to, cancellationToken).ConfigureAwait(false))
                .ToHttpResult());

        // Which day a client is looking at is not the client's to decide: the keys above are
        // written against the collection's own boundary, so it is served rather than guessed.
        endpoints.MapGet("/api/stats/day", async (
            IStudyDayService studyDay,
            CancellationToken cancellationToken) =>
            Results.Ok(new StudyDayDto(
                await studyDay.GetDayStartHourAsync(cancellationToken).ConfigureAwait(false),
                await studyDay.TodayKeyAsync(cancellationToken).ConfigureAwait(false))));
    }

    /// <summary>
    /// An absent record, as a 200 carrying a literal null rather than a 204.
    /// </summary>
    /// <remarks>
    /// The SPA's fetch wrapper parses every body it gets, so an empty one throws a parse error
    /// instead of anything a caller could classify. Null parses, and "no record yet" stays a
    /// readable answer rather than becoming indistinguishable from a failed read.
    /// </remarks>
    private static readonly IResult Absent = Results.Content("null", "application/json");

    public static IResult ToHttpResult(this StatRecordResult read) => read.Status switch
    {
        StatRecordStatus.Found => Results.Ok(read.Record),
        StatRecordStatus.Absent => Absent,
        StatRecordStatus.Invalid => Results.BadRequest(
            new ErrorDto("invalid_stat_query", read.ErrorMessage ?? "The request does not describe a record.")),
        _ => Results.Json(
            new ErrorDto("stat_read_failed", read.ErrorMessage ?? "The statistics record could not be read."),
            statusCode: StatusCodes.Status500InternalServerError)
    };

    public static IResult ToHttpResult(this StatListResult read) => read.Status switch
    {
        StatListStatus.Ok => Results.Ok(read.Records),
        StatListStatus.Invalid => Results.BadRequest(
            new ErrorDto("invalid_stat_query", read.ErrorMessage ?? "The request does not describe a query.")),
        _ => Results.Json(
            new ErrorDto("stat_read_failed", read.ErrorMessage ?? "The statistics could not be read."),
            statusCode: StatusCodes.Status500InternalServerError)
    };
}
