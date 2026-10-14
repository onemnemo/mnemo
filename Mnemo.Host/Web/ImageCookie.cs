using Microsoft.AspNetCore.Http;

namespace Mnemo.Host.Web;

/// <summary>Lets a plain <c>img src</c> read images, which a bearer header cannot do.</summary>
/// <remarks>The name carries the port because cookies ignore ports.</remarks>
public sealed record ImageCookie(string Name, string Value)
{
    public static ImageCookie Mint(int port) => new($"mnemo_img_{port}", LocalApiSecurity.MintBearerToken());

    public void AppendTo(HttpResponse response) => response.Cookies.Append(Name, Value, new CookieOptions
    {
        Path = "/api",
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
    });
}
