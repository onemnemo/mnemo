using Microsoft.AspNetCore.Builder;

namespace Mnemo.Host.Web;

/// <summary>Marks a route that accepts the <see cref="ImageCookie"/> on GET. Image routes only.</summary>
public sealed class ImageCookieRoute
{
    private ImageCookieRoute()
    {
    }

    internal static ImageCookieRoute Instance { get; } = new();
}

public static class ImageCookieRouteExtensions
{
    public static RouteHandlerBuilder AllowImageCookie(this RouteHandlerBuilder builder)
        => builder.WithMetadata(ImageCookieRoute.Instance);
}
