namespace Mnemo.Infrastructure.Modules.Overview;

/// <summary>
/// Builds the icon URI a widget manifest carries. The scheme is the desktop shell's resource
/// scheme and each widget's <c>icon.svg</c> is bundled there; readers that are not that shell
/// map the tail of the path onto their own asset registry rather than resolving the URI.
/// </summary>
public static class WidgetIconAvares
{
    private const string Root = "avares://Mnemo.UI/Modules/Overview/Widgets";

    /// <param name="widgetFolder">
    /// Folder name under <c>Modules/Overview/Widgets</c> that contains <c>icon.svg</c>.
    /// </param>
    public static string Uri(string widgetFolder)
    {
        if (string.IsNullOrWhiteSpace(widgetFolder))
            throw new ArgumentException("Widget folder name is required.", nameof(widgetFolder));
        return $"{Root}/{widgetFolder.Trim().Trim('/')}/icon.svg";
    }
}
