using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.VisualTree;
using Mnemo.UI.Controls;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

public sealed class FlashcardsDragCoordinator : IDisposable
{
    public enum DragSourceKind
    {
        None = 0,
        Folder = 1,
        Deck = 2
    }

    public enum FolderDropMode
    {
        None = 0,
        InsertAbove = 1,
        InsertBelow = 2,
        DropIntoFolder = 3
    }

    public readonly record struct DragDropResult(
        DragSourceKind SourceKind,
        string SourceId,
        string? TargetFolderId,
        FolderDropMode FolderMode);

    private readonly Canvas _overlay;
    private readonly Control _root;

    private DragSourceKind _sourceKind;
    private string? _sourceId;
    private Control? _sourceControl;
    private Border? _ghost;
    private Rectangle? _insertLine;
    private Border? _folderHighlight;
    private string? _targetFolderId;
    private FolderDropMode _folderDropMode;
    private Vector _ghostPointerOffset;

    public FlashcardsDragCoordinator(Canvas overlay, Control root)
    {
        _overlay = overlay;
        _root = root;
    }

    public bool IsDragging => _sourceKind != DragSourceKind.None;

    public void BeginFolderDrag(FlashcardFolderItemViewModel folder, FlashcardFolderRow sourceRow, IPointer pointer)
    {
        if (IsDragging || string.IsNullOrWhiteSpace(folder.Id))
            return;

        _sourceKind = DragSourceKind.Folder;
        _sourceId = folder.Id;
        _sourceControl = sourceRow;
        sourceRow.Opacity = 0.35;
        _ghost = CreateFolderGhost(folder, sourceRow);
        _overlay.Children.Add(_ghost);
        var folderGhostHeight = _ghost.Bounds.Height > 0 ? _ghost.Bounds.Height : Math.Max(32, sourceRow.Bounds.Height);
        _ghostPointerOffset = new Vector((_ghost.Width / 2), Math.Min(14, folderGhostHeight / 2));
        CreateIndicators();
        pointer.Capture(_root);
    }

    public void BeginDeckDrag(FlashcardDeckRowViewModel deck, Border sourceCard, IPointer pointer)
    {
        if (IsDragging || string.IsNullOrWhiteSpace(deck.Id))
            return;

        _sourceKind = DragSourceKind.Deck;
        _sourceId = deck.Id;
        _sourceControl = sourceCard;
        sourceCard.Opacity = 0.35;
        _ghost = CreateDeckGhost(deck, sourceCard);
        _overlay.Children.Add(_ghost);
        var deckGhostHeight = _ghost.Bounds.Height > 0 ? _ghost.Bounds.Height : Math.Max(40, sourceCard.Bounds.Height);
        _ghostPointerOffset = new Vector((_ghost.Width / 2), Math.Min(14, deckGhostHeight / 2));
        CreateIndicators();
        pointer.Capture(_root);
    }

    public void OnPointerMoved(PointerEventArgs e)
    {
        if (!IsDragging || _ghost == null)
            return;

        PositionGhost(e.GetPosition(_overlay));
        ResolveDropTarget(e.GetPosition(_overlay));
    }

    public DragDropResult? CompleteDrag(IPointer? pointer = null)
    {
        if (!IsDragging || string.IsNullOrWhiteSpace(_sourceId))
        {
            Cleanup(pointer);
            return null;
        }

        var result = new DragDropResult(_sourceKind, _sourceId, _targetFolderId, _folderDropMode);
        Cleanup(pointer);
        return result;
    }

    public void CancelDrag(IPointer? pointer = null)
    {
        Cleanup(pointer);
    }

    private void ResolveDropTarget(Point pointerOnOverlay)
    {
        _targetFolderId = null;
        _folderDropMode = FolderDropMode.None;
        HideIndicators();

        var rows = CollectVisibleFolderRows();
        foreach (var row in rows)
        {
            if (row.DataContext is not FlashcardFolderItemViewModel folder)
                continue;
            if (_sourceKind == DragSourceKind.Folder && string.Equals(folder.Id, _sourceId, StringComparison.Ordinal))
                continue;

            var rowBounds = row.GetBoundsInVisual(_overlay);
            if (!rowBounds.Contains(pointerOnOverlay))
                continue;

            _targetFolderId = folder.Id;

            if (_sourceKind == DragSourceKind.Deck)
            {
                _folderDropMode = FolderDropMode.DropIntoFolder;
                ShowFolderHighlight(rowBounds);
                return;
            }

            var rowHeight = Math.Max(rowBounds.Height, 1.0);
            var relative = (pointerOnOverlay.Y - rowBounds.Top) / rowHeight;
            if (relative < 0.25)
            {
                _folderDropMode = FolderDropMode.InsertAbove;
                ShowInsertLine(rowBounds.Top, rowBounds.Left, rowBounds.Width);
            }
            else if (relative > 0.75)
            {
                _folderDropMode = FolderDropMode.InsertBelow;
                ShowInsertLine(rowBounds.Bottom, rowBounds.Left, rowBounds.Width);
            }
            else
            {
                _folderDropMode = FolderDropMode.DropIntoFolder;
                ShowFolderHighlight(rowBounds);
            }

            return;
        }
    }

    private void PositionGhost(Point pointerOnOverlay)
    {
        if (_ghost == null)
            return;

        var width = _ghost.Bounds.Width > 0 ? _ghost.Bounds.Width : _ghost.Width;
        var height = _ghost.Bounds.Height > 0 ? _ghost.Bounds.Height : 40;
        var left = pointerOnOverlay.X - _ghostPointerOffset.X;
        var top = pointerOnOverlay.Y - _ghostPointerOffset.Y;
        left = Math.Clamp(left, 0, Math.Max(0, _overlay.Bounds.Width - width));
        top = Math.Clamp(top, 0, Math.Max(0, _overlay.Bounds.Height - height));
        Canvas.SetLeft(_ghost, left);
        Canvas.SetTop(_ghost, top);
    }

    private void CreateIndicators()
    {
        _insertLine = new Rectangle
        {
            Height = 2,
            Fill = ResolveBrush("AccentBrush"),
            IsVisible = false,
            IsHitTestVisible = false,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top
        };
        _overlay.Children.Add(_insertLine);

        var accent = TryResolveAccentColor();
        _folderHighlight = new Border
        {
            BorderThickness = new Thickness(1),
            BorderBrush = ResolveBrush("AccentBrush"),
            Background = new SolidColorBrush(Color.FromArgb(40, accent.R, accent.G, accent.B)),
            IsVisible = false,
            IsHitTestVisible = false
        };
        _overlay.Children.Add(_folderHighlight);
    }

    private void ShowInsertLine(double y, double x, double width)
    {
        if (_insertLine == null)
            return;

        Canvas.SetTop(_insertLine, y - 1);
        Canvas.SetLeft(_insertLine, x);
        _insertLine.Width = Math.Max(width, 20);
        _insertLine.IsVisible = true;
        if (_folderHighlight != null)
            _folderHighlight.IsVisible = false;
    }

    private void ShowFolderHighlight(Rect rowBounds)
    {
        if (_folderHighlight == null)
            return;

        Canvas.SetLeft(_folderHighlight, rowBounds.Left);
        Canvas.SetTop(_folderHighlight, rowBounds.Top);
        _folderHighlight.Width = Math.Max(rowBounds.Width, 20);
        _folderHighlight.Height = Math.Max(rowBounds.Height, 4);
        _folderHighlight.IsVisible = true;
        if (_insertLine != null)
            _insertLine.IsVisible = false;
    }

    private void HideIndicators()
    {
        if (_insertLine != null)
            _insertLine.IsVisible = false;
        if (_folderHighlight != null)
            _folderHighlight.IsVisible = false;
    }

    private Border CreateFolderGhost(FlashcardFolderItemViewModel folder, FlashcardFolderRow sourceRow)
    {
        var row = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("Auto,*"),
            ColumnSpacing = 8,
            MinWidth = 180
        };

        row.Children.Add(new SvgIcon
        {
            SvgPath = "avares://Mnemo.UI/Icons/Common/folder.svg",
            Width = 18,
            Height = 18,
            VerticalAlignment = VerticalAlignment.Center,
            Color = ResolveBrushAny("TextSecondaryBrush", "TextPrimaryBrush")
        });

        row.Children.Add(new TextBlock
        {
            Text = folder.Name,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        Grid.SetColumn(row.Children[1], 1);

        return CreateGhostContainer(row, sourceRow.Bounds.Width > 0 ? sourceRow.Bounds.Width : 220);
    }

    private Border CreateDeckGhost(FlashcardDeckRowViewModel deck, Border sourceCard)
    {
        var row = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("Auto,*"),
            ColumnSpacing = 8,
            MinWidth = 240
        };

        row.Children.Add(new SvgIcon
        {
            SvgPath = "avares://Mnemo.UI/Icons/Common/file-text.svg",
            Width = 18,
            Height = 18,
            VerticalAlignment = VerticalAlignment.Center,
            Color = ResolveBrushAny("TextSecondaryBrush", "TextPrimaryBrush")
        });

        row.Children.Add(new TextBlock
        {
            Text = deck.Name,
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = FontFamily.Parse("Inter SemiBold"),
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        Grid.SetColumn(row.Children[1], 1);

        return CreateGhostContainer(row, sourceCard.Bounds.Width > 0 ? sourceCard.Bounds.Width : 280);
    }

    private Border CreateGhostContainer(Control content, double width)
    {
        return new Border
        {
            Child = content,
            Padding = new Thickness(10, 8),
            Background = ResolveBrushAny("TreeViewItemBackgroundPointerOver", "CardBackgroundSecondaryBrush"),
            BorderThickness = new Thickness(1),
            BorderBrush = ResolveBrushAny("TreeViewItemBorderBrushPointerOver", "BorderBrush"),
            BoxShadow = BoxShadows.Parse("0 4 16 0 #40000000"),
            CornerRadius = new CornerRadius(8),
            IsHitTestVisible = false,
            Opacity = 0.95,
            Width = width,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top
        };
    }

    private List<FlashcardFolderRow> CollectVisibleFolderRows()
    {
        var result = new List<FlashcardFolderRow>();
        CollectRowsRecursive(_root, result);
        return result;
    }

    private static void CollectRowsRecursive(Visual visual, List<FlashcardFolderRow> result)
    {
        if (visual is FlashcardFolderRow row)
        {
            result.Add(row);
            return;
        }

        foreach (var child in visual.GetVisualChildren())
            CollectRowsRecursive(child, result);
    }

    private void Cleanup(IPointer? pointer)
    {
        if (_sourceControl != null)
        {
            _sourceControl.Opacity = 1.0;
            _sourceControl = null;
        }

        if (_ghost != null)
            _overlay.Children.Remove(_ghost);
        if (_insertLine != null)
            _overlay.Children.Remove(_insertLine);
        if (_folderHighlight != null)
            _overlay.Children.Remove(_folderHighlight);

        _ghost = null;
        _insertLine = null;
        _folderHighlight = null;
        _targetFolderId = null;
        _folderDropMode = FolderDropMode.None;
        _sourceKind = DragSourceKind.None;
        _sourceId = null;
        _ghostPointerOffset = default;
        pointer?.Capture(null);
    }

    private void Cleanup()
    {
        Cleanup(null);
    }

    private ThemeVariant Theme => _overlay.ActualThemeVariant;

    private IBrush ResolveBrush(string key)
    {
        if (_overlay.TryGetResource(key, Theme, out var value) && value is IBrush brush)
            return brush;
        if (Application.Current?.TryGetResource(key, Theme, out value) == true && value is IBrush appBrush)
            return appBrush;
        return Brushes.DodgerBlue;
    }

    private IBrush ResolveBrushAny(params string[] keys)
    {
        foreach (var key in keys)
        {
            if (_overlay.TryGetResource(key, Theme, out var value) && value is IBrush brush)
                return brush;
            if (Application.Current?.TryGetResource(key, Theme, out value) == true && value is IBrush appBrush)
                return appBrush;
        }

        return Brushes.Gray;
    }

    private Color TryResolveAccentColor()
    {
        if (_overlay.TryGetResource("Accent", Theme, out var value))
        {
            if (value is Color color)
                return color;
            if (value is SolidColorBrush brush)
                return brush.Color;
        }

        if (Application.Current?.TryGetResource("Accent", Theme, out value) == true)
        {
            if (value is Color color)
                return color;
            if (value is SolidColorBrush brush)
                return brush.Color;
        }

        return Color.FromRgb(0x4C, 0x8B, 0xF5);
    }

    public void Dispose()
    {
        Cleanup();
    }
}
