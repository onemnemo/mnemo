using Mnemo.Core.Models;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Tests.Events;

public sealed class ToastEventDtoTests
{
    [Fact]
    public void ProgressUsesTheClientWireName()
    {
        var dto = ToastEventDto.From(ToastType.Progress, TimeSpan.Zero, "Backing up", "Mnemo backup");

        Assert.Equal("progress", dto.Type);
        Assert.Equal(0, dto.DurationMs);
    }
}
