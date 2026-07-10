namespace Mnemo.UI.Services;

/// <summary>Executes mindmap canvas keybind actions for the active mindmap detail view model.</summary>
public interface IMindmapKeybindDispatch
{
    void Recenter();
    void Undo();
    void Redo();
    void ClearSelection();
    void DeleteSelection();
    void Copy();
    void Paste();
    void Duplicate();
    void AddChild();
    void Enter();
    void EditLabel();
    void SelectTool();
    void PanTool();
    void ToggleConnect();
    void NewNode();
    void NewText();
    void NewFrame();
    void NewShape();
    void OpenRadial();
}
