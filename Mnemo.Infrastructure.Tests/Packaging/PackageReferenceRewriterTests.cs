using System.Collections.Generic;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Packaging;

public sealed class PackageReferenceRewriterTests
{
    private static readonly Dictionary<string, string> Renamed = new() { ["old"] = "new" };

    [Fact]
    public void A_sub_page_block_nested_in_a_column_follows_the_renamed_note()
    {
        var nested = new Block { Type = BlockType.Page, Payload = new PagePayload("old") };
        var untouched = new Block { Type = BlockType.Page, Payload = new PagePayload("live") };
        var note = new Note
        {
            Blocks = [new Block { Type = BlockType.ColumnGroup, Children = [nested, untouched] }],
        };

        PackageReferenceRewriter.RewriteNote(note, Renamed);

        Assert.Equal("new", Assert.IsType<PagePayload>(nested.Payload).ReferenceNoteId);
        Assert.Equal("live", Assert.IsType<PagePayload>(untouched.Payload).ReferenceNoteId);
    }

    [Fact]
    public void A_page_line_in_legacy_content_follows_the_renamed_note_and_an_inline_mention_does_not()
    {
        var note = new Note
        {
            Content = "Intro\r\n  [[page:old]] \r\nsee [[page:old]] here\n[[page:live]]\n[[page:old]]",
        };

        PackageReferenceRewriter.RewriteNote(note, Renamed);

        Assert.Equal("Intro\r\n  [[page:new]] \r\nsee [[page:old]] here\n[[page:live]]\n[[page:new]]", note.Content);
    }
}
