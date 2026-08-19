using System;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// How long the trash keeps something.
/// </summary>
public static class TrashRetention
{
    /// <summary>Long enough to cover a change of mind and a holiday.</summary>
    public const int Days = 30;

    /// <summary>When an item deleted at <paramref name="deletedAt"/> becomes eligible for purge.</summary>
    public static DateTimeOffset ExpiresAt(DateTimeOffset deletedAt) => deletedAt.AddDays(Days);
}
