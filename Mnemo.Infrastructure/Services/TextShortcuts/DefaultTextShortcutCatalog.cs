using System;
using System.Collections.Generic;
using Mnemo.Core.Models.TextShortcuts;

namespace Mnemo.Infrastructure.Services.TextShortcuts;

/// <summary>
/// Built-in catalog of text shortcuts applied by <see cref="TextShortcutService"/>.
/// Adding a new shortcut is a one-liner; priorities are rarely needed because longer sequences
/// are evaluated before shorter ones automatically.
/// </summary>
/// <remarks>
/// Guidelines for adding entries:
/// <list type="bullet">
///   <item>Prefer pure-ASCII triggers so they survive any input method.</item>
///   <item>When a replacement can itself form a new trigger (e.g. typing <c>&lt;</c> before an existing
///   <c>→</c>), register the "upgrade" forms alongside the primary sequence so cascading works.</item>
///   <item>Avoid triggers that collide with common code / markup syntax unless notes is the intended scope.</item>
/// </list>
/// </remarks>
internal static class DefaultTextShortcutCatalog
{
    public static IReadOnlyList<TextShortcut> CreateShortcuts()
    {
        return new List<TextShortcut>
        {
            // Typography and legal symbols
            // Keep divider markdown ("---") usable: only convert double hyphen after a trailing space.
            new TextShortcut("-- ", "\u2013 "), // en dash
            new TextShortcut("...", "\u2026"), // …
            new TextShortcut("(c)",  "\u00A9"), // ©
            new TextShortcut("(r)",  "\u00AE"), // ®
            new TextShortcut("(tm)", "\u2122"), // ™

            // Common arrows and upgrade helpers
            new TextShortcut("->",  "\u2192"), // →
            new TextShortcut("<-",  "\u2190"), // ←
            new TextShortcut("<->", "\u2194"), // ↔
            new TextShortcut("<\u2192", "\u2194"), // <→ -> ↔
            new TextShortcut("\u2190>", "\u2194"), // ←> -> ↔
            new TextShortcut("\u2264=", "\u21D0"), // ≤= -> ⇐
            new TextShortcut("\u2264>", "\u21D4"), // ≤> -> ⇔
            new TextShortcut("<\u21D2", "\u21D4"), // <⇒ -> ⇔
            new TextShortcut("\u21D0>", "\u21D4"), // ⇐> -> ⇔

            // Explicit \keyword triggers: math & symbols
            new TextShortcut("\\sqrt",  "\u221A"), // √
            new TextShortcut("\\inf",   "\u221E"), // ∞
            new TextShortcut("\\tilde", "\u02DC"), // ˜
            new TextShortcut("\\sum",   "\u2211"), // ∑
            new TextShortcut("\\prod",  "\u220F"), // ∏
            new TextShortcut("\\int",   "\u222B"), // ∫
            new TextShortcut("\\pi",    "\u03C0"), // π
            new TextShortcut("\\deg",   "\u00B0"), // °
            new TextShortcut("\\pm",    "\u00B1"), // ±

            // Explicit \keyword triggers: currency
            new TextShortcut("\\EUR", "\u20AC"), // €
            new TextShortcut("\\GBP", "\u00A3"), // £
            new TextShortcut("\\USD", "$"),
            new TextShortcut("\\JPY", "\u00A5"), // ¥

            // Explicit \keyword triggers: logic & math comparisons
            new TextShortcut("\\neq",     "\u2260"), // ≠
            new TextShortcut("\\leq",     "\u2264"), // ≤
            new TextShortcut("\\geq",     "\u2265"), // ≥
            new TextShortcut("\\approx",  "\u2248"), // ≈
            new TextShortcut("\\implies", "\u21D2"), // ⇒
            new TextShortcut("\\iff",     "\u21D4")  // ⇔
        };
    }
}
