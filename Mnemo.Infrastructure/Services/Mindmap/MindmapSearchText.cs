using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// Extracts the searchable text of an element for the FTS mirror: labels, task text, code,
/// captions and titles. Cross-document references (flashcard/note) carry no local text. Their live
/// titles resolve at render time and are not indexed here.
/// </summary>
internal static class MindmapSearchText
{
    public static string Extract(MindmapElement element) => element.Content switch
    {
        TextContent text => text.Text,
        TaskContent task => task.Text,
        CodeContent code => string.IsNullOrEmpty(code.Language) ? code.Source : $"{code.Language} {code.Source}",
        MathContent math => math.Latex,
        ImageContent image => image.Caption ?? string.Empty,
        LinkContent link => Join(link.Title, link.Url),
        ShapeContent shape => shape.Text ?? string.Empty,
        FreeTextContent freeText => freeText.Text,
        FrameContent frame => frame.Title,
        _ => string.Empty,
    };

    private static string Join(string? a, string? b)
    {
        if (string.IsNullOrEmpty(a))
            return b ?? string.Empty;
        if (string.IsNullOrEmpty(b))
            return a;
        return $"{a} {b}";
    }
}
