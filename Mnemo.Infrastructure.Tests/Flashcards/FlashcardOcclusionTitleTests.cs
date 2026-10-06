using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Search;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.OcclusionTestKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>How an occlusion card is named in the trash list and in search results.</summary>
public sealed class FlashcardOcclusionTitleTests
{
    private static async Task<string[]> TrashedTitlesAsync(string front, string? label)
    {
        await using var h = await OpenAsync();
        var saved = await SaveAsync(h, Doc(Mask("aa", 0, label), Mask("bb", 1, "Kept")), front: front);
        await SaveAsync(h, Doc(Mask("bb", 1, "Kept")), saved.Fact.Id, front: front);
        return [.. (await h.HeldAsync()).Select(e => e.Title)];
    }

    [Fact]
    public async Task A_trashed_card_is_titled_by_its_question_and_label()
    {
        Assert.Equal(["Label the cell: Ribosomes"], await TrashedTitlesAsync("Label the cell", "Ribosomes"));
    }

    [Fact]
    public async Task A_trashed_card_without_a_question_is_titled_by_its_label()
    {
        Assert.Equal(["Ribosomes"], await TrashedTitlesAsync("", "Ribosomes"));
    }

    [Fact]
    public async Task A_trashed_card_with_neither_is_titled_by_the_type_name()
    {
        Assert.Equal([FlashcardCardType.OcclusionName], await TrashedTitlesAsync("", null));
    }

    [Fact]
    public async Task A_search_result_is_titled_by_its_question_and_label()
    {
        await using var h = await OpenAsync();
        await h.Store.InitializeAsync();
        await SaveAsync(h, Doc(Mask("aa", 0, "Ribosomes")), front: "Label the cell");
        await SaveAsync(h, Doc(Mask("cc", 0, "Nucleolus")), front: "");

        var provider = new FlashcardsSearchProvider(
            new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock),
            new FlashcardLibraryService(
                h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock));

        var withQuestion = await provider.SearchAsync(SearchQuery.Create("Ribosomes"), default);
        var withoutQuestion = await provider.SearchAsync(SearchQuery.Create("Nucleolus"), default);

        Assert.Equal("Label the cell: Ribosomes", Assert.Single(withQuestion).Title);
        Assert.Equal("Nucleolus", Assert.Single(withoutQuestion).Title);
    }
}
