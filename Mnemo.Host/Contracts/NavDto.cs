namespace Mnemo.Host.Contracts;

/// <summary>
/// One sidebar category for the SPA. Labels travel as translation keys (namespace
/// <see cref="Namespace"/>); the SPA localizes them so language switches apply live.
/// </summary>
public sealed record NavCategoryDto(string Key, string Namespace, int Order, bool Footer, IReadOnlyList<NavItemDto> Items);

/// <summary>
/// One sidebar item. <see cref="Icon"/> is the SPA icon id (e.g. <c>sidebar/overview</c>).
/// <see cref="Visible"/> already accounts for visibility requirements such as the
/// AI-assistant toggle, so the SPA renders items where it is true.
/// </summary>
public sealed record NavItemDto(
    string Route,
    string LabelKey,
    string Namespace,
    string Icon,
    int Order,
    IReadOnlyList<string> ChildRoutes,
    bool Visible);
