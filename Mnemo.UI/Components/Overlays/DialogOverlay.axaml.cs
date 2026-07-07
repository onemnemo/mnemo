using System;
using System.Windows.Input;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Markup.Xaml;
using CommunityToolkit.Mvvm.Input;

namespace Mnemo.UI.Components.Overlays
{
    /// <summary>Which control the user used to dismiss a <see cref="DialogOverlay"/>.</summary>
    public enum DialogButton
    {
        Primary,
        Secondary,
        Dismiss
    }

    /// <summary>Outcome of a <see cref="DialogOverlay"/>: the button pressed plus the input text (input mode only).</summary>
    public sealed record DialogChoice(DialogButton Button, string? Input);

    /// <summary>
    /// The single reusable dialog for the app. Runs in two modes:
    /// <list type="bullet">
    ///   <item>Action — title, description, and confirm/cancel buttons (deletes, exits, confirmations).</item>
    ///   <item>Input — adds a text field; the primary button returns its value (create/rename flows).</item>
    /// </list>
    /// Prefer <see cref="Mnemo.Core.Services.IOverlayService.CreateDialogAsync"/> /
    /// <c>CreateInputDialogAsync</c> over constructing this directly.
    /// </summary>
    public partial class DialogOverlay : UserControl
    {
        public static readonly StyledProperty<string?> TitleProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(Title));
        public static readonly StyledProperty<string?> DescriptionProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(Description));
        public static readonly StyledProperty<string?> PrimaryTextProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(PrimaryText));
        public static readonly StyledProperty<string?> SecondaryTextProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(SecondaryText));
        public static readonly StyledProperty<string?> PrimaryIconProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(PrimaryIcon));
        public static readonly StyledProperty<bool> IsDestructiveProperty = AvaloniaProperty.Register<DialogOverlay, bool>(nameof(IsDestructive));
        public static readonly StyledProperty<bool> ShowInputProperty = AvaloniaProperty.Register<DialogOverlay, bool>(nameof(ShowInput));
        public static readonly StyledProperty<string?> PlaceholderProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(Placeholder));
        public static readonly StyledProperty<string?> InputValueProperty = AvaloniaProperty.Register<DialogOverlay, string?>(nameof(InputValue));

        public string? Title { get => GetValue(TitleProperty); set => SetValue(TitleProperty, value); }
        public string? Description { get => GetValue(DescriptionProperty); set => SetValue(DescriptionProperty, value); }
        public string? PrimaryText { get => GetValue(PrimaryTextProperty); set => SetValue(PrimaryTextProperty, value); }
        public string? SecondaryText { get => GetValue(SecondaryTextProperty); set => SetValue(SecondaryTextProperty, value); }

        /// <summary>Optional leading icon on the primary button, resolved like <c>AppIcon.Icon</c> (e.g. "Common/plus").</summary>
        public string? PrimaryIcon { get => GetValue(PrimaryIconProperty); set => SetValue(PrimaryIconProperty, value); }

        /// <summary>Renders the primary button red; reserved for irreversible confirms (delete, clear).</summary>
        public bool IsDestructive { get => GetValue(IsDestructiveProperty); set => SetValue(IsDestructiveProperty, value); }

        /// <summary>When true, shows a text field between the description and the buttons (input mode).</summary>
        public bool ShowInput { get => GetValue(ShowInputProperty); set => SetValue(ShowInputProperty, value); }
        public string? Placeholder { get => GetValue(PlaceholderProperty); set => SetValue(PlaceholderProperty, value); }
        public string? InputValue { get => GetValue(InputValueProperty); set => SetValue(InputValueProperty, value); }

        public ICommand PrimaryCommand { get; }
        public ICommand SecondaryCommand { get; }
        public ICommand CloseCommand { get; }

        /// <summary>Invoked once when the dialog is dismissed, with the button used and (in input mode) the entered text.</summary>
        public Action<DialogChoice>? OnClosed { get; set; }

        public DialogOverlay()
        {
            PrimaryCommand = new RelayCommand(OnPrimary);
            SecondaryCommand = new RelayCommand(OnSecondary);
            CloseCommand = new RelayCommand(OnClose);
            InitializeComponent();
            DataContext = this;
        }

        private void InitializeComponent()
        {
            AvaloniaXamlLoader.Load(this);

            // In input mode, focus and select the field so the user can type or overwrite immediately.
            var textBox = this.FindControl<TextBox>("InputTextBox");
            if (textBox != null)
            {
                textBox.AttachedToVisualTree += (_, _) =>
                {
                    if (!ShowInput)
                        return;
                    textBox.Focus();
                    textBox.SelectAll();
                };
                // Enter confirms the input dialog, mirroring the primary button.
                textBox.KeyDown += (_, e) =>
                {
                    if (e.Key == Key.Enter)
                    {
                        e.Handled = true;
                        OnPrimary();
                    }
                };
            }
        }

        private void OnPrimary() => OnClosed?.Invoke(new DialogChoice(DialogButton.Primary, InputValue));

        private void OnSecondary() => OnClosed?.Invoke(new DialogChoice(DialogButton.Secondary, null));

        private void OnClose() => OnClosed?.Invoke(new DialogChoice(DialogButton.Dismiss, null));
    }
}
