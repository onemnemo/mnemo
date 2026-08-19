namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>
/// Forward-only reader over a protobuf message, enough to pull the few scalar fields an Anki
/// package header carries.
/// </summary>
/// <remarks>
/// Anki's schema is large, generated, and moves with the app, while Mnemo reads a version number
/// and a list of media names out of it, so a generated client plus its runtime would be carried
/// for two messages. Unknown fields are skipped by wire type, which is what keeps a package
/// written by a newer Anki readable here.
/// </remarks>
internal ref struct AnkiProtobufReader
{
    public const int WireTypeVarint = 0;
    public const int WireTypeFixed64 = 1;
    public const int WireTypeLengthDelimited = 2;
    public const int WireTypeFixed32 = 5;

    private readonly ReadOnlySpan<byte> _data;
    private int _position;

    public AnkiProtobufReader(ReadOnlySpan<byte> data)
    {
        _data = data;
        _position = 0;
    }

    /// <summary>Reads the next field header, or returns false at the end of the message or on malformed bytes.</summary>
    public bool TryReadFieldHeader(out int fieldNumber, out int wireType)
    {
        fieldNumber = 0;
        wireType = 0;
        if (_position >= _data.Length || !TryReadVarint(out var tag))
            return false;

        fieldNumber = (int)(tag >> 3);
        wireType = (int)(tag & 0x7);
        return fieldNumber > 0;
    }

    public bool TryReadVarint(out ulong value)
    {
        value = 0;
        for (var shift = 0; shift < 64; shift += 7)
        {
            if (_position >= _data.Length)
                return false;

            var current = _data[_position++];
            value |= (ulong)(current & 0x7F) << shift;
            if ((current & 0x80) == 0)
                return true;
        }

        return false;
    }

    public bool TryReadLengthDelimited(out ReadOnlySpan<byte> value)
    {
        value = default;
        if (!TryReadVarint(out var length) || length > (ulong)(_data.Length - _position))
            return false;

        value = _data.Slice(_position, (int)length);
        _position += (int)length;
        return true;
    }

    /// <summary>Steps over a field this reader does not care about. False when the wire type is unreadable.</summary>
    public bool TrySkip(int wireType) => wireType switch
    {
        WireTypeVarint => TryReadVarint(out _),
        WireTypeFixed64 => TryAdvance(8),
        WireTypeLengthDelimited => TryReadLengthDelimited(out _),
        WireTypeFixed32 => TryAdvance(4),
        _ => false,
    };

    private bool TryAdvance(int count)
    {
        if (count > _data.Length - _position)
            return false;

        _position += count;
        return true;
    }
}
