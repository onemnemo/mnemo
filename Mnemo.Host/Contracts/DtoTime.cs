namespace Mnemo.Host.Contracts;

internal static class DtoTime
{
    /// <summary>
    /// Persisted timestamps are UTC by contract but may round-trip through storage with
    /// an unspecified kind; stamping them Utc makes the JSON carry the trailing Z so the
    /// SPA reads them as UTC instead of local time.
    /// </summary>
    public static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}
