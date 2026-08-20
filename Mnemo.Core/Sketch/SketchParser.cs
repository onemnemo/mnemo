using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Mnemo.Core.Sketch;

public sealed class SketchParser
{
    private readonly IReadOnlyList<SketchToken> _tokens;
    private readonly List<SketchDiagnostic> _diagnostics;
    private readonly List<RawSketchStatement> _statements = new();
    private int _position;

    public SketchParser(IReadOnlyList<SketchToken> tokens, IEnumerable<SketchDiagnostic>? diagnostics = null)
    {
        _tokens = tokens;
        _diagnostics = diagnostics?.ToList() ?? new List<SketchDiagnostic>();
    }

    public SketchParseResult Parse()
    {
        while (!Check(SketchTokenKind.EndOfFile))
        {
            SkipNewlines();
            if (Check(SketchTokenKind.EndOfFile))
                break;

            var statement = ParseStatement();
            if (statement != null)
                _statements.Add(statement);

            SynchronizeToNextLine();
        }

        var span = _tokens.Count > 0
            ? new SourceSpan(_tokens[0].Span.Start, _tokens[^1].Span.End)
            : new SourceSpan(new SourcePosition(0, 1, 1), new SourcePosition(0, 1, 1));
        return new SketchParseResult(new RawSketchAst(_statements, span), _tokens, _diagnostics);
    }

    private RawSketchStatement? ParseStatement()
    {
        if (Match(SketchTokenKind.Comment, out var comment))
            return new RawSketchComment(comment.Value, comment.Span);

        if (TryParseMetaBlock(out var metaBlock))
            return metaBlock;

        if (TryParseClassStatement(out var classDecl))
            return classDecl;

        if (TryParseGroupStatement(out var groupDecl))
            return groupDecl;

        if (TryParseIgnoredBlockStatement(out var ignored))
            return ignored;

        var nodeRef = ParseNodeRef();
        if (nodeRef == null)
        {
            AddError("SKETCH_PARSE_EXPECTED_STATEMENT", "Expected a node or edge statement.", Current.Span);
            Advance();
            return null;
        }

        if (TryMatchArrow(out var direction))
            return ParseEdge(nodeRef, direction);

        string? label = null;
        SourceSpan span = nodeRef.Span;
        if (Match(SketchTokenKind.String, out var labelToken))
        {
            label = labelToken.Value;
            span = new SourceSpan(nodeRef.Span.Start, labelToken.Span.End);
        }

        var properties = Array.Empty<RawSketchProperty>();
        if (Check(SketchTokenKind.LeftBrace))
        {
            var block = ParsePropertyBlock();
            properties = block.Properties.ToArray();
            span = new SourceSpan(nodeRef.Span.Start, block.End);
        }

        return new RawSketchNodeDecl(nodeRef, label, properties, span);
    }

    private bool TryParseMetaBlock(out RawSketchMetaBlock? statement)
    {
        statement = null;
        if (!Match(SketchTokenKind.KeywordSketch, out var sketchToken))
            return false;

        if (!Check(SketchTokenKind.LeftBrace))
        {
            AddError("SKETCH_PARSE_EXPECTED_META_BLOCK", "Expected a property block after 'sketch'.", Current.Span);
            statement = new RawSketchMetaBlock(Array.Empty<RawSketchProperty>(), sketchToken.Span);
            return true;
        }

        var block = ParsePropertyBlock();
        statement = new RawSketchMetaBlock(block.Properties, new SourceSpan(sketchToken.Span.Start, block.End));
        return true;
    }

    private bool TryParseClassStatement(out RawSketchClassDecl? statement)
    {
        statement = null;
        if (!Match(SketchTokenKind.KeywordClass, out var classToken))
            return false;

        if (!Match(SketchTokenKind.Identifier, out var nameToken))
        {
            AddError("SKETCH_PARSE_EXPECTED_CLASS_NAME", "Expected a class name after 'class'.", Current.Span);
            statement = new RawSketchClassDecl(string.Empty, Array.Empty<RawSketchProperty>(), classToken.Span);
            return true;
        }

        if (!Check(SketchTokenKind.LeftBrace))
        {
            AddError("SKETCH_PARSE_EXPECTED_CLASS_BLOCK", "Expected a property block after class name.", Current.Span);
            statement = new RawSketchClassDecl(nameToken.Value, Array.Empty<RawSketchProperty>(), new SourceSpan(classToken.Span.Start, nameToken.Span.End));
            return true;
        }

        var block = ParsePropertyBlock();
        statement = new RawSketchClassDecl(nameToken.Value, block.Properties, new SourceSpan(classToken.Span.Start, block.End));
        return true;
    }

    private bool TryParseGroupStatement(out RawSketchGroupDecl? statement)
    {
        statement = null;
        if (!Match(SketchTokenKind.KeywordGroup, out var groupToken))
            return false;

        if (!Match(SketchTokenKind.Identifier, out var nameToken))
        {
            AddError("SKETCH_PARSE_EXPECTED_GROUP_NAME", "Expected a group name after 'group'.", Current.Span);
            statement = new RawSketchGroupDecl(string.Empty, null, Array.Empty<RawSketchProperty>(), Array.Empty<RawSketchNodeRef>(), groupToken.Span);
            return true;
        }

        string? label = null;
        if (Match(SketchTokenKind.String, out var labelToken))
            label = labelToken.Value;

        if (!Check(SketchTokenKind.LeftBrace))
        {
            AddError("SKETCH_PARSE_EXPECTED_GROUP_BLOCK", "Expected '{' after group name.", Current.Span);
            statement = new RawSketchGroupDecl(nameToken.Value, label, Array.Empty<RawSketchProperty>(), Array.Empty<RawSketchNodeRef>(), new SourceSpan(groupToken.Span.Start, nameToken.Span.End));
            return true;
        }

        var (properties, memberRefs, end) = ParseGroupBody();
        statement = new RawSketchGroupDecl(nameToken.Value, label, properties, memberRefs, new SourceSpan(groupToken.Span.Start, end));
        return true;
    }

    private (IReadOnlyList<RawSketchProperty> Properties, IReadOnlyList<RawSketchNodeRef> MemberRefs, SourcePosition End) ParseGroupBody()
    {
        var properties = new List<RawSketchProperty>();
        var memberRefs = new List<RawSketchNodeRef>();
        var end = Current.Span.End;

        if (!Match(SketchTokenKind.LeftBrace, out var left))
            return (properties, memberRefs, end);

        end = left.Span.End;

        while (!Check(SketchTokenKind.RightBrace) && !Check(SketchTokenKind.EndOfFile))
        {
            SkipNewlines();
            if (Check(SketchTokenKind.RightBrace) || Check(SketchTokenKind.EndOfFile))
                break;

            // Node ref: [id]
            if (Check(SketchTokenKind.LeftBracket))
            {
                var nodeRef = ParseNodeRef();
                if (nodeRef != null)
                {
                    memberRefs.Add(nodeRef);
                    end = nodeRef.Span.End;
                }
                continue;
            }

            // Property: key: value
            if (MatchPropertyKey(out var key))
            {
                if (!Match(SketchTokenKind.Colon, out _))
                {
                    AddError("SKETCH_PARSE_EXPECTED_PROPERTY_COLON", "Expected ':' after property name.", Current.Span);
                    end = key.Span.End;
                    SynchronizeToNextLine();
                    continue;
                }

                var valueTokens = new List<SketchToken>();
                var valueNestingDepth = 0;
                while (!Check(SketchTokenKind.Newline)
                       && !Check(SketchTokenKind.Comment)
                       && !Check(SketchTokenKind.RightBrace)
                       && !Check(SketchTokenKind.EndOfFile))
                {
                    if (IsInlinePropertyBoundary(valueTokens.Count, valueNestingDepth)
                        || IsInlineGroupMemberBoundary(valueTokens.Count, valueNestingDepth))
                        break;

                    var token = Advance();
                    UpdateValueNestingDepth(token, ref valueNestingDepth);
                    valueTokens.Add(token);
                }

                var value = FormatPropertyValue(valueTokens);
                var valueEnd = valueTokens.Count > 0 ? valueTokens[^1].Span.End : key.Span.End;
                end = valueEnd;
                properties.Add(new RawSketchProperty(key.Value, value, new SourceSpan(key.Span.Start, valueEnd)));
                continue;
            }

            // Unknown token, skip to next line
            end = Advance().Span.End;
            SynchronizeToNextLine();
        }

        if (Match(SketchTokenKind.RightBrace, out var right))
            end = right.Span.End;
        else
            AddError("SKETCH_PARSE_MISSING_BRACE", "Expected '}' to close group block.", Current.Span);

        return (properties, memberRefs, end);
    }

    private bool TryParseIgnoredBlockStatement(out RawSketchIgnoredStatement? statement)
    {
        statement = null;
        if (Current.Kind is not SketchTokenKind.KeywordEdge)
            return false;

        var start = Advance();
        while (!Check(SketchTokenKind.LeftBrace)
               && !Check(SketchTokenKind.Newline)
               && !Check(SketchTokenKind.EndOfFile))
        {
            Advance();
        }

        var end = Previous.Span.End;
        if (Check(SketchTokenKind.LeftBrace))
            end = SkipPropertyBlock();

        statement = new RawSketchIgnoredStatement(start.Value, new SourceSpan(start.Span.Start, end));
        return true;
    }

    private bool TryMatchArrow(out SketchEdgeDirection direction)
    {
        if (Match(SketchTokenKind.ArrowDirected, out _))
        {
            direction = SketchEdgeDirection.Directed;
            return true;
        }

        if (Match(SketchTokenKind.ArrowUndirected, out _))
        {
            direction = SketchEdgeDirection.Undirected;
            return true;
        }

        if (Match(SketchTokenKind.ArrowBidirectional, out _))
        {
            direction = SketchEdgeDirection.Bidirectional;
            return true;
        }

        direction = SketchEdgeDirection.Directed;
        return false;
    }

    private RawSketchEdgeDecl? ParseEdge(RawSketchNodeRef source, SketchEdgeDirection direction)
    {
        var target = ParseNodeRef();
        if (target == null)
        {
            AddError("SKETCH_PARSE_EXPECTED_EDGE_TARGET", "Expected an edge target after arrow.", Current.Span);
            return null;
        }

        string? label = null;
        var end = target.Span.End;
        if (Match(SketchTokenKind.Colon, out var colon))
        {
            var labelTokens = new List<SketchToken>();
            while (!Check(SketchTokenKind.Newline)
                   && !Check(SketchTokenKind.Comment)
                   && !Check(SketchTokenKind.LeftBrace)
                   && !Check(SketchTokenKind.EndOfFile))
            {
                labelTokens.Add(Advance());
            }

            label = FormatLabel(labelTokens);
            end = labelTokens.Count > 0 ? labelTokens[^1].Span.End : colon.Span.End;
        }

        var properties = Array.Empty<RawSketchProperty>();
        if (Check(SketchTokenKind.LeftBrace))
        {
            var block = ParsePropertyBlock();
            properties = block.Properties.ToArray();
            end = block.End;
        }

        return new RawSketchEdgeDecl(source, target, direction, string.IsNullOrWhiteSpace(label) ? null : label, properties, new SourceSpan(source.Span.Start, end));
    }

    private RawSketchNodeRef? ParseNodeRef()
    {
        if (Match(SketchTokenKind.LeftBracket, out var left))
        {
            if (!Match(SketchTokenKind.Identifier, out var idToken))
            {
                AddError("SKETCH_PARSE_EXPECTED_BRACKET_ID", "Expected an identifier after '['.", Current.Span);
                return null;
            }

            if (!Match(SketchTokenKind.RightBracket, out var right))
            {
                AddError("SKETCH_PARSE_MISSING_BRACKET", "Expected ']' after bracket node id.", Current.Span);
                return new RawSketchNodeRef(idToken.Value, idToken.Value, true, new SourceSpan(left.Span.Start, idToken.Span.End));
            }

            return new RawSketchNodeRef(idToken.Value, idToken.Value, true, new SourceSpan(left.Span.Start, right.Span.End));
        }

        if (Match(SketchTokenKind.Identifier, out var identifier))
            return new RawSketchNodeRef(identifier.Value, identifier.Value, false, identifier.Span);

        return null;
    }

    private SourcePosition SkipPropertyBlock()
    {
        var depth = 0;
        var end = Current.Span.End;
        do
        {
            if (Match(SketchTokenKind.LeftBrace, out var left))
            {
                depth++;
                end = left.Span.End;
                continue;
            }

            if (Match(SketchTokenKind.RightBrace, out var right))
            {
                depth--;
                end = right.Span.End;
                continue;
            }

            if (Check(SketchTokenKind.EndOfFile))
                break;

            end = Advance().Span.End;
        }
        while (depth > 0);

        if (depth > 0)
            AddError("SKETCH_PARSE_MISSING_BRACE", "Expected '}' to close property block.", Current.Span);

        return end;
    }

    private PropertyBlockParseResult ParsePropertyBlock()
    {
        var properties = new List<RawSketchProperty>();
        var depth = 0;
        var end = Current.Span.End;

        if (!Match(SketchTokenKind.LeftBrace, out var left))
            return new PropertyBlockParseResult(properties, end);

        depth++;
        end = left.Span.End;

        while (depth > 0 && !Check(SketchTokenKind.EndOfFile))
        {
            SkipNewlines();
            if (Match(SketchTokenKind.RightBrace, out var right))
            {
                depth--;
                end = right.Span.End;
                continue;
            }

            if (!MatchPropertyKey(out var key))
            {
                end = Advance().Span.End;
                continue;
            }

            if (!Match(SketchTokenKind.Colon, out _))
            {
                AddError("SKETCH_PARSE_EXPECTED_PROPERTY_COLON", "Expected ':' after property name.", Current.Span);
                end = key.Span.End;
                continue;
            }

            var valueTokens = new List<SketchToken>();
            var valueNestingDepth = 0;
            while (!Check(SketchTokenKind.Newline)
                   && !Check(SketchTokenKind.Comment)
                   && !Check(SketchTokenKind.RightBrace)
                   && !Check(SketchTokenKind.EndOfFile))
            {
                if (IsInlinePropertyBoundary(valueTokens.Count, valueNestingDepth))
                    break;

                var token = Advance();
                UpdateValueNestingDepth(token, ref valueNestingDepth);
                valueTokens.Add(token);
            }

            var value = FormatPropertyValue(valueTokens);
            var valueEnd = valueTokens.Count > 0 ? valueTokens[^1].Span.End : key.Span.End;
            end = valueEnd;
            properties.Add(new RawSketchProperty(key.Value, value, new SourceSpan(key.Span.Start, valueEnd)));
        }

        if (depth > 0)
            AddError("SKETCH_PARSE_MISSING_BRACE", "Expected '}' to close property block.", Current.Span);

        return new PropertyBlockParseResult(properties, end);
    }

    private static string FormatLabel(IReadOnlyList<SketchToken> tokens)
    {
        if (tokens.Count == 0)
            return string.Empty;
        if (tokens.Count == 1 && tokens[0].Kind == SketchTokenKind.String)
            return tokens[0].Value;

        var sb = new StringBuilder();
        foreach (var t in tokens)
        {
            if (t.Kind == SketchTokenKind.Invalid)
                continue;
            var v = t.Value;
            if (string.IsNullOrWhiteSpace(v))
                continue;
            if (sb.Length > 0)
                sb.Append(' ');
            sb.Append(v);
        }
        while (sb.Length > 0 && char.IsWhiteSpace(sb[sb.Length - 1]))
            sb.Length--;
        var start = 0;
        while (start < sb.Length && char.IsWhiteSpace(sb[start]))
            start++;
        return start == 0 ? sb.ToString() : sb.ToString(start, sb.Length - start);
    }

    private static string FormatPropertyValue(IReadOnlyList<SketchToken> tokens)
    {
        if (tokens.Count == 0)
            return string.Empty;
        if (tokens.Count == 1 && tokens[0].Kind == SketchTokenKind.String)
            return tokens[0].Value;

        var sb = new StringBuilder();
        foreach (var t in tokens)
        {
            if (t.Kind == SketchTokenKind.Invalid)
                continue;
            sb.Append(t.Text);
        }
        while (sb.Length > 0 && char.IsWhiteSpace(sb[sb.Length - 1]))
            sb.Length--;
        var start = 0;
        while (start < sb.Length && char.IsWhiteSpace(sb[start]))
            start++;
        return start == 0 ? sb.ToString() : sb.ToString(start, sb.Length - start);
    }

    private void SkipNewlines()
    {
        while (Match(SketchTokenKind.Newline, out _) || Match(SketchTokenKind.Comment, out _))
        {
        }
    }

    private void SynchronizeToNextLine()
    {
        while (!Check(SketchTokenKind.Newline) && !Check(SketchTokenKind.EndOfFile))
            Advance();
        Match(SketchTokenKind.Newline, out _);
    }

    private bool Match(SketchTokenKind kind, out SketchToken token)
    {
        if (Check(kind))
        {
            token = Advance();
            return true;
        }

        token = Current;
        return false;
    }

    private bool MatchPropertyKey(out SketchToken token)
    {
        if (IsPropertyKeyToken(Current.Kind))
        {
            token = Advance();
            return true;
        }

        token = Current;
        return false;
    }

    private bool IsInlinePropertyBoundary(int valueTokenCount, int valueNestingDepth) =>
        valueTokenCount > 0
        && valueNestingDepth == 0
        && IsPropertyKeyToken(Current.Kind)
        && PeekKind(1) == SketchTokenKind.Colon;

    private bool IsInlineGroupMemberBoundary(int valueTokenCount, int valueNestingDepth) =>
        valueTokenCount > 0
        && valueNestingDepth == 0
        && Check(SketchTokenKind.LeftBracket);

    private static bool IsPropertyKeyToken(SketchTokenKind kind) =>
        kind is SketchTokenKind.Identifier
            or SketchTokenKind.KeywordSketch
            or SketchTokenKind.KeywordClass
            or SketchTokenKind.KeywordGroup
            or SketchTokenKind.KeywordEdge;

    private static void UpdateValueNestingDepth(SketchToken token, ref int depth)
    {
        switch (token.Kind)
        {
            case SketchTokenKind.LeftBracket:
            case SketchTokenKind.LeftParen:
                depth++;
                break;
            case SketchTokenKind.RightBracket:
            case SketchTokenKind.RightParen:
                if (depth > 0)
                    depth--;
                break;
        }
    }

    private bool Check(SketchTokenKind kind) => Current.Kind == kind;

    private SketchTokenKind PeekKind(int offset) =>
        _tokens[Math.Min(_position + offset, _tokens.Count - 1)].Kind;

    private SketchToken Advance()
    {
        if (!Check(SketchTokenKind.EndOfFile))
            _position++;
        return Previous;
    }

    private SketchToken Current => _tokens[Math.Min(_position, _tokens.Count - 1)];

    private SketchToken Previous => _tokens[Math.Max(0, _position - 1)];

    private void AddError(string code, string message, SourceSpan span)
    {
        _diagnostics.Add(new SketchDiagnostic(SketchDiagnosticSeverity.Error, code, message, span));
    }

    private sealed record PropertyBlockParseResult(IReadOnlyList<RawSketchProperty> Properties, SourcePosition End);
}
