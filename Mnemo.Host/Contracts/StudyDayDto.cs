namespace Mnemo.Host.Contracts;

/// <summary>
/// The day boundary every day-keyed statistic is written under. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
/// <remarks>
/// The client is given the hour rather than only the current day so that a board left open across
/// the boundary can move to the new day on its own, instead of showing yesterday's totals until
/// something refetches.
/// </remarks>
/// <param name="DayStartHour">The local hour a day rolls over at, 0 to 23.</param>
/// <param name="Today">The day key now falls under, <c>yyyy-MM-dd</c>.</param>
public sealed record StudyDayDto(int DayStartHour, string Today);
