using Mnemo.Host.Startup;

namespace Mnemo.Host.Tests.Startup;

/// <summary>
/// The window draws its own caption buttons, so a window larger than the display
/// puts close and minimize off-screen with no OS titlebar left to drag it back by.
/// The measurement itself needs a real display; the fitting rule does not.
/// </summary>
public sealed class WindowSizingTests
{
    [Fact]
    public void ARoomyDisplayGetsThePreferredSize()
    {
        var bounds = WindowSizing.Resolve(2560, 1400);

        Assert.Equal(WindowSizing.PreferredWidth, bounds.Width);
        Assert.Equal(WindowSizing.PreferredHeight, bounds.Height);
    }

    [Fact]
    public void ASmallLaptopGetsAWindowThatFitsIt()
    {
        // 1366x768 minus a taskbar, the case the hard-coded 1440x900 overhung on every side.
        var bounds = WindowSizing.Resolve(1366, 728);

        Assert.Equal(1366, bounds.Width);
        Assert.Equal(728, bounds.Height);
    }

    [Fact]
    public void OnlyTheOverhangingDimensionIsClamped()
    {
        var bounds = WindowSizing.Resolve(1280, 1440);

        Assert.Equal(1280, bounds.Width);
        Assert.Equal(WindowSizing.PreferredHeight, bounds.Height);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-1, -1)]
    public void AnUnmeasurableDisplayFallsBackToThePreferredSize(int width, int height)
    {
        var bounds = WindowSizing.Resolve(width, height);

        Assert.Equal(WindowSizing.PreferredWidth, bounds.Width);
        Assert.Equal(WindowSizing.PreferredHeight, bounds.Height);
    }

    [Fact]
    public void TheMinimumIsNeverLargerThanTheWindowItConstrains()
    {
        // The OS enforces the minimum, so a floor above the display size would be
        // honoured as a window bigger than the screen, which is what this avoids.
        var bounds = WindowSizing.Resolve(800, 600);

        Assert.Equal(800, bounds.MinWidth);
        Assert.Equal(600, bounds.MinHeight);
    }

    [Fact]
    public void ARoomyDisplayKeepsTheRealMinimum()
    {
        var bounds = WindowSizing.Resolve(2560, 1400);

        Assert.Equal(WindowSizing.MinimumWidth, bounds.MinWidth);
        Assert.Equal(WindowSizing.MinimumHeight, bounds.MinHeight);
    }
}
