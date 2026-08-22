using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The rule that turns a card type and a fact into cards. The web editor keeps a matching copy for
/// its live count, so a change here needs the same change there.
/// </summary>
public sealed class FlashcardGenerationTests
{
    private static FlashcardCardType BuiltIn(string id) =>
        FlashcardCardType.CreateBuiltIns(DateTimeOffset.UnixEpoch).Single(t => t.Id == id);

    private static FlashcardFact Fact(
        string typeId,
        Dictionary<string, string> values,
        Dictionary<string, IReadOnlyList<FlashcardAttachment>>? media = null) =>
        new(
            Id: "fact-1",
            DeckId: "deck-1",
            TypeId: typeId,
            Values: values,
            Media: media ?? [],
            Tags: [],
            IsFlagged: false);

    private static FlashcardAttachment Image(string id) =>
        new(id, FlashcardAttachment.FrontSide, $"C:/images/{id}.png", $"{id}.png", 100);

    // --- ordinary layouts ---

    [Fact]
    public void A_basic_fact_makes_one_card_keyed_by_its_layout()
    {
        var type = BuiltIn(FlashcardCardType.BasicId);
        var fact = Fact(type.Id, new() { ["front"] = "Which class blocks sodium?", ["back"] = "Class I" });

        var cards = FlashcardGeneration.Generate(type, fact);

        var card = Assert.Single(cards);
        Assert.Equal(FlashcardCardType.RecognitionLayoutId, card.Key);
        Assert.Equal("Recognition", card.LayoutName);
        Assert.Equal("Which class blocks sodium?", card.Front);
        Assert.Equal("Class I", card.Back);
    }

    [Fact]
    public void A_reverse_type_makes_both_directions_from_one_fact()
    {
        var type = BuiltIn(FlashcardCardType.BasicReverseId);
        var fact = Fact(type.Id, new() { ["front"] = "flecainide", ["back"] = "class Ic" });

        var cards = FlashcardGeneration.Generate(type, fact);

        Assert.Equal(2, cards.Count);
        Assert.Equal(["recognition", "recall"], cards.Select(c => c.Key));
        Assert.Equal("flecainide", cards[0].Front);
        Assert.Equal("class Ic", cards[1].Front);
    }

    [Fact]
    public void A_reversed_card_collects_the_media_of_the_field_its_front_names()
    {
        var type = BuiltIn(FlashcardCardType.BasicReverseId);
        var frontImage = Image("trace");
        var backImage = Image("channel");
        var fact = Fact(
            type.Id,
            new() { ["front"] = "flecainide", ["back"] = "class Ic" },
            new() { ["front"] = [frontImage], ["back"] = [backImage] });

        var cards = FlashcardGeneration.Generate(type, fact);

        // Keying media by field rather than by side is what makes this come out right without
        // anything in the generator knowing reversal exists.
        Assert.Equal([frontImage], cards[0].FrontMedia);
        Assert.Equal([backImage], cards[0].BackMedia);
        Assert.Equal([backImage], cards[1].FrontMedia);
        Assert.Equal([frontImage], cards[1].BackMedia);
    }

    [Fact]
    public void A_layout_naming_two_fields_collects_both_in_template_order()
    {
        var type = BuiltIn(FlashcardCardType.VocabularyId);
        var meaning = Image("meaning");
        var example = Image("example");
        var fact = Fact(
            type.Id,
            new() { ["word"] = "arrhythmia", ["meaning"] = "irregular rhythm", ["example"] = "an arrhythmia on the trace" },
            new() { ["meaning"] = [meaning], ["example"] = [example] });

        var recognition = FlashcardGeneration.Generate(type, fact).Single(c => c.Key == "recognition");

        Assert.Equal([meaning, example], recognition.BackMedia);
    }

    // --- required and dormant layouts ---

    [Fact]
    public void A_layout_whose_required_field_is_empty_makes_no_card_and_is_reported_dormant()
    {
        var type = BuiltIn(FlashcardCardType.VocabularyId);
        var fact = Fact(type.Id, new() { ["word"] = "arrhythmia", ["meaning"] = "irregular rhythm" });

        var cards = FlashcardGeneration.Generate(type, fact);
        var dormant = FlashcardGeneration.Dormant(type, fact);

        Assert.Equal(2, cards.Count);
        Assert.DoesNotContain(cards, c => c.Key == "in-context");
        var waiting = Assert.Single(dormant);
        Assert.Equal("in-context", waiting.Layout.Id);
        Assert.Equal("Example", waiting.NeedsFieldName);
    }

    [Fact]
    public void Filling_the_required_field_switches_the_layout_on()
    {
        var type = BuiltIn(FlashcardCardType.VocabularyId);
        var fact = Fact(type.Id, new()
        {
            ["word"] = "arrhythmia",
            ["meaning"] = "irregular rhythm",
            ["example"] = "an arrhythmia on the trace",
        });

        Assert.Equal(3, FlashcardGeneration.Generate(type, fact).Count);
        Assert.Empty(FlashcardGeneration.Dormant(type, fact));
    }

    [Fact]
    public void A_field_holding_only_whitespace_does_not_count_as_filled()
    {
        var type = BuiltIn(FlashcardCardType.VocabularyId);
        var fact = Fact(type.Id, new()
        {
            ["word"] = "arrhythmia",
            ["meaning"] = "irregular rhythm",
            ["example"] = "   \n  ",
        });

        Assert.DoesNotContain(FlashcardGeneration.Generate(type, fact), c => c.Key == "in-context");
    }

    [Fact]
    public void A_generated_type_reports_no_dormant_layouts()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var fact = Fact(type.Id, new() { ["text"] = "no deletions here" });

        Assert.Empty(FlashcardGeneration.Dormant(type, fact));
    }

    // --- rendering ---

    [Fact]
    public void A_marker_naming_a_field_the_type_lost_is_dropped_with_its_blank_line()
    {
        var type = new FlashcardCardType(
            "custom", "Custom", false,
            [new FlashcardField("a", "Alpha")],
            "a",
            [new FlashcardLayout("only", "Only", "{{Alpha}}", "{{Alpha}}\n\n{{Removed}}\n\nafter")]);
        var fact = Fact("custom", new() { ["a"] = "kept" });

        var card = Assert.Single(FlashcardGeneration.Generate(type, fact));

        Assert.Equal("kept\n\nafter", card.Back);
    }

    [Fact]
    public void Field_markers_match_the_name_regardless_of_case_and_padding()
    {
        var type = new FlashcardCardType(
            "custom", "Custom", false,
            [new FlashcardField("a", "Alpha")],
            "a",
            [new FlashcardLayout("only", "Only", "{{ alpha }}", "{{ALPHA}}")]);
        var fact = Fact("custom", new() { ["a"] = "kept" });

        var card = Assert.Single(FlashcardGeneration.Generate(type, fact));

        Assert.Equal("kept", card.Front);
        Assert.Equal("kept", card.Back);
    }

    // --- cloze ---

    [Fact]
    public void A_cloze_fact_makes_one_card_per_deletion_in_ascending_order()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var fact = Fact(type.Id, new()
        {
            ["text"] = "{{c2::Amiodarone}} is class {{c1::III}} and also {{c2::a beta blocker}}",
        });

        var cards = FlashcardGeneration.Generate(type, fact);

        Assert.Equal(["c1", "c2"], cards.Select(c => c.Key));
        Assert.All(cards, c => Assert.Null(c.LayoutName));
    }

    [Fact]
    public void A_cloze_card_hides_its_own_deletion_and_shows_every_other_one()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var fact = Fact(type.Id, new() { ["text"] = "{{c1::Lidocaine}} is class {{c2::Ib}}" });

        var cards = FlashcardGeneration.Generate(type, fact);

        Assert.Equal("[…] is class Ib", cards[0].Front);
        Assert.Equal("Lidocaine is class […]", cards[1].Front);
        Assert.Equal("Lidocaine is class Ib", cards[0].Back);
    }

    [Fact]
    public void A_hint_is_shown_in_place_of_the_placeholder()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var fact = Fact(type.Id, new() { ["text"] = "blocks {{c1::sodium::which ion}} channels" });

        var card = Assert.Single(FlashcardGeneration.Generate(type, fact));

        Assert.Equal("blocks [which ion] channels", card.Front);
        Assert.Equal("blocks sodium channels", card.Back);
    }

    [Fact]
    public void The_extra_field_rides_on_the_back_of_every_card_the_fact_makes()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var fact = Fact(type.Id, new()
        {
            ["text"] = "{{c1::Lidocaine}} is class {{c2::Ib}}",
            ["extra"] = "Shortens repolarisation.",
        });

        var cards = FlashcardGeneration.Generate(type, fact);

        Assert.Equal(2, cards.Count);
        Assert.All(cards, c => Assert.EndsWith("Shortens repolarisation.", c.Back, StringComparison.Ordinal));
    }

    [Fact]
    public void A_cloze_card_keeps_the_source_figure_on_the_question_side()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var trace = Image("trace");
        var fact = Fact(
            type.Id,
            new() { ["text"] = "the upstroke is phase {{c1::0}}" },
            new() { ["text"] = [trace] });

        var card = Assert.Single(FlashcardGeneration.Generate(type, fact));

        // The figure is what the sentence is read against, so blanking the text must not take it away.
        Assert.Equal([trace], card.FrontMedia);
    }

    [Fact]
    public void Text_with_no_deletion_makes_no_cards()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var fact = Fact(type.Id, new() { ["text"] = "nothing is deleted here" });

        Assert.Empty(FlashcardGeneration.Generate(type, fact));
    }

    [Fact]
    public void A_deletion_number_too_large_to_be_one_is_ignored_rather_than_throwing()
    {
        var text = "{{c99999999999999999999::x}} and {{c2::y}}";

        Assert.Equal([2], FlashcardGeneration.ClozeOrdinals(text));
    }

    [Fact]
    public void A_deletion_may_wrap_a_line()
    {
        // A deletion long enough to be a clause is normally typed across a line, and the web copy
        // reads it the same way.
        Assert.Equal([1], FlashcardGeneration.ClozeOrdinals("{{c1::first\nsecond}}"));
    }

    [Fact]
    public void A_wrapped_deletion_is_masked_and_revealed_rather_than_printed_verbatim()
    {
        var text = "Found only in {{c1::plant\n}}cells outside the wall";

        Assert.Equal(
            $"Found only in {FlashcardGeneration.ClozePlaceholder}cells outside the wall",
            FlashcardGeneration.MaskCloze(text, 1, reveal: false));
        Assert.Equal(
            "Found only in plant\ncells outside the wall",
            FlashcardGeneration.MaskCloze(text, 1, reveal: true));
    }

    [Fact]
    public void A_deletion_does_not_cross_a_blank_line()
    {
        // Where one thought ends, a marker still open was left unclosed rather than wrapped.
        Assert.Empty(FlashcardGeneration.ClozeOrdinals("{{c1::first\n\nsecond}}"));
    }

    [Fact]
    public void An_unclosed_deletion_does_not_swallow_the_finished_one_after_it()
    {
        // What the old line-bound pattern ruled out by accident, and the reason the body refuses
        // the next deletion's opening rather than simply allowing newlines.
        Assert.Equal([2], FlashcardGeneration.ClozeOrdinals("{{c1::unclosed\nand later {{c2::closed}}"));
    }

    // --- stable keys ---

    [Fact]
    public void Keys_survive_an_ordinary_edit_to_the_material()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var before = Fact(type.Id, new() { ["text"] = "{{c1::Lidocaine}} is class {{c2::Ib}}" });
        var after = Fact(type.Id, new() { ["text"] = "{{c1::Lidocaine}} is a class {{c2::Ib}} agent" });

        Assert.Equal(
            FlashcardGeneration.Generate(type, before).Select(c => c.Key),
            FlashcardGeneration.Generate(type, after).Select(c => c.Key));
    }

    [Fact]
    public void Removing_one_deletion_leaves_the_other_keys_alone()
    {
        var type = BuiltIn(FlashcardCardType.ClozeId);
        var before = Fact(type.Id, new() { ["text"] = "{{c1::a}} {{c2::b}} {{c3::c}}" });
        var after = Fact(type.Id, new() { ["text"] = "{{c1::a}} b {{c3::c}}" });

        Assert.Equal(["c1", "c2", "c3"], FlashcardGeneration.Generate(type, before).Select(c => c.Key));
        Assert.Equal(["c1", "c3"], FlashcardGeneration.Generate(type, after).Select(c => c.Key));
    }

    [Fact]
    public void A_cloze_key_round_trips_through_its_ordinal()
    {
        Assert.Equal("c7", FlashcardGeneration.ClozeKey(7));
        Assert.Equal(7, FlashcardGeneration.ClozeOrdinalFromKey("c7"));
        Assert.Null(FlashcardGeneration.ClozeOrdinalFromKey("recognition"));
        Assert.Null(FlashcardGeneration.ClozeOrdinalFromKey("c"));
    }

    // --- occlusion ---

    [Fact]
    public void An_occlusion_fact_makes_one_card_carrying_the_prompt_image()
    {
        var diagram = Image("diagram");
        var type = new FlashcardCardType(
            "occ", "Occlusion", false,
            [new FlashcardField("prompt", "Prompt"), new FlashcardField("notes", "Notes")],
            "prompt",
            [],
            Generator: FlashcardGenerators.Occlusion,
            GenerateFrom: "prompt");
        var fact = Fact(
            "occ",
            new() { ["prompt"] = "Name the region", ["notes"] = "Anterior wall" },
            new() { ["prompt"] = [diagram] });

        var card = Assert.Single(FlashcardGeneration.Generate(type, fact));

        Assert.Equal("m1", card.Key);
        Assert.Equal("Name the region", card.Front);
        Assert.Equal("Anterior wall", card.Back);
        Assert.Equal([diagram], card.FrontMedia);
    }
}
