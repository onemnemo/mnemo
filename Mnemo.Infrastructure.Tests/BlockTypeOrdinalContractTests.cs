using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Pins persisted block and flashcard type ordinals. New members must be appended to preserve
/// stored numeric values.
/// </summary>
public class BlockTypeOrdinalContractTests
{
    // BlockJsonConverter falls back to the ordinal when a saved block's type arrives as a
    // number, so this declaration order is part of the note file format.
    [Fact]
    public void BlockType_OrdinalsMatchTheStoredFormat()
    {
        Assert.Equal(0, (int)BlockType.Text);
        Assert.Equal(1, (int)BlockType.Heading1);
        Assert.Equal(2, (int)BlockType.Heading2);
        Assert.Equal(3, (int)BlockType.Heading3);
        Assert.Equal(4, (int)BlockType.Heading4);
        Assert.Equal(5, (int)BlockType.BulletList);
        Assert.Equal(6, (int)BlockType.NumberedList);
        Assert.Equal(7, (int)BlockType.Checklist);
        Assert.Equal(8, (int)BlockType.Quote);
        Assert.Equal(9, (int)BlockType.Code);
        Assert.Equal(10, (int)BlockType.Divider);
        Assert.Equal(11, (int)BlockType.Image);
        Assert.Equal(12, (int)BlockType.ColumnGroup);
        Assert.Equal(13, (int)BlockType.TwoColumn);
        Assert.Equal(14, (int)BlockType.Equation);
        Assert.Equal(15, (int)BlockType.Page);
        Assert.Equal(16, (int)BlockType.Sketch);
        Assert.Equal(17, (int)BlockType.Callout);
        Assert.Equal(18, (int)BlockType.Table);
        Assert.Equal(19, (int)BlockType.TableRow);
        Assert.Equal(20, (int)BlockType.TableCell);
    }

    [Fact]
    public void BlockType_HasExactlyTheMembersListedAbove()
    {
        // Require an explicit contract update when a member is added.
        Assert.Equal(21, Enum.GetValues<BlockType>().Length);
    }

    // CardRepository reads this column back with a cast from a stored integer, so this
    // declaration order is part of the flashcard database schema.
    [Fact]
    public void FlashcardType_OrdinalsMatchTheStoredFormat()
    {
        Assert.Equal(0, (int)FlashcardType.Classic);
        Assert.Equal(1, (int)FlashcardType.Cloze);
    }

    [Fact]
    public void FlashcardType_HasExactlyTheMembersListedAbove()
    {
        Assert.Equal(2, Enum.GetValues<FlashcardType>().Length);
    }
}
