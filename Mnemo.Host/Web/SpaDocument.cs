namespace Mnemo.Host.Web;

/// <summary>
/// The page as it is served, and the policy it has to be served under.
/// </summary>
/// <remarks>
/// The two travel together because the policy names a nonce that only appears in this
/// exact HTML. Serving one without the other leaves either a page whose own scripts are
/// blocked, or a policy that permits a nonce nothing on the page carries.
/// </remarks>
public sealed record SpaDocument(string Html, string ContentSecurityPolicy);
