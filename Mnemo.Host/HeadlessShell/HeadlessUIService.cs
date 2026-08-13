using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>Bundles the headless overlay and theme bindings behind <see cref="IUIService"/>.</summary>
public sealed class HeadlessUIService : IUIService
{
    public HeadlessUIService(IOverlayService overlays, IThemeService themes)
    {
        Overlays = overlays;
        Themes = themes;
    }

    public IOverlayService Overlays { get; }
    public IThemeService Themes { get; }
}
