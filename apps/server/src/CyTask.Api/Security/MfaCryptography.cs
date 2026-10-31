using System.Buffers.Binary;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using CyTask.Api.Configuration;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Security;

public static class Totp
{
    private const string Alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    public static string NewSecret()=>Encode(RandomNumberGenerator.GetBytes(20));
    public static string Encode(ReadOnlySpan<byte> bytes)
    {
        var result=new StringBuilder();var bits=0;var value=0;
        foreach(var item in bytes){value=(value<<8)|item;bits+=8;while(bits>=5){bits-=5;result.Append(Alphabet[(value>>bits)&31]);}}
        if(bits>0)result.Append(Alphabet[(value<<(5-bits))&31]);return result.ToString();
    }
    private static byte[] Decode(string value)
    {
        var bytes=new List<byte>();var bits=0;var data=0;
        foreach(var character in value){var digit=Alphabet.IndexOf(character,StringComparison.Ordinal);if(digit<0)throw new FormatException("Invalid TOTP secret");
            data=(data<<5)|digit;bits+=5;if(bits>=8){bits-=8;bytes.Add((byte)(data>>bits));}}
        return bytes.ToArray();
    }
    [SuppressMessage("Security","CA5350:Do Not Use Weak Cryptographic Algorithms",Justification="RFC 6238 SHA-1 profile for interoperable authenticator apps, not password hashing.")]
    public static string Code(string secret,long step,int digits=6)
    {
        if(step<0||digits is not (6 or 8))throw new ArgumentOutOfRangeException(nameof(step));
        var key=Decode(secret);Span<byte> counter=stackalloc byte[8];BinaryPrimitives.WriteInt64BigEndian(counter,step);
        try{var digest=HMACSHA1.HashData(key,counter);var offset=digest[^1]&15;
            var value=(BinaryPrimitives.ReadUInt32BigEndian(digest.AsSpan(offset,4))&0x7fffffff)%(digits==6?1_000_000u:100_000_000u);
            return value.ToString(digits==6?"D6":"D8",CultureInfo.InvariantCulture);
        }finally{CryptographicOperations.ZeroMemory(key);}
    }
    public static long? Match(string secret,string code,DateTimeOffset now,long lastStep)
    {
        if(code.Length!=6||code.Any(character=>character is <'0' or >'9'))return null;
        var step=now.ToUnixTimeSeconds()/30;long? matched=null;
        for(var delta=-1;delta<=1;delta++){var candidate=step+delta;if(candidate<0)continue;
            if(CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Code(secret,candidate)),Encoding.ASCII.GetBytes(code))&&candidate>lastStep)matched=candidate;}
        return matched;
    }
}
public sealed class MfaSecretProtector
{
    private readonly byte[]? _key;
    private readonly byte[]? _codeKey;
    public MfaSecretProtector(IOptions<CyTaskOptions> options)
    {
        byte[]? master=null;
        if(!string.IsNullOrEmpty(options.Value.MfaEncryptionKey))master=Convert.FromBase64String(options.Value.MfaEncryptionKey);
        else if(options.Value.UseInMemoryStore)master=RandomNumberGenerator.GetBytes(32);
        if(master is null)return;
        try{
            _key=HKDF.DeriveKey(HashAlgorithmName.SHA256,master,32,info:Encoding.ASCII.GetBytes("cytask.mfa.encryption.v1"));
            _codeKey=HKDF.DeriveKey(HashAlgorithmName.SHA256,master,32,info:Encoding.ASCII.GetBytes("cytask.mfa.email-digest.v1"));
        }finally{CryptographicOperations.ZeroMemory(master);}
    }
    public static bool ValidKey(string? key){try{return key is not null&&Convert.FromBase64String(key).Length==32;}catch(FormatException){return false;}}
    public string Digest(Guid userId,string value)
    {
        if(_codeKey is null)throw new CryptographicException("MFA key unavailable");
        return Convert.ToHexString(HMACSHA256.HashData(_codeKey,Encoding.UTF8.GetBytes($"cytask.mfa.code.v1:{userId:N}:{value}")));
    }
    public string Protect(Guid userId,string value)
    {
        if(_key is null)throw new CryptographicException("MFA key unavailable");
        var nonce=RandomNumberGenerator.GetBytes(12);var plain=Encoding.UTF8.GetBytes(value);var cipher=new byte[plain.Length];var tag=new byte[16];
        try{using var aes=new AesGcm(_key,16);aes.Encrypt(nonce,plain,cipher,tag,Encoding.UTF8.GetBytes($"cytask.mfa.v1:{userId:N}"));
            return string.Join('.',"v1",Convert.ToBase64String(nonce),Convert.ToBase64String(tag),Convert.ToBase64String(cipher));
        }finally{CryptographicOperations.ZeroMemory(plain);}
    }
    public string Unprotect(Guid userId,string value)
    {
        if(_key is null)throw new CryptographicException("MFA key unavailable");var parts=value.Split('.');
        if(parts.Length!=4||parts[0]!="v1")throw new CryptographicException("Invalid MFA secret");
        var cipher=Convert.FromBase64String(parts[3]);var plain=new byte[cipher.Length];
        try{using var aes=new AesGcm(_key,16);aes.Decrypt(Convert.FromBase64String(parts[1]),cipher,Convert.FromBase64String(parts[2]),plain,Encoding.UTF8.GetBytes($"cytask.mfa.v1:{userId:N}"));return Encoding.UTF8.GetString(plain);}
        finally{CryptographicOperations.ZeroMemory(plain);}
    }
}
