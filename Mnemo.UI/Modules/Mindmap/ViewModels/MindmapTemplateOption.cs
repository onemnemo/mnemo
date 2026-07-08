namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>A style template choice in the top-bar picker. <see cref="IsUser"/> distinguishes the user's
/// saved templates (which can be deleted) from the shipped built-ins.</summary>
public sealed record MindmapTemplateOption(string Id, string Label, bool IsUser = false);
