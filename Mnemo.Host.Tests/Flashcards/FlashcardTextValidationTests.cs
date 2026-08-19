using Microsoft.AspNetCore.Http.HttpResults;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Contracts;
using Mnemo.Host.Flashcards;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The length caps shared by every flashcards endpoint that takes free text. The endpoints
/// themselves have no HTTP test harness in this project, so this pins the one piece of the check
/// that is testable without one: whether a value trips the cap, and what a tag normalizes to.
/// </summary>
public class FlashcardTextValidationTests
{
    [Fact]
    public void AValueAtTheCapIsNotTooLong()
    {
        var value = new string('a', FlashcardTextLimits.MaxNameLength);

        var tooLong = FlashcardTextValidation.TooLong(value, FlashcardTextLimits.MaxNameLength, "invalid_name", "A name", out _);

        Assert.False(tooLong);
    }

    [Fact]
    public void OneCharacterOverTheCapIsRefused()
    {
        var value = new string('a', FlashcardTextLimits.MaxNameLength + 1);

        var tooLong = FlashcardTextValidation.TooLong(value, FlashcardTextLimits.MaxNameLength, "invalid_name", "A name", out var error);

        Assert.True(tooLong);
        var badRequest = Assert.IsType<BadRequest<ErrorDto>>(error);
        Assert.Equal("invalid_name", badRequest.Value!.Error);
    }

    [Fact]
    public void TagsAreTrimmedAndTheEmptyOnesDropped()
    {
        var tags = FlashcardTextValidation.NormalizeTags(["  keep  ", "", "   ", "also-keep"]);

        Assert.Equal(["keep", "also-keep"], tags);
    }

    [Fact]
    public void AnOverlongTagIsCappedRatherThanRefused()
    {
        var overlong = new string('x', FlashcardTextLimits.MaxTagLength + 50);

        var tags = FlashcardTextValidation.NormalizeTags([overlong]);

        Assert.Single(tags);
        Assert.Equal(FlashcardTextLimits.MaxTagLength, tags[0].Length);
    }

    [Fact]
    public void NoTagsMeansNoTags()
    {
        Assert.Empty(FlashcardTextValidation.NormalizeTags(null));
    }
}
