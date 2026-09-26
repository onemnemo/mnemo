using Mnemo.Infrastructure.Services.Updates;

namespace Mnemo.Infrastructure.Tests;

public sealed class RebuildNoticeGateTests
{
    [Fact]
    public void Does_not_claim_before_arming()
    {
        var gate = new RebuildNoticeGate();

        Assert.False(gate.TryClaim("overview"));
        Assert.False(gate.IsShown);
    }

    [Fact]
    public void Claims_once_on_the_first_allowed_route_after_arming()
    {
        var gate = new RebuildNoticeGate();
        gate.Arm();

        Assert.False(gate.TryClaim("notes"));
        Assert.False(gate.TryClaim(null));
        Assert.True(gate.TryClaim("overview"));
        Assert.True(gate.IsShown);

        Assert.False(gate.TryClaim("overview"));
        Assert.False(gate.TryClaim("settings"));
    }

    [Fact]
    public void Claims_on_settings_when_that_is_the_first_allowed_route()
    {
        var gate = new RebuildNoticeGate();
        gate.Arm();

        Assert.True(gate.TryClaim("settings"));
        Assert.False(gate.TryClaim("overview"));
    }

    [Fact]
    public void Manual_show_before_arming_keeps_the_automatic_notice_quiet()
    {
        var gate = new RebuildNoticeGate();
        gate.MarkShown();
        gate.Arm();

        Assert.False(gate.TryClaim("overview"));
    }

    [Fact]
    public void Manual_show_after_arming_keeps_the_automatic_notice_quiet()
    {
        var gate = new RebuildNoticeGate();
        gate.Arm();
        gate.MarkShown();

        Assert.False(gate.TryClaim("overview"));
    }
}
