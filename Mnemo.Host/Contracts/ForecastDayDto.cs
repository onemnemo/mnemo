using System.Globalization;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One column of the review forecast. <paramref name="Day"/> is a UTC calendar day as
/// <c>yyyy-MM-dd</c>, the same key shape the statistics records use, so the client compares
/// forecast days and activity days as plain strings.
/// </summary>
public sealed record ForecastDayDto(string Day, int Due, int New)
{
    public static ForecastDayDto FromModel(FlashcardForecastDay model) =>
        new(model.Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), model.Due, model.New);
}
