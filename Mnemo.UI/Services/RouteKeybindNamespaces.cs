namespace Mnemo.UI.Services;

/// <summary>Maps navigation route to keybind namespace for local bindings.</summary>
public static class RouteKeybindNamespaces
{
    public static string? ForRoute(string? route)
    {
        if (string.IsNullOrEmpty(route))
            return null;

        return route switch
        {
            "overview" => "overview",
            "notes" => "editor",
            "mindmap" => null,
            "mindmap-detail" => "mindmap",
            "flashcards" => null,
            "flashcard-deck" => "editor",
            "flashcard-practice" => null,
            "settings" => "settings",
            "chat" => "chat",
            _ => route
        };
    }
}
