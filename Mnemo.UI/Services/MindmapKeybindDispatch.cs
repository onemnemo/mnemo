using System.Diagnostics.CodeAnalysis;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Services;

public sealed class MindmapKeybindDispatch(INavigationService navigation) : IMindmapKeybindDispatch
{
    private bool TryGetMindmapViewModel([NotNullWhen(true)] out MindmapViewModel? vm)
    {
        vm = navigation.CurrentViewModel as MindmapViewModel;
        return vm != null;
    }

    public void Recenter()
    {
        if (!TryGetMindmapViewModel(out var vm)) return;
        vm.RecenterCommand.Execute(null);
    }

    public void Undo()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.UndoAsync();
    }

    public void Redo()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.RedoAsync();
    }

    public void ClearSelection()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        vm.ClearSelection();
    }

    public void DeleteSelection()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        if (vm.DeleteSelectedCommand.CanExecute(null))
            vm.DeleteSelectedCommand.Execute(null);
    }

    public void Copy()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        vm.CopySelection();
    }

    public void Paste()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.PasteAsync();
    }

    public void Duplicate()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.DuplicateSelectionAsync();
    }

    public void AddChild()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.AddChildNodeAsync();
    }

    public void Enter()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        if (vm.SelectedEdge == null)
            _ = vm.AddSiblingNodeAsync();
        else
            vm.BeginEditSelectedEdgeLabel();
    }

    public void EditLabel()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        // A selected edge edits its label; otherwise fall back to the selected element's label.
        if (vm.SelectedEdge != null)
            vm.BeginEditSelectedEdgeLabel();
        else if (vm.SelectedNode != null)
            vm.BeginEditElement(vm.SelectedNode);
    }

    public void ToggleConnect()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        vm.ToggleConnectTool();
    }

    public void NewNode()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.CreateNodeAtCursorAsync();
    }

    public void NewText()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.CreateTextAtCursorAsync();
    }

    public void NewFrame()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.CreateFrameAtCursorAsync();
    }

    public void NewShape()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        _ = vm.CreateDefaultShapeAtCursorAsync();
    }

    public void OpenRadial()
    {
        if (!TryGetMindmapViewModel(out var vm) || !vm.IsEditingEnabled) return;
        vm.OpenRadial();
    }
}
