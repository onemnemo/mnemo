using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Views;

public partial class NotesView
{
    private Window? _attachedWindow;

    private void WireKeybindHandlers()
    {
        _attachedWindow = this.GetVisualAncestors().OfType<Window>().FirstOrDefault();
        if (_attachedWindow == null) return;
        _attachedWindow.AddHandler(InputElement.KeyDownEvent, OnWindowKeyDownTunnel, RoutingStrategies.Tunnel);
        _attachedWindow.KeyDown += OnWindowKeyDown;
        _attachedWindow.Deactivated += OnWindowDeactivated;
    }

    private void TeardownKeybindHandlers()
    {
        if (_attachedWindow == null) return;
        _attachedWindow.RemoveHandler(InputElement.KeyDownEvent, OnWindowKeyDownTunnel);
        _attachedWindow.KeyDown -= OnWindowKeyDown;
        _attachedWindow.Deactivated -= OnWindowDeactivated;
        _attachedWindow = null;
    }

    private void OnWindowKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && _editorScrollPanning)
        {
            EndEditorScrollPanIfNeeded();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.Escape && _dragCoordinator?.IsDragging == true)
        {
            _dragCoordinator.CancelDrag();
            e.Handled = true;
            return;
        }

        if (e.Handled || !IsKeyboardFocusWithinNotesView())
            return;

        if (IsPrimaryShortcut(e, Key.N) && DataContext is NotesViewModel vm)
        {
            e.Handled = true;
            _ = vm.NewNoteCommand.ExecuteAsync(null);
            return;
        }

        if (IsPrimaryShortcut(e, Key.P))
        {
            e.Handled = true;
            FocusNotesSearch();
        }
    }

    private void OnWindowKeyDownTunnel(object? sender, KeyEventArgs e)
    {
        if (e.Handled) return;
        if (DataContext is not NotesViewModel { SelectedNote: not null }) return;
        if (!IsKeyboardFocusWithinNotesView()) return;

        if (TryHandleDocumentViewShortcut(e))
            return;

        if (ShouldDeferDocumentUndoRedoToTextInput())
            return;

        var editor = GetBlockEditor();
        if (editor == null) return;

        if (IsPrimaryShortcut(e, Key.Z) && !e.KeyModifiers.HasFlag(KeyModifiers.Shift))
        {
            e.Handled = true;
            _ = editor.UndoAsync();
            return;
        }

        if (IsPrimaryShortcut(e, Key.Y)
            || (IsPrimaryShortcut(e, Key.Z) && e.KeyModifiers.HasFlag(KeyModifiers.Shift)))
        {
            e.Handled = true;
            _ = editor.RedoAsync();
        }
    }

    private bool TryHandleDocumentViewShortcut(KeyEventArgs e)
    {
        if (!IsPrimaryShortcut(e, Key.D0) && !IsPrimaryShortcut(e, Key.NumPad0))
            return false;

        ResetEditorView();
        e.Handled = true;
        return true;
    }

    private bool IsKeyboardFocusWithinNotesView()
    {
        var focused = TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement();
        if (focused == null)
            return true;
        if (ReferenceEquals(focused, this))
            return true;
        return focused is Visual visual
            && (ReferenceEquals(visual, this) || visual.GetVisualAncestors().Any(a => ReferenceEquals(a, this)));
    }

    private bool ShouldDeferDocumentUndoRedoToTextInput()
    {
        var focused = TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() as Visual;
        return focused is TextBox || focused?.GetVisualAncestors().Any(a => a is TextBox) == true;
    }

    private static bool IsPrimaryShortcut(KeyEventArgs e, Key key)
    {
        if (e.Key != key) return false;
        if (e.KeyModifiers.HasFlag(KeyModifiers.Alt)) return false;

        var primary = OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;
        return e.KeyModifiers.HasFlag(primary);
    }

    private void OnWindowDeactivated(object? sender, EventArgs e)
    {
        _dragCoordinator?.CancelDrag();
        EndEditorScrollPanIfNeeded();
    }
}
