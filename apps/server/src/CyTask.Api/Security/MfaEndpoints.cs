using CyTask.Api.Configuration;
using CyTask.Api.Endpoints;
using CyTask.Api.Infrastructure;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Security;

public static class MfaEndpoints
{
    public static void MapMfaEndpoints(this RouteGroupBuilder api,RouteGroupBuilder authenticated)
    {
        api.MapGet("/auth/mfa/pending",PendingAsync).RequireRateLimiting("mfa");
        api.MapPost("/auth/mfa/advance",AdvanceAsync).RequireRateLimiting("mfa");
        api.MapPost("/auth/mfa/cancel",CancelAsync).RequireRateLimiting("mfa");
        authenticated.MapGet("/account/mfa",async(HttpContext context,MfaService mfa,CancellationToken token)=>{
            NoStore(context);return Results.Ok(await mfa.StatusAsync(context.GetUser()!.UserId,token));
        }).AddEndpointFilter<RequireCookieSessionFilter>();
        authenticated.MapPost("/account/mfa",ManageAsync).RequireRateLimiting("authentication")
            .AddEndpointFilter<RequireCookieSessionFilter>().AddEndpointFilter<CsrfFilter>();
    }
    public static string Cookie(HttpContext context)=>context.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment()?"CyTask.Mfa":"__Host-CyTask.Mfa";
    public static void SetChallenge(HttpContext context,MfaView challenge)
    {
        NoStore(context);context.Response.Cookies.Append(Cookie(context),challenge.Token,new CookieOptions{
            HttpOnly=true,Secure=!context.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment(),SameSite=SameSiteMode.Strict,
            Path="/",Expires=challenge.ExpiresAt,IsEssential=true
        });
    }
    private static void DeleteChallenge(HttpContext context)=>context.Response.Cookies.Delete(Cookie(context),new CookieOptions{
        HttpOnly=true,Secure=!context.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment(),SameSite=SameSiteMode.Strict,Path="/"
    });
    private static bool Bound(HttpContext context,string token)=>MfaService.Parse(token,out _)&&context.Request.Cookies.TryGetValue(Cookie(context),out var cookie)
        &&SessionSecurity.FixedTimeEquals(SessionSecurity.HashToken(token),cookie);
    private static async Task<IResult> PendingAsync(HttpContext context,MfaService mfa,CancellationToken cancellationToken)
    {
        NoStore(context);
        var view=await mfa.PendingAsync(context.Request.Cookies[Cookie(context)],cancellationToken);
        return Results.Ok(new{challenge=view});
    }
    private static async Task<IResult> ManageAsync(ManageMfaRequest request,HttpContext context,MfaService mfa,
        IWorkspaceStore store,PasswordService passwords,CancellationToken cancellationToken)
    {
        NoStore(context);var user=await store.FindUserByEmailAsync(context.GetUser()!.Email,cancellationToken);
        if(request.Password is not {Length:>=1 and <=200}||user is null||!passwords.Verify(user.PasswordHash,request.Password))return Results.Problem(statusCode:401,title:"Invalid credentials");
        try{var view=await mfa.StartAsync(user,request.Action,cancellationToken);SetChallenge(context,view);return Results.Ok(view);}
        catch(MfaException exception){return Failure(exception);}
    }
    private static async Task<IResult> AdvanceAsync(AdvanceMfaRequest request,HttpContext context,MfaService mfa,
        IWorkspaceStore store,IOptions<CyTaskOptions> options,IHostEnvironment environment,CancellationToken cancellationToken)
    {
        NoStore(context);if(!Bound(context,request.Token))return Results.Problem(statusCode:400,title:"Verification expired. Sign in again.");
        try{
            var result=await mfa.AdvanceAsync(request.Token,request.Operation,request.Method,request.Code,cancellationToken);
            if(result.Challenge is not null)return Results.Ok(new{kind="challenge",challenge=result.Challenge});
            var sessionToken=SessionSecurity.CreateToken();var csrf=SessionSecurity.CreateToken();var expires=DateTimeOffset.UtcNow.AddHours(options.Value.SessionHours);
            var hash=SessionSecurity.HashToken(sessionToken);
            var session=await store.CreateSessionAsync(result.UserId,sessionToken,hash,csrf,SessionSecurity.HashToken(csrf),expires,cancellationToken);
            if(session is null||result.Grant is null||!await mfa.CompleteSessionAsync(result.UserId,result.Grant,hash,expires,cancellationToken)){
                await store.DeleteSessionAsync(hash,cancellationToken);return Results.Problem(statusCode:401,title:"Verification expired. Sign in again.");
            }
            SessionSecurity.SetSessionCookies(context.Response,environment,sessionToken,csrf,expires);
            DeleteChallenge(context);
            var response=new SessionResponse(session.User.UserId,session.User.OrganizationId,session.User.Email,session.User.DisplayName,session.User.Role,csrf);
            return Results.Ok(new{kind="complete",session=response,recoveryCodes=result.RecoveryCodes??[]});
        }catch(MfaException exception){return Failure(exception);}
        catch(System.Security.Cryptography.CryptographicException){return Results.Problem(statusCode:503,title:"The second factor is unavailable. Contact the server administrator.");}
    }
    private static async Task<IResult> CancelAsync(CancelMfaRequest request,HttpContext context,MfaService mfa,CancellationToken cancellationToken)
    {
        NoStore(context);if(!Bound(context,request.Token))return Results.Problem(statusCode:400,title:"Verification expired. Sign in again.");
        await mfa.CancelAsync(request.Token,cancellationToken);DeleteChallenge(context);return Results.NoContent();
    }
    private static IResult Failure(MfaException exception)=>Results.Problem(statusCode:exception.Status,title:exception.Message);
    public static void NoStore(HttpContext context){context.Response.Headers.CacheControl="no-store";context.Response.Headers.Pragma="no-cache";context.Response.Headers["Referrer-Policy"]="no-referrer";}
}
public sealed record ManageMfaRequest(string Password,string Action);
public sealed record AdvanceMfaRequest(string Token,string Operation,string? Method=null,string? Code=null);
public sealed record CancelMfaRequest(string Token);
