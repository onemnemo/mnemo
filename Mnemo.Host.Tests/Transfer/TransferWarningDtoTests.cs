using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Tests.Transfer;

/// <summary>What a warning puts on the wire for the client to render.</summary>
public sealed class TransferWarningDtoTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void CountedWarning_SendsBothKeysAndTheCount()
    {
        var model = TransferWarning.Counted("CardsAddedOne", "CardsAddedMany", 12, ("deckName", "Spanish"));

        var json = JsonSerializer.SerializeToElement(TransferWarningDto.FromModel(model).WithFileName("deck.apkg"), Json);

        Assert.Equal("CardsAddedMany", json.GetProperty("key").GetString());
        Assert.Equal("CardsAddedOne", json.GetProperty("oneKey").GetString());
        Assert.Equal(12, json.GetProperty("count").GetInt32());
        var parameters = json.GetProperty("params");
        Assert.Equal("12", parameters.GetProperty("count").GetString());
        Assert.Equal("Spanish", parameters.GetProperty("deckName").GetString());
        Assert.Equal("deck.apkg", parameters.GetProperty("fileName").GetString());
    }

    [Fact]
    public void CountedWarning_OfZero_StillSendsTheCountAndTheManyKey()
    {
        var json = JsonSerializer.SerializeToElement(
            TransferWarningDto.FromModel(TransferWarning.Counted("CardsAddedOne", "CardsAddedMany", 0, ("count", "99"))),
            Json);

        Assert.Equal("CardsAddedMany", json.GetProperty("key").GetString());
        Assert.Equal(0, json.GetProperty("count").GetInt32());
        Assert.Equal("0", json.GetProperty("params").GetProperty("count").GetString());
    }

    [Fact]
    public void PlainWarning_SendsNoPluralPair()
    {
        var json = JsonSerializer.SerializeToElement(TransferWarningDto.FromModel(TransferWarning.Of("FlashcardsPayloadUnreadable")), Json);

        Assert.Equal(JsonValueKind.Null, json.GetProperty("oneKey").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("count").ValueKind);
    }
}
