using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Chat.ViewModels;

public class ChatAttachmentViewModel : ViewModelBase
{
    public string Path { get; }
    public string DisplayName { get; }
    public ChatAttachmentKind Kind { get; }
    public ICommand RemoveCommand { get; }

    /// <summary>Human-readable file size (e.g. "48 KB"); empty when the file no longer exists.</summary>
    public string SizeText { get; }

    public bool HasSizeText => SizeText.Length > 0;

    public ChatAttachmentViewModel(string path, ChatAttachmentKind kind, string? displayName, ICommand removeCommand)
    {
        Path = path;
        Kind = kind;
        DisplayName = displayName ?? System.IO.Path.GetFileName(path);
        RemoveCommand = removeCommand;
        SizeText = TryFormatFileSize(path);
    }

    private static string TryFormatFileSize(string path)
    {
        try
        {
            var info = new System.IO.FileInfo(path);
            if (!info.Exists)
                return string.Empty;
            var bytes = info.Length;
            return bytes switch
            {
                < 1024 => $"{bytes} B",
                < 1024 * 1024 => $"{bytes / 1024.0:0} KB",
                _ => $"{bytes / (1024.0 * 1024.0):0.#} MB"
            };
        }
        catch (System.IO.IOException)
        {
            return string.Empty;
        }
        catch (System.UnauthorizedAccessException)
        {
            return string.Empty;
        }
    }
}
