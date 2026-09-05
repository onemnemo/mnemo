namespace Mnemo.Core.Models;

/// <summary>Additional visibility rules for sidebar entries beyond localization.</summary>
public enum SidebarItemVisibilityRequirement
{
    None,
    /// <summary>Show only while the assistant is available; see <c>AiAvailability</c>.</summary>
    AiAssistantEnabled,
}
