using System;
using System.Globalization;
using Avalonia.Data.Converters;
using Mnemo.UI.Modules.Chat.ViewModels;

namespace Mnemo.UI.Converters;

/// <summary>
/// Resolves a command from <see cref="ChatViewModel"/> using <see cref="IValueConverter.Convert"/>'s
/// <paramref name="parameter"/> (e.g. <c>Regenerate</c>). Use with <c>Path=DataContext</c> only.
/// </summary>
public sealed class ChatViewModelDataContextCommandConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not ChatViewModel vm)
            return null;

        return (parameter as string) switch
        {
            "Suggestion" => vm.SuggestionSelectedCommand,
            "Regenerate" => vm.RegenerateAssistantMessageCommand,
            "Copy" => vm.CopyMessageCommand,
            "ThumbUp" => vm.ToggleThumbUpCommand,
            "ThumbDown" => vm.ToggleThumbDownCommand,
            "OpenImagePreview" => vm.OpenImagePreviewCommand,
            "RenameChat" => vm.RenameChatCommand,
            "DeleteChat" => vm.DeleteChatCommand,
            "BeginEdit" => vm.BeginEditMessageCommand,
            "CancelEdit" => vm.CancelEditMessageCommand,
            "SubmitEdit" => vm.SubmitEditedMessageCommand,
            _ => null
        };
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
