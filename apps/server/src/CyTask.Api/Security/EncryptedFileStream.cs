using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace CyTask.Api.Security;

/// <summary>Bounded-memory authenticated storage; seeking never needs a plaintext temporary file.</summary>
internal sealed class EncryptedFileStream : Stream
{
    private static ReadOnlySpan<byte> Magic => "CYTENC01"u8;
    private const int BlockSize = 65536;
    private const int HeaderSize = 64;
    private readonly FileStream _file;
    private readonly AesGcm _aes;
    private readonly byte[] _header;
    private readonly byte[] _context;
    private readonly bool _writing;
    private readonly byte[] _plain = new byte[BlockSize];
    private readonly byte[] _cipher = new byte[BlockSize + 16];
    private long _length;
    private long _position;
    private long _cachedBlock = -1;
    private int _pending;
    private bool _disposed;

    private EncryptedFileStream(FileStream file, DataEncryption encryption, string purpose, byte[] header, bool writing)
    {
        _file = file; _header = header; _writing = writing;
        _context = Encoding.UTF8.GetBytes("cytask.file.v1:" + purpose);
        var key = encryption.DeriveKey(header.AsSpan(8, 32), "file:" + purpose);
        try { _aes = new AesGcm(key, 16); }
        finally { CryptographicOperations.ZeroMemory(key); }
        if (!writing)
        {
            try
            {
                _aes.Decrypt(Nonce(ulong.MaxValue), [], header.AsSpan(48, 16), [], HeaderAad());
                _length = BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(40, 8));
                if (_length < 0 || _length > 1L << 50 || file.Length != PhysicalLength(_length))
                    throw new CryptographicException("Truncated or invalid encrypted file.");
            }
            catch { _aes.Dispose(); throw; }
        }
    }

    public static bool HasHeader(FileStream file)
    {
        Span<byte> prefix = stackalloc byte[8];
        var read = file.Read(prefix); file.Position = 0;
        if (read >= 6 && prefix[..6].SequenceEqual("CYTENC"u8) && (read != 8 || !prefix.SequenceEqual(Magic)))
            throw new CryptographicException("Unsupported encrypted file format.");
        return read == 8 && prefix.SequenceEqual(Magic);
    }

    public static EncryptedFileStream Create(string path, DataEncryption encryption, string purpose)
    {
        var file = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, BlockSize, FileOptions.Asynchronous);
        try
        {
            var header = new byte[HeaderSize]; Magic.CopyTo(header); RandomNumberGenerator.Fill(header.AsSpan(8, 32));
            file.Write(header);
            return new(file, encryption, purpose, header, true);
        }
        catch { file.Dispose(); throw; }
    }

    public static EncryptedFileStream Open(FileStream file, DataEncryption encryption, string purpose)
    {
        var header = new byte[HeaderSize]; file.ReadExactly(header);
        return new(file, encryption, purpose, header, false);
    }

    private static long PhysicalLength(long length) => checked(HeaderSize + length + (length / BlockSize + (length % BlockSize == 0 ? 0 : 1)) * 16);
    private static byte[] Nonce(ulong block) { var result = new byte[12]; BinaryPrimitives.WriteUInt64BigEndian(result.AsSpan(4), block); return result; }
    private byte[] HeaderAad() { var value = new byte[48 + _context.Length]; _header.AsSpan(0, 48).CopyTo(value); _context.CopyTo(value, 48); return value; }
    public override bool CanRead => !_writing && !_disposed;
    public override bool CanSeek => !_writing && !_disposed;
    public override bool CanWrite => _writing && !_disposed;
    public override long Length => _length;
    public override long Position { get => _position; set => Seek(value, SeekOrigin.Begin); }

    public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));
    public override void Write(ReadOnlySpan<byte> buffer)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_writing) throw new NotSupportedException();
        while (!buffer.IsEmpty)
        {
            var copied = Math.Min(BlockSize - _pending, buffer.Length);
            buffer[..copied].CopyTo(_plain.AsSpan(_pending)); _pending += copied; _length += copied; _position += copied;
            buffer = buffer[copied..];
            if (_pending == BlockSize) WriteBlock();
        }
    }
    public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested(); Write(buffer.Span); return ValueTask.CompletedTask;
    }
    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    private void WriteBlock()
    {
        var index = (_length - _pending) / BlockSize;
        _aes.Encrypt(Nonce((ulong)index), _plain.AsSpan(0, _pending), _cipher.AsSpan(0, _pending), _cipher.AsSpan(_pending, 16), _context);
        _file.Write(_cipher.AsSpan(0, _pending + 16)); _pending = 0;
    }
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
    public override int Read(Span<byte> buffer)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_writing) throw new NotSupportedException();
        var copied = 0;
        while (!buffer.IsEmpty && _position < _length)
        {
            var index = _position / BlockSize;
            var blockLength = (int)Math.Min(BlockSize, _length - index * BlockSize);
            if (_cachedBlock != index)
            {
                _file.Position = HeaderSize + index * (BlockSize + 16L);
                _file.ReadExactly(_cipher.AsSpan(0, blockLength + 16));
                _aes.Decrypt(Nonce((ulong)index), _cipher.AsSpan(0, blockLength), _cipher.AsSpan(blockLength, 16), _plain.AsSpan(0, blockLength), _context);
                _cachedBlock = index;
            }
            var offset = (int)(_position % BlockSize);
            var count = Math.Min(buffer.Length, blockLength - offset);
            _plain.AsSpan(offset, count).CopyTo(buffer); buffer = buffer[count..]; _position += count; copied += count;
        }
        return copied;
    }
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested(); return ValueTask.FromResult(Read(buffer.Span));
    }
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
    public override long Seek(long offset, SeekOrigin origin)
    {
        if (!CanSeek) throw new NotSupportedException();
        var position = checked((origin switch { SeekOrigin.Begin => 0, SeekOrigin.Current => _position, SeekOrigin.End => _length, _ => throw new ArgumentOutOfRangeException(nameof(origin)) }) + offset);
        if (position < 0) throw new IOException("Cannot seek before the beginning of a file.");
        return _position = position;
    }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Flush() => _file.Flush();
    public override Task FlushAsync(CancellationToken cancellationToken) => _file.FlushAsync(cancellationToken);
    protected override void Dispose(bool disposing)
    {
        if (_disposed) return;
        try
        {
            if (disposing && _writing)
            {
                if (_pending > 0) WriteBlock();
                BinaryPrimitives.WriteInt64LittleEndian(_header.AsSpan(40, 8), _length);
                _aes.Encrypt(Nonce(ulong.MaxValue), [], [], _header.AsSpan(48, 16), HeaderAad());
                _file.Position = 0; _file.Write(_header); _file.Flush(true);
            }
        }
        finally
        {
            _disposed = true; _aes.Dispose(); _file.Dispose();
            CryptographicOperations.ZeroMemory(_plain); CryptographicOperations.ZeroMemory(_cipher);
            base.Dispose(disposing);
        }
    }
}
