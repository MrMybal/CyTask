using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Security;

public static partial class SessionSecurity
{
    public const string ContextItem = "CyTask.AuthenticatedUser";
    public const string AuthenticationSchemeItem = "CyTask.AuthenticationScheme";
    public const string AccessTokenHashItem = "CyTask.AccessTokenHash";
    public const string CsrfHeader = "X-CSRF-Token";
    public const string CookieScheme = "CyTaskSession";
    public const string BearerScheme = "CyTaskBearer";

    public static string SessionCookie(IHostEnvironment environment) =>
        environment.IsDevelopment() ? "CyTask.Session" : "__Host-CyTask.Session";

    public static string CsrfCookie(IHostEnvironment environment) =>
        environment.IsDevelopment() ? "CyTask.Csrf" : "__Host-CyTask.Csrf";

    public static string CreateToken(int bytes = 32) =>
        WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(bytes));

    public static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    public static bool FixedTimeEquals(byte[] expectedHash, string token) =>
        CryptographicOperations.FixedTimeEquals(expectedHash, HashToken(token));

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public static bool IsValidEmail(string email) =>
        email.Length <= 254 && new EmailAddressAttribute().IsValid(email);

    public static string NormalizeProjectKey(string key) => key.Trim().ToUpperInvariant();

    public static bool IsValidProjectKey(string key) => ProjectKeyRegex().IsMatch(key);

    public static bool IsValidSha256(string value) => Sha256Regex().IsMatch(value);

    public static bool IsValidContentType(string value) => ContentTypeRegex().IsMatch(value);

    public static bool IsValidProvider(string value) => ProviderRegex().IsMatch(value);

    public static string CreateSlug(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        var pendingDash = false;

        foreach (var character in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(character);
            if (lower is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                if (pendingDash && builder.Length > 0)
                {
                    builder.Append('-');
                }

                builder.Append(lower);
                pendingDash = false;
            }
            else
            {
                pendingDash = true;
            }
        }

        return builder.ToString().Trim('-');
    }

    public static void SetSessionCookies(
        HttpResponse response,
        IHostEnvironment environment,
        string sessionToken,
        string csrfToken,
        DateTimeOffset expiresAt)
    {
        var secure = !environment.IsDevelopment();
        response.Cookies.Append(SessionCookie(environment), sessionToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = expiresAt,
            IsEssential = true
        });
        response.Cookies.Append(CsrfCookie(environment), csrfToken, new CookieOptions
        {
            HttpOnly = false,
            Secure = secure,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = expiresAt,
            IsEssential = true
        });
    }

    public static void DeleteSessionCookies(HttpResponse response, IHostEnvironment environment)
    {
        var secure = !environment.IsDevelopment();
        response.Cookies.Delete(SessionCookie(environment), new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = SameSiteMode.Strict,
            Path = "/"
        });
        response.Cookies.Delete(CsrfCookie(environment), new CookieOptions
        {
            HttpOnly = false,
            Secure = secure,
            SameSite = SameSiteMode.Strict,
            Path = "/"
        });
    }

    public static AuthenticatedUser? GetUser(this HttpContext context) =>
        context.Items.TryGetValue(ContextItem, out var value) ? value as AuthenticatedUser : null;

    public static ClaimsPrincipal CreatePrincipal(AuthenticatedUser user, string authenticationType)
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, user.UserId.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.DisplayName),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("cytask:organization", user.OrganizationId.ToString())
        ], authenticationType);
        return new ClaimsPrincipal(identity);
    }

    public static bool UsesAuthenticationScheme(this HttpContext context, string scheme) =>
        context.Items.TryGetValue(AuthenticationSchemeItem, out var value) &&
        string.Equals(value as string, scheme, StringComparison.Ordinal);

    [GeneratedRegex("^[A-Z][A-Z0-9]{1,9}$", RegexOptions.CultureInvariant)]
    private static partial Regex ProjectKeyRegex();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Regex();

    [GeneratedRegex("^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContentTypeRegex();

    [GeneratedRegex("^[a-z][a-z0-9-]{0,39}$", RegexOptions.CultureInvariant)]
    private static partial Regex ProviderRegex();
}

public sealed class PasswordService
{
    private static readonly UserAccount Placeholder = new(
        Guid.Empty, string.Empty, string.Empty, string.Empty, DateTimeOffset.UnixEpoch);
    private readonly PasswordHasher<UserAccount> _hasher = new(Options.Create(new PasswordHasherOptions
    {
        CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV3,
        IterationCount = 220_000
    }));
    private readonly string _dummyHash;

    public PasswordService()
    {
        _dummyHash = _hasher.HashPassword(Placeholder, "CyTask timing equalization value");
    }

    public string Hash(string password) => _hasher.HashPassword(Placeholder, password);

    public bool Verify(string? passwordHash, string password)
    {
        var result = _hasher.VerifyHashedPassword(Placeholder, passwordHash ?? _dummyHash, password);
        return passwordHash is not null && result is not PasswordVerificationResult.Failed;
    }
}

public sealed class SessionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(
        HttpContext context,
        IWorkspaceStore store,
        IHostEnvironment environment)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (!string.IsNullOrEmpty(authorization))
        {
            const string prefix = "Bearer ";
            if (authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                var accessToken = authorization[prefix.Length..];
                if (NativeAuthorizationSecurity.IsValidAccessToken(accessToken))
                {
                    var tokenHash = SessionSecurity.HashToken(accessToken);
                    var user = await store.FindAccessTokenAsync(tokenHash, context.RequestAborted);
                    if (user is not null)
                    {
                        SetAuthenticatedContext(
                            context, user, SessionSecurity.BearerScheme, tokenHash);
                    }
                }
            }

            await next(context);
            return;
        }

        if (context.Request.Cookies.TryGetValue(
                SessionSecurity.SessionCookie(environment), out var sessionToken) &&
            sessionToken.Length is >= 32 and <= 128)
        {
            var user = await store.FindSessionAsync(
                SessionSecurity.HashToken(sessionToken), context.RequestAborted);
            if (user is not null)
            {
                SetAuthenticatedContext(context, user, SessionSecurity.CookieScheme, null);
            }
        }

        await next(context);
    }

    private static void SetAuthenticatedContext(
        HttpContext context,
        AuthenticatedUser user,
        string scheme,
        byte[]? accessTokenHash)
    {
        context.Items[SessionSecurity.ContextItem] = user;
        context.Items[SessionSecurity.AuthenticationSchemeItem] = scheme;
        if (accessTokenHash is not null)
        {
            context.Items[SessionSecurity.AccessTokenHashItem] = accessTokenHash;
        }
        context.User = SessionSecurity.CreatePrincipal(user, scheme);
    }
}

public sealed class RequireSessionFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        return context.HttpContext.GetUser() is null
            ? Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Authentication required")
            : await next(context);
    }
}

public sealed class CsrfFilter(IHostEnvironment environment) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (context.HttpContext.UsesAuthenticationScheme(SessionSecurity.BearerScheme))
        {
            return await next(context);
        }

        var request = context.HttpContext.Request;
        var user = context.HttpContext.GetUser();
        var header = request.Headers[SessionSecurity.CsrfHeader].ToString();
        var cookie = request.Cookies[SessionSecurity.CsrfCookie(environment)];

        if (user is null || string.IsNullOrWhiteSpace(header) || string.IsNullOrWhiteSpace(cookie) ||
            !string.Equals(header, cookie, StringComparison.Ordinal) ||
            !SessionSecurity.FixedTimeEquals(user.CsrfHash, header))
        {
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Invalid CSRF token");
        }

        return await next(context);
    }
}

public sealed class RequireCookieSessionFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        return !context.HttpContext.UsesAuthenticationScheme(SessionSecurity.CookieScheme)
            ? Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Browser session required")
            : await next(context);
    }
}

public sealed class RequireBearerTokenFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        return !context.HttpContext.UsesAuthenticationScheme(SessionSecurity.BearerScheme)
            ? Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Bearer token required")
            : await next(context);
    }
}

public sealed class RequireRoleFilter(params string[] roles) : IEndpointFilter
{
    private readonly HashSet<string> _roles = new(roles, StringComparer.Ordinal);

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var user = context.HttpContext.GetUser();
        return user is null || !_roles.Contains(user.Role)
            ? Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Insufficient permissions")
            : await next(context);
    }
}
