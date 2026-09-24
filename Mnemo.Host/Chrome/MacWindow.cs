using System;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Mnemo.Core.Services;
using Mnemo.Host.Startup;
using Photino.NET;

namespace Mnemo.Host.Chrome;

/// <summary>
/// The parts of a macOS window that PhotinoX leaves thin: the menu bar, the rounded
/// corners, and an inspectable web view.
/// </summary>
/// <remarks>
/// On macOS the editing shortcuts are key equivalents of menu items, and a key the page
/// does not claim is offered to the main menu. PhotinoX's own menu is a single app menu
/// with Select All, Cut, Copy, Paste and Quit, so there is no Undo or Redo for a plain
/// text field and no Hide. This replaces it with the standard app and Edit menus. The
/// Edit items target the first responder, so the web view answers them the way Safari
/// does. Quit stays on terminate:, which PhotinoX turns into a shutdown request the
/// host holds open for the save.
///
/// A chromeless window is a borderless NSWindow, which macOS draws square with an opaque
/// backing. Clearing the backing and rounding the content layer gives it the corners
/// every other window has.
///
/// Everything here goes through the Objective-C runtime directly, and a failure only
/// costs the feature: it is logged and the window runs on as before.
/// </remarks>
[SupportedOSPlatform("macos")]
internal static class MacWindow
{
    private const string ObjC = "/usr/lib/libobjc.dylib";

    /// <summary>What a titled window uses on current macOS.</summary>
    private const double CornerRadius = 10;

    private const ulong CommandKey = 1UL << 20;
    private const ulong ShiftKey = 1UL << 17;
    private const ulong OptionKey = 1UL << 19;

    public static void Attach(PhotinoWindow window, bool inspectable, ILoggerService? logger)
    {
        // The NSWindow only exists once PhotinoX has created it, on the main thread, and
        // after it has installed its own menu, so the one set here is the one that stays.
        window.RegisterCreatedHandler((sender, _) =>
        {
            if (sender is not PhotinoWindow created)
                return;

            Run("menu bar", InstallMenu, logger);
            Run("window corners", () => RoundCorners(created.WindowHandle), logger);
            if (inspectable)
                Run("web inspector", () => MakeInspectable(created.WindowHandle), logger);
        });
    }

    private static void Run(string what, Action step, ILoggerService? logger)
    {
        try
        {
            step();
        }
        catch (Exception ex)
        {
            logger?.Warning(CrashLog.Category, $"macOS {what} not applied: {ex.Message}");
        }
    }

    private static void InstallMenu()
    {
        var mainMenu = NewMenu("");

        // macOS titles the first menu with the app's name, whatever it is called here.
        var appMenu = NewMenu("Mnemo");
        AddItem(appMenu, "Hide Mnemo", "hide:", "h");
        AddItem(appMenu, "Hide Others", "hideOtherApplications:", "h", CommandKey | OptionKey);
        AddItem(appMenu, "Show All", "unhideAllApplications:", "");
        AddSeparator(appMenu);
        AddItem(appMenu, "Quit Mnemo", "terminate:", "q");
        AddSubmenu(mainMenu, appMenu);

        var editMenu = NewMenu("Edit");
        AddItem(editMenu, "Undo", "undo:", "z");
        AddItem(editMenu, "Redo", "redo:", "z", CommandKey | ShiftKey);
        AddSeparator(editMenu);
        AddItem(editMenu, "Cut", "cut:", "x");
        AddItem(editMenu, "Copy", "copy:", "c");
        AddItem(editMenu, "Paste", "paste:", "v");
        AddItem(editMenu, "Select All", "selectAll:", "a");
        AddSubmenu(mainMenu, editMenu);

        var app = Send(Class("NSApplication"), Sel("sharedApplication"));
        Send(app, Sel("setMainMenu:"), mainMenu);
    }

    private static void RoundCorners(IntPtr window)
    {
        if (window == IntPtr.Zero)
            return;

        Send(window, Sel("setOpaque:"), false);
        Send(window, Sel("setBackgroundColor:"), Send(Class("NSColor"), Sel("clearColor")));

        var content = Send(window, Sel("contentView"));
        Send(content, Sel("setWantsLayer:"), true);
        var layer = Send(content, Sel("layer"));
        SendDouble(layer, Sel("setCornerRadius:"), CornerRadius);
        Send(layer, Sel("setMasksToBounds:"), true);

        // Traced from the window's opaque pixels when it is shown, so it follows the corners.
        Send(window, Sel("setHasShadow:"), true);
    }

    private static void MakeInspectable(IntPtr window)
    {
        if (window == IntPtr.Zero)
            return;

        var webView = FindView(Send(window, Sel("contentView")), Class("WKWebView"));
        // isInspectable only exists from macOS 13.3; before that the developer extras
        // preference PhotinoX sets is enough on its own.
        if (webView != IntPtr.Zero && SendBool(webView, Sel("respondsToSelector:"), Sel("setInspectable:")))
            Send(webView, Sel("setInspectable:"), true);
    }

    private static IntPtr FindView(IntPtr view, IntPtr cls)
    {
        if (view == IntPtr.Zero || cls == IntPtr.Zero)
            return IntPtr.Zero;
        if (SendBool(view, Sel("isKindOfClass:"), cls))
            return view;

        var subviews = Send(view, Sel("subviews"));
        var count = SendCount(subviews, Sel("count"));
        for (nuint i = 0; i < count; i++)
        {
            var found = FindView(SendIndex(subviews, Sel("objectAtIndex:"), i), cls);
            if (found != IntPtr.Zero)
                return found;
        }

        return IntPtr.Zero;
    }

    private static IntPtr NewMenu(string title) =>
        Send(Send(Class("NSMenu"), Sel("alloc")), Sel("initWithTitle:"), NewString(title));

    private static void AddItem(IntPtr menu, string title, string action, string key, ulong modifiers = CommandKey)
    {
        var item = Send(
            Send(Class("NSMenuItem"), Sel("alloc")),
            Sel("initWithTitle:action:keyEquivalent:"),
            NewString(title),
            Sel(action),
            NewString(key));
        SendMask(item, Sel("setKeyEquivalentModifierMask:"), modifiers);
        Send(menu, Sel("addItem:"), item);
    }

    private static void AddSeparator(IntPtr menu) =>
        Send(menu, Sel("addItem:"), Send(Class("NSMenuItem"), Sel("separatorItem")));

    private static void AddSubmenu(IntPtr mainMenu, IntPtr submenu)
    {
        var holder = Send(Send(Class("NSMenuItem"), Sel("alloc")), Sel("init"));
        Send(holder, Sel("setSubmenu:"), submenu);
        Send(mainMenu, Sel("addItem:"), holder);
    }

    /// <summary>An owned NSString, so nothing depends on an autorelease pool being in place.</summary>
    private static IntPtr NewString(string value) =>
        SendUtf8(Send(Class("NSString"), Sel("alloc")), Sel("initWithUTF8String:"), value);

    private static IntPtr Class(string name) => objc_getClass(name);

    private static IntPtr Sel(string name) => sel_registerName(name);

    [DllImport(ObjC)]
    private static extern IntPtr objc_getClass(string name);

    [DllImport(ObjC)]
    private static extern IntPtr sel_registerName(string name);

    // One binding per shape. On arm64 objc_msgSend must be called with the exact
    // argument types the method takes, so none of these can be folded into another.

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector, IntPtr arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector, IntPtr arg1, IntPtr arg2, IntPtr arg3);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void Send(IntPtr receiver, IntPtr selector, [MarshalAs(UnmanagedType.I1)] bool arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void SendDouble(IntPtr receiver, IntPtr selector, double arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void SendMask(IntPtr receiver, IntPtr selector, ulong arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr SendUtf8(IntPtr receiver, IntPtr selector, [MarshalAs(UnmanagedType.LPUTF8Str)] string arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool SendBool(IntPtr receiver, IntPtr selector, IntPtr arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern nuint SendCount(IntPtr receiver, IntPtr selector);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr SendIndex(IntPtr receiver, IntPtr selector, nuint index);
}
