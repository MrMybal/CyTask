using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using CyTask.Api.Configuration;

namespace CyTask.Api.Collaboration;

public sealed record CallIceServer(IReadOnlyList<string> Urls, string? Username = null, string? Credential = null);
public sealed record CallConfigurationView(IReadOnlyList<CallIceServer> IceServers, string IceTransportPolicy,
    bool RelayConfigured, DateTimeOffset? CredentialsExpireAt, int MaxParticipants);

public static class CallConfiguration
{
    public static bool ValidOptions(CyTaskOptions value) =>
        value.WebRtcStunUrls is { Length: <= 16 } && value.WebRtcTurnUrls is { Length: <= 16 }
        && value.WebRtcStunUrls.All(url => ValidUrl(url, false))
        && value.WebRtcTurnUrls.All(url => ValidUrl(url, true))
        && ValidPublicOrigin(value.WebRtcPublicOrigin)
        && (value.WebRtcTurnUrls.Length == 0 || value.WebRtcTurnSharedSecret is { Length: >= 32 and <= 1024 })
        && (!value.WebRtcRelayOnly || value.WebRtcTurnUrls.Length > 0)
        && value.WebRtcTurnCredentialSeconds is >= 300 and <= 86400
        && value.CallMaxParticipants is >= 2 and <= 16
        && value.CallAccessCheckSeconds is >= 1 and <= 60;

    private static bool ValidPublicOrigin(string? value) => string.IsNullOrEmpty(value)
        || (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
            && uri.Host.Length > 0 && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/"
            && uri.Query.Length == 0 && uri.Fragment.Length == 0);

    private static bool ValidUrl(string? value, bool relay)
    {
        if (value is null || value.Length is < 6 or > 512 || value.Any(char.IsWhiteSpace)
            || value.Contains('@') || value.Contains('#') || value.Contains('/') || value.Contains('\\')) return false;
        var colon = value.IndexOf(':');
        if (colon < 0 || (relay ? value[..colon] is not ("turn" or "turns") : value[..colon] is not ("stun" or "stuns"))) return false;
        var endpoint = value[(colon + 1)..];
        var query = endpoint.IndexOf('?');
        if (query >= 0)
        {
            if (!relay || endpoint[query..] is not ("?transport=udp" or "?transport=tcp")) return false;
            endpoint = endpoint[..query];
        }
        return Uri.TryCreate("https://" + endpoint, UriKind.Absolute, out var uri)
            && uri.Host.Length > 0 && uri.AbsolutePath == "/" && uri.Port is >= 1 and <= 65535;
    }

    [SuppressMessage("Security", "CA5350:Do Not Use Weak Cryptographic Algorithms", Justification = "TURN REST credentials require HMAC-SHA1 for coturn interoperability; the shared secret is never returned.")]
    public static CallConfigurationView Create(CyTaskOptions options, Guid organizationId, Guid userId,
        Guid channelId, DateTimeOffset now)
    {
        var servers = new List<CallIceServer>();
        if (options.WebRtcStunUrls.Length > 0) servers.Add(new(options.WebRtcStunUrls));
        DateTimeOffset? expires = null;
        if (options.WebRtcTurnUrls.Length > 0)
        {
            expires = now.AddSeconds(options.WebRtcTurnCredentialSeconds);
            var username = $"{expires.Value.ToUnixTimeSeconds()}:{organizationId:N}:{userId:N}:{channelId:N}";
            var credential = Convert.ToBase64String(HMACSHA1.HashData(
                Encoding.UTF8.GetBytes(options.WebRtcTurnSharedSecret!), Encoding.UTF8.GetBytes(username)));
            servers.Add(new(options.WebRtcTurnUrls, username, credential));
        }
        return new(servers, options.WebRtcRelayOnly ? "relay" : "all", options.WebRtcTurnUrls.Length > 0,
            expires, options.CallMaxParticipants);
    }
}
