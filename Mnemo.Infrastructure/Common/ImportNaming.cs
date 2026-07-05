namespace Mnemo.Infrastructure.Common;

/// <summary>
/// Produces "Name (2)"-style names for items duplicated by an import conflict.
/// </summary>
public static class ImportNaming
{
    public static string NextAvailableName(string baseName, IReadOnlySet<string> usedNames)
    {
        var name = string.IsNullOrWhiteSpace(baseName) ? "Untitled" : baseName.Trim();
        if (!usedNames.Contains(name))
            return name;

        for (var i = 2; ; i++)
        {
            var candidate = $"{name} ({i})";
            if (!usedNames.Contains(candidate))
                return candidate;
        }
    }
}
