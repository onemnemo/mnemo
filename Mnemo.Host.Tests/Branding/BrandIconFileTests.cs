using System.Buffers.Binary;
using Mnemo.Host.Branding;

namespace Mnemo.Host.Tests.Branding;

public sealed class BrandIconFileTests
{
    [Theory]
    [InlineData("sunset")]
    [InlineData("accent:blue.r2")]
    [InlineData("deep-sea")]
    public void AcceptsKeysFromTheAllowedAlphabet(string key) => Assert.True(BrandIconFile.IsValidKey(key));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Sunset")]
    [InlineData("a/b")]
    [InlineData("..\\icon")]
    [InlineData("sun set")]
    public void RefusesAnyOtherKey(string? key) => Assert.False(BrandIconFile.IsValidKey(key));

    [Fact]
    public void RefusesAKeyLongerThanTheLimit()
    {
        Assert.True(BrandIconFile.IsValidKey(new string('a', BrandIconFile.MaxKeyLength)));
        Assert.False(BrandIconFile.IsValidKey(new string('a', BrandIconFile.MaxKeyLength + 1)));
    }

    [Fact]
    public void FileNamesStayDistinctForKeysThatDifferOnlyByColonAndHyphen()
    {
        Assert.Equal("icon-accent_blue.ico", BrandIconFile.FileNameFor("accent:blue", BrandIconFile.Ico));
        Assert.Equal("icon-accent-blue.png", BrandIconFile.FileNameFor("accent-blue", BrandIconFile.Png256));
    }

    [Theory]
    [InlineData(BrandIconFile.Png256, 256)]
    [InlineData(BrandIconFile.Png1024, 1024)]
    public void APngOfTheExpectedSizePasses(string format, int size) =>
        Assert.Null(BrandIconFile.Validate(format, BrandIconFixtures.Png(size, size)));

    [Theory]
    [InlineData(BrandIconFile.Png256, 255, 256)]
    [InlineData(BrandIconFile.Png256, 1024, 1024)]
    [InlineData(BrandIconFile.Png1024, 1024, 1023)]
    public void APngOfAnotherSizeIsRefused(string format, int width, int height) =>
        Assert.Equal("wrong_size", BrandIconFile.Validate(format, BrandIconFixtures.Png(width, height)));

    [Fact]
    public void AFileWithoutThePngSignatureIsRefused()
    {
        var png = BrandIconFixtures.Png(256, 256);
        png[1] = (byte)'J';

        Assert.Equal("invalid_png", BrandIconFile.Validate(BrandIconFile.Png256, png));
        Assert.Equal("invalid_png", BrandIconFile.Validate(BrandIconFile.Png256, png.AsSpan(0, 20)));
    }

    [Fact]
    public void APngWhoseFirstChunkIsNotTheHeaderIsRefused()
    {
        var png = BrandIconFixtures.Png(256, 256);
        "IDAT"u8.CopyTo(png.AsSpan(12));

        Assert.Equal("invalid_png", BrandIconFile.Validate(BrandIconFile.Png256, png));
    }

    [Fact]
    public void AnIcoOfPngEntriesIncluding256Passes() =>
        Assert.Null(BrandIconFile.Validate(BrandIconFile.Ico, BrandIconFixtures.Ico(16, 24, 32, 48, 64, 256)));

    [Fact]
    public void AnIcoWithout256IsRefused() =>
        Assert.Equal("missing_256", BrandIconFile.Validate(BrandIconFile.Ico, BrandIconFixtures.Ico(16, 32, 48)));

    [Fact]
    public void AnIcoEntryWhosePngDisagreesWithItsDeclaredSizeIsRefused()
    {
        var ico = BrandIconFixtures.Ico((32, BrandIconFixtures.Png(48, 48)), (256, BrandIconFixtures.Png(256, 256)));

        Assert.Equal("wrong_size", BrandIconFile.Validate(BrandIconFile.Ico, ico));
    }

    [Fact]
    public void AnIcoEntryThatIsNotAPngIsRefused()
    {
        var bitmap = new byte[64];
        var ico = BrandIconFixtures.Ico((32, bitmap), (256, BrandIconFixtures.Png(256, 256)));

        Assert.Equal("invalid_ico", BrandIconFile.Validate(BrandIconFile.Ico, ico));
    }

    [Fact]
    public void AnIcoEntryPointingPastTheEndIsRefused()
    {
        var ico = BrandIconFixtures.Ico(256);
        BinaryPrimitives.WriteUInt32LittleEndian(ico.AsSpan(6 + 12), (uint)ico.Length - 4);

        Assert.Equal("invalid_ico", BrandIconFile.Validate(BrandIconFile.Ico, ico));
    }

    [Fact]
    public void AnIcoWithABadHeaderIsRefused()
    {
        var wrongType = BrandIconFixtures.Ico(256);
        wrongType[2] = 2;
        var tooMany = BrandIconFixtures.Ico(16, 20, 24, 32, 40, 48, 64, 128, 256);
        var none = new byte[] { 0, 0, 1, 0, 0, 0 };

        Assert.Equal("invalid_ico", BrandIconFile.Validate(BrandIconFile.Ico, wrongType));
        Assert.Equal("invalid_ico", BrandIconFile.Validate(BrandIconFile.Ico, tooMany));
        Assert.Equal("invalid_ico", BrandIconFile.Validate(BrandIconFile.Ico, none));
        Assert.Equal("invalid_ico", BrandIconFile.Validate(BrandIconFile.Ico, BrandIconFixtures.Png(256, 256)));
    }
}
