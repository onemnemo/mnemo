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
        bool IsRootTarget,
        FolderDropMode FolderMode);

    private readonly Canvas _overlay;
    private readonly Control _root;
    private readonly Control? _treeSurface;

    private DragSourceKind _sourceKind;
    private string? _sourceId;
    private Control? _sourceControl;
    private Border? _ghost;
    private Rectangle? _insertLine;
    private Border? _folderHighlight;
    private string? _targetFolderId;
    private bool _isRootTarget;
    private FolderDropMode _folderDropMode;
    private Vector _ghostPointerOffset;

    public FlashcardsDragCoordinator(Canvas overlay, Control root, Control? treeSurface = null)
    {
        _overlay = overlay;
        _root = root;
        _treeSurface = treeSurface;
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
        _ghostPointerOffset = MeasureGhostPointerOffset(_ghost, sourceRow);
        CreateIndicators();
        pointer.Capture(_root);
    }

    public void BeginDeckDrag(FlashcardDeckRowViewModel deck, Control sourceCard, IPointer pointer)
    {
        if (IsDragging || string.IsNullOrWhiteSpace(deck.Id))
            return;

        _sourceKind = DragSourceKind.Deck;
        _sourceId = deck.Id;
        _sourceControl = sourceCard;
        sourceCard.Opacity = 0.35;
        _ghost = CreateDeckGhost(deck, sourceCard);
        _overlay.Children.Add(_ghost);
        _ghostPointerOffset = MeasureGhostPointerOffset(_ghost, sourceCard);
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

        var result = new DragDropResult(_sourceKind, _sourceId, _targetFolderId, _isRootTarget, _folderDropMode);
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
        _isRootTarget = false;
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

        // Not over any specific row — hovering the tree surface itself (e.g. the totals footer, or
        // any gap around the rows) moves the dragged item to the root level.
        if (_treeSurface != null)
        {
            var surfaceBounds = GetBoundsInVisual(_treeSurface, _overlay);
            if (surfaceBounds.Contains(pointerOnOverlay))
            {
                _isRootTarget = true;
                var nearTop = pointerOnOverlay.Y - surfaceBounds.Top < surfaceBounds.Height / 2;
                if (nearTop)
                    ShowInsertLine(surfaceBounds.Top, surfaceBounds.Left, surfaceBounds.Width);
                else
                    ShowInsertLine(surfaceBounds.Bottom, surfaceBounds.Left, surfaceBounds.Width);
            }
        }
    }

    private static Rect GetBoundsInVisual(Visual visual, Visual targetVisual)
    {
        var transform = visual.TransformToVisual(targetVisual);
        if (transform == null)
            return new Rect();

        return new Rect(transform.Value.Transform(new Point(0, 0)), visual.Bounds.Size);
    }

    private static Vector MeasureGhostPointerOffset(Border ghost, Control sourceControl)
    {
        ghost.Measure(Size.Infinity);
        var size = ghost.DesiredSize;
        var width = size.Width > 0 ? size.Width : Math.Max(40, sourceControl.Bounds.Width);
        var height = size.Height > 0 ? size.Height : Math.Max(32, sourceControl.Bounds.Height);
        return new Vector(Math.Min(24, width / 2), Math.Min(14, height / 2));
    }

    private void PositionGhost(Point pointerOnOverlay)
    {
        if (_ghost == null)
            return;

        var width = _ghost.Bounds.Width > 0 ? _ghost.Bounds.Width : _ghost.DesiredSize.Width;
        var height = _ghost.Bounds.Height > 0 ? _ghost.Bounds.Height : _ghost.DesiredSize.Height;
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

    private Border CreateFolderGhost(FlashcardFolderItemViewModel folder, FlashcardFolderRow sourceRow) =>
        CreateGhostContainer(folder.Name, folder.DeckCountLabel);

    private Border CreateDeckGhost(FlashcardDeckRowViewModel deck, Control sourceCard) =>
        CreateGhostContainer(deck.Name, deck.CardCountLine);

    private Border CreateGhostContainer(string name, string? subtitle)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center
        };

        content.Children.Add(new AppIcon
        {
            Icon = "Common/grip-vertical",
            Width = 14,
            Height = 14,
            VerticalAlignment = VerticalAlignment.Center,
            Color = ResolveBrushAny("TextFadedBrush", "TextSecondaryBrush")
        });

        content.Children.Add(new TextBlock
        {
            Text = name,
            FontFamily = ResolveFontFamily("Font.Medium"),
            FontSize = ResolveDouble("FontSize.Body.ExtraSmall", 12),
            Foreground = ResolveBrushAny("TextPrimaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis
        });

        if (!string.IsNullOrWhiteSpace(subtitle))
        {
            content.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = ResolveDouble("FontSize.Caption", 11),
                Foreground = ResolveBrushAny("TextFadedBrush"),
                VerticalAlignment = VerticalAlignment.Center
            });
        }

        return new Border
        {
            Child = content,
            Padding = new Thickness(12, 8),
            Background = ResolveBrushAny("OverlayBackgroundBrush"),
            BorderThickness = new Thickness(1),
            BorderBrush = ResolveBrushAny("BorderBrush"),
            BoxShadow = ResolveBoxShadows("Elevation.4", "0 12 28 0 #3D000000"),
            CornerRadius = ResolveCornerRadius("Radius.Md", 8),
            RenderTransform = new RotateTransform(-1.5),
            IsHitTestVisible = false,
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
        _isRootTarget = false;
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

    private FontFamily ResolveFontFamily(string key)
    {
        if (_overlay.TryGetResource(key, Theme, out var value) && value is FontFamily family)
            return family;
        if (Application.Current?.TryGetResource(key, Theme, out value) == true && value is FontFamily appFamily)
            return appFamily;
        return FontFamily.Default;
    }

    private double ResolveDouble(string key, double fallback)
    {
        if (_overlay.TryGetResource(key, Theme, out var value) && value is double d)
            return d;
        if (Application.Current?.TryGetResource(key, Theme, out value) == true && value is double appD)
            return appD;
        return fallback;
    }

    private BoxShadows ResolveBoxShadows(string key, string fallback)
    {
        if (_overlay.TryGetResource(key, Theme, out var value) && value is BoxShadows shadows)
            return shadows;
        if (Application.Current?.TryGetResource(key, Theme, out value) == true && value is BoxShadows appShadows)
            return appShadows;
        return BoxShadows.Parse(fallback);
    }

    private CornerRadius ResolveCornerRadius(string key, double fallback)
    {
        if (_overlay.TryGetResource(key, Theme, out var value) && value is CornerRadius radius)
            return radius;
        if (Application.Current?.TryGetResource(key, Theme, out value) == true && value is CornerRadius appRadius)
            return appRadius;
        return new CornerRadius(fallback);
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
