using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;

namespace CyTask.Api.Security;

public static partial class NativeAuthorizationSecurity
{
    public const string UnrealClientId = "cytask-unreal";
    public const string ChallengeMethod = "S256";
    public const string CallbackPath = "/cytask/oauth/callback";
    private const string AccessTokenPrefix = "cyt_at_";

    public static string CreateAccessToken() => AccessTokenPrefix + SessionSecurity.CreateToken();

    public static bool IsValidClientId(string value) =>
        string.Equals(value, UnrealClientId, StringComparison.Ordinal);

    public static bool IsValidState(string value) => StateRegex().IsMatch(value);

    public static bool IsValidCodeChallenge(string value) => CodeChallengeRegex().IsMatch(value);

    public static bool IsValidCodeVerifier(string value) => CodeVerifierRegex().IsMatch(value);

    public static bool IsValidAuthorizationCode(string value) => CodeChallengeRegex().IsMatch(value);

    public static bool IsValidAccessToken(string value) =>
        value.StartsWith(AccessTokenPrefix, StringComparison.Ordinal) &&
        CodeChallengeRegex().IsMatch(value[AccessTokenPrefix.Length..]);

    public static string ComputeCodeChallenge(string verifier) =>
        WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    public static bool IsValidRedirectUri(string value, out Uri? redirectUri)
    {
        redirectUri = null;
        if (value.Length is < 1 or > 512 ||
            !Uri.TryCreate(value, UriKind.Absolute, out var candidate) ||
            !string.Equals(candidate.Scheme, Uri.UriSchemeHttp, StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(candidate.UserInfo) ||
            !string.IsNullOrEmpty(candidate.Query) ||
            !string.IsNullOrEmpty(candidate.Fragment) ||
            !string.Equals(candidate.AbsolutePath, CallbackPath, StringComparison.Ordinal) ||
            candidate.Port is < 1024 or > 65535 ||
            !IPAddress.TryParse(candidate.Host.Trim('[', ']'), out var address) ||
            address.AddressFamily is not (AddressFamily.InterNetwork or AddressFamily.InterNetworkV6) ||
            !(address.Equals(IPAddress.Loopback) || address.Equals(IPAddress.IPv6Loopback)))
        {
            return false;
        }

        redirectUri = candidate;
        return true;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{16,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex StateRegex();

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex CodeChallengeRegex();

    [GeneratedRegex("^[A-Za-z0-9._~-]{43,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex CodeVerifierRegex();
}
