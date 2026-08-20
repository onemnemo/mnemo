using System.Globalization;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Statistics;

/// <summary>What a single-record read established.</summary>
public enum StatRecordStatus
{
    /// <summary>The record exists and was read.</summary>
    Found,

    /// <summary>Nothing is stored under that triple. Not an error; most stats start out absent.</summary>
    Absent,

    /// <summary>The request did not describe a record. Nothing was read.</summary>
    Invalid,

    /// <summary>Storage refused the read.</summary>
    Failed
}

/// <summary>Outcome of <see cref="StatisticsHandler.GetRecordAsync"/>.</summary>
public sealed record StatRecordResult(StatRecordStatus Status, StatRecordDto? Record, string? ErrorMessage)
{
    public static StatRecordResult Found(StatRecordDto record) => new(StatRecordStatus.Found, record, null);

    public static StatRecordResult Absent() => new(StatRecordStatus.Absent, null, null);

    public static StatRecordResult Invalid(string reason) => new(StatRecordStatus.Invalid, null, reason);

    public static StatRecordResult Failed(string errorMessage) => new(StatRecordStatus.Failed, null, errorMessage);
}

/// <summary>What a multi-record read established. There is no absent case: no matches is an empty list.</summary>
public enum StatListStatus
{
    /// <summary>The query ran. The list may be empty.</summary>
    Ok,

    /// <summary>The request did not describe a query. Nothing was read.</summary>
    Invalid,

    /// <summary>Storage refused the read.</summary>
    Failed
}

/// <summary>Outcome of <see cref="StatisticsHandler.QueryRecordsAsync"/> and <see cref="StatisticsHandler.QueryDailyAsync"/>.</summary>
public sealed record StatListResult(StatListStatus Status, IReadOnlyList<StatRecordDto> Records, string? ErrorMessage)
{
    private static readonly IReadOnlyList<StatRecordDto> None = Array.Empty<StatRecordDto>();

    public static StatListResult Ok(IReadOnlyList<StatRecordDto> records) => new(StatListStatus.Ok, records, null);

    public static StatListResult Invalid(string reason) => new(StatListStatus.Invalid, None, reason);

    public static StatListResult Failed(string errorMessage) => new(StatListStatus.Failed, None, errorMessage);
}

/// <summary>
/// Reads statistics through <see cref="IStatisticsManager"/>, mapping the manager's Result
/// convention onto outcomes a route can turn into status codes.
/// </summary>
/// <remarks>
/// Kept out of the endpoint for the same reason the overview layout handler is: the day-window
/// read has real logic in it (a format, a range guard, a filter and a sort the query layer cannot
/// express), and there is no way in this repo to exercise a route.
/// </remarks>
public static class StatisticsHandler
{
    /// <summary>
    /// The key format of every day-keyed statistics kind. The window read only compares keys, so
    /// what a day means is settled where the key is written and this stays a format.
    /// </summary>
    private const string DayKeyFormat = "yyyy-MM-dd";

    /// <summary>
    /// How wide a day window a caller may ask for. Overview's widest is 90 days; this leaves room
    /// for a year-scale chart without letting a URL ask for a decade of rows.
    /// </summary>
    private const int MaxWindowDays = 400;

    /// <summary>
    /// What the day-window read asks storage for, which is deliberately not the window's width.
    /// </summary>
    /// <remarks>
    /// <see cref="StatisticsQuery"/> can only order by UpdatedAt, so asking for exactly as many
    /// rows as the window has days returns the most recently *written* records rather than the
    /// records for those days. Those coincide only while the window ends today and nothing was ever
    /// backfilled; a window in the past comes back empty. Asking for the store's ceiling instead
    /// costs one over-fetch and makes the filter below the only thing that decides membership.
    /// The residual limit is the ceiling itself: a profile holding more than this many records of
    /// one kind can still have the oldest ones fall outside what storage will return.
    /// </remarks>
    private const int MaxFetch = 1000;

    public static async Task<StatRecordResult> GetRecordAsync(
        IStatisticsManager statistics,
        string? ns,
        string? kind,
        string? key,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(ns))
            return StatRecordResult.Invalid("A namespace is required.");
        if (string.IsNullOrWhiteSpace(kind))
            return StatRecordResult.Invalid("A kind is required.");
        if (string.IsNullOrWhiteSpace(key))
            return StatRecordResult.Invalid("A key is required.");

        var read = await statistics.GetAsync(ns, kind, key, cancellationToken).ConfigureAwait(false);
        if (!read.IsSuccess)
            return StatRecordResult.Failed(read.ErrorMessage ?? "The statistics record could not be read.");

        // Success carrying null means the triple has never been written. A widget reading a stat
        // that does not exist yet is the normal first-run case, so it is not an error.
        return read.Value is { } record
            ? StatRecordResult.Found(StatRecordDto.FromModel(record))
            : StatRecordResult.Absent();
    }

    public static async Task<StatListResult> QueryRecordsAsync(
        IStatisticsManager statistics,
        string? ns,
        string? kind,
        string? keyPrefix,
        int? limit,
        bool? descending,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(ns))
            return StatListResult.Invalid("A namespace is required.");

        var query = new StatisticsQuery
        {
            Namespace = ns,
            Kind = string.IsNullOrWhiteSpace(kind) ? null : kind,
            KeyPrefix = string.IsNullOrWhiteSpace(keyPrefix) ? null : keyPrefix,
            // Passed through unclamped on purpose: the store already clamps to its own ceiling and
            // falls back to a default when this is not positive, so re-deciding either here would
            // put two different answers to the same question in the codebase.
            Limit = limit ?? 0,
            OrderByUpdatedDescending = descending ?? true
        };

        var read = await statistics.QueryAsync(query, cancellationToken).ConfigureAwait(false);
        return read.IsSuccess
            ? StatListResult.Ok((read.Value ?? []).Select(StatRecordDto.FromModel).ToList())
            : StatListResult.Failed(read.ErrorMessage ?? "The statistics records could not be read.");
    }

    /// <summary>
    /// Every record of a day-keyed kind whose key falls in <paramref name="from"/>..<paramref name="to"/>
    /// inclusive, ascending by day and sparse: a day with no record is simply absent.
    /// </summary>
    /// <remarks>
    /// The filter and the sort are here rather than in the query because the query layer has
    /// neither a key range nor an order-by-key, and ordering by UpdatedAt is not a substitute: a
    /// record corrected later updates out of day order.
    /// </remarks>
    public static async Task<StatListResult> QueryDailyAsync(
        IStatisticsManager statistics,
        string? ns,
        string? kind,
        string? from,
        string? to,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(ns))
            return StatListResult.Invalid("A namespace is required.");
        if (string.IsNullOrWhiteSpace(kind))
            return StatListResult.Invalid("A kind is required.");

        if (!TryParseDay(from, out var first))
            return StatListResult.Invalid($"'from' must be a {DayKeyFormat} day.");
        if (!TryParseDay(to, out var last))
            return StatListResult.Invalid($"'to' must be a {DayKeyFormat} day.");
        if (first > last)
            return StatListResult.Invalid("'from' is after 'to'.");

        var span = (last - first).Days + 1;
        if (span > MaxWindowDays)
            return StatListResult.Invalid($"A window of {span} days is wider than the {MaxWindowDays}-day maximum.");

        var query = new StatisticsQuery
        {
            Namespace = ns,
            Kind = kind,
            // Day keys are fixed-width and zero-padded, so they sort lexicographically in
            // chronological order and every key between the two endpoints shares whatever prefix
            // the endpoints share. A window inside one month therefore narrows storage to that
            // month, which is what keeps the over-fetch above from mattering in practice.
            KeyPrefix = SharedPrefix(DayKey(first), DayKey(last)),
            Limit = MaxFetch
        };

        var read = await statistics.QueryAsync(query, cancellationToken).ConfigureAwait(false);
        if (!read.IsSuccess)
            return StatListResult.Failed(read.ErrorMessage ?? "The daily statistics could not be read.");

        var days = new List<(DateTime Day, StatisticsRecord Record)>();
        foreach (var record in read.Value ?? [])
        {
            // A kind can hold keys that are not days at all; those are not part of a day window.
            if (!TryParseDay(record.Key, out var day) || day < first || day > last) continue;
            days.Add((day, record));
        }

        days.Sort((left, right) => left.Day.CompareTo(right.Day));
        return StatListResult.Ok(days.Select(entry => StatRecordDto.FromModel(entry.Record)).ToList());
    }

    private static bool TryParseDay(string? value, out DateTime day) => DateTime.TryParseExact(
        value,
        DayKeyFormat,
        CultureInfo.InvariantCulture,
        DateTimeStyles.None,
        out day);

    private static string DayKey(DateTime day) => day.ToString(DayKeyFormat, CultureInfo.InvariantCulture);

    private static string SharedPrefix(string left, string right)
    {
        var shared = 0;
        while (shared < left.Length && shared < right.Length && left[shared] == right[shared]) shared++;
        return left[..shared];
    }
}
