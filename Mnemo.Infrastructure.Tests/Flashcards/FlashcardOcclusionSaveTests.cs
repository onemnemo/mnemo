using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.OcclusionTestKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>What a save does with a Masks value it cannot store exactly as sent.</summary>
public sealed class FlashcardOcclusionSaveTests
{
    [Fact]
    public async Task A_mask_that_cannot_be_read_is_refused_rather_than_dropped()
    {
        await using var h = await OpenAsync();
        var masks = Doc(Mask("aa", 0)).Replace("]}", """,{"id":"BAD!","shape":"rect","x":0.5,"y":0.5,"w":0.1,"h":0.1,"order":1}]}""");

        var error = await Assert.ThrowsAsync<ArgumentException>(() => SaveAsync(h, masks));
        Assert.Contains("could not be read", error.Message);
    }

    [Fact]
    public async Task More_masks_than_the_cap_are_refused()
    {
        await using var h = await OpenAsync();
        var many = Enumerable.Range(0, FlashcardOcclusion.MaxMasks + 1).Select(i => Mask($"m{i:D7}", i)).ToArray();

        await Assert.ThrowsAsync<ArgumentException>(() => SaveAsync(h, Doc(many)));
    }

    [Theory]
    [InlineData(FlashcardCardType.OcclusionMasksFieldId)]
    [InlineData(FlashcardCardType.OcclusionImageFieldId)]
    [InlineData(FlashcardCardType.OcclusionBackFieldId)]
    public async Task The_occlusion_type_keeps_the_fields_its_generator_reads(string fieldId)
    {
        await using var h = await OpenAsync();
        var saved = await SaveAsync(h, Doc(Mask("aa", 0)));
        var type = (await h.FactService.GetCardTypeAsync(FlashcardCardType.OcclusionId))!;

        await Assert.ThrowsAsync<ArgumentException>(() =>
            h.FactService.SaveCardTypeAsync(type with { Fields = [.. type.Fields.Where(f => f.Id != fieldId)] }));

        Assert.NotNull(await LiveCardAsync(h, saved.Cards[0].Id));
    }

    [Fact]
    public async Task A_readable_document_is_stored_in_canonical_form()
    {
        await using var h = await OpenAsync();
        var spaced = Doc(Mask("aa", 0), Mask("bb", 1)).Replace(",", ", ");

        var saved = await SaveAsync(h, spaced);

        var stored = saved.Fact.Value(FlashcardCardType.OcclusionMasksFieldId);
        Assert.Equal(Doc(Mask("aa", 0), Mask("bb", 1)), stored);
        Assert.Equal(2, saved.Cards.Count);
    }
}
