using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using CyTask.Api.Configuration;
using CyTask.Api.Security;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace CyTask.Api.Tests;
public sealed partial class CyTaskApiTests
{
    [Theory]
    [InlineData(59L,"94287082")]
    [InlineData(1111111109L,"07081804")]
    [InlineData(1111111111L,"14050471")]
    [InlineData(1234567890L,"89005924")]
    [InlineData(2000000000L,"69279037")]
    [InlineData(20000000000L,"65353130")]
    public void TotpMatchesRfc6238Vectors(long timestamp,string expected)=>Assert.Equal(expected,Totp.Code(Totp.Encode(Encoding.ASCII.GetBytes("12345678901234567890")),timestamp/30,8));

    [Fact]
    public async Task RequiredMfaGatesBootstrapAndBlocksTotpReplay()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"required",clock:clock);using var browser=factory.CreateClient();
        using var response=await browser.PostAsJsonAsync(new Uri("/api/v1/bootstrap",UriKind.Relative),CreateBootstrapRequest(),TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();
        var challenge=(await ReadJsonAsync(response)).GetProperty("challenge");Assert.Equal("choose",challenge.GetProperty("stage").GetString());
        using(var denied=await browser.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        var setup=await MfaAdvanceAsync(browser,challenge,"method","totp");challenge=setup.GetProperty("challenge");
        var secret=challenge.GetProperty("secret").GetString()!;Assert.StartsWith("otpauth://totp/",challenge.GetProperty("provisioningUri").GetString());
        using var outsider=factory.CreateClient();await MfaAdvanceAsync(outsider,challenge,"verify","totp",Totp.Code(secret,clock.GetUtcNow().ToUnixTimeSeconds()/30),HttpStatusCode.BadRequest);
        var complete=await MfaAdvanceAsync(browser,challenge,"verify","totp",Totp.Code(secret,clock.GetUtcNow().ToUnixTimeSeconds()/30));
        Assert.Equal(10,complete.GetProperty("recoveryCodes").GetArrayLength());using(var me=await browser.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken))me.EnsureSuccessStatusCode();
        using var next=factory.CreateClient();var pending=await MfaLoginAsync(next);
        await MfaAdvanceAsync(next,pending,"method","totp",expected:HttpStatusCode.BadRequest);
        await MfaAdvanceAsync(next,pending,"verify","totp",Totp.Code(secret,clock.GetUtcNow().ToUnixTimeSeconds()/30),HttpStatusCode.BadRequest);
        clock.Advance(TimeSpan.FromSeconds(30));await MfaAdvanceAsync(next,pending,"verify","totp",Totp.Code(secret,clock.GetUtcNow().ToUnixTimeSeconds()/30));
        var state=await factory.Services.GetRequiredService<IMfaStore>().ReadAsync(complete.GetProperty("session").GetProperty("userId").GetGuid(),TestContext.Current.CancellationToken);
        Assert.NotEqual(secret,state!.TotpSecret);Assert.DoesNotContain(secret,JsonSerializer.Serialize(state),StringComparison.Ordinal);
    }
    [Fact]
    public async Task OptionalMfaEnrollsRevokesOldSessionsAndUsesRecoveryOnce()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"optional",clock:clock);using var owner=factory.CreateClient();
        var csrf=await BootstrapAsync(owner);owner.DefaultRequestHeaders.Add("X-CSRF-Token",csrf);
        using var old=factory.CreateClient();using(var login=await old.PostAsJsonAsync(new Uri("/api/v1/sessions",UriKind.Relative),new{email=MfaEmail,password=MfaPassword},TestContext.Current.CancellationToken))login.EnsureSuccessStatusCode();
        using var manage=await owner.PostAsJsonAsync(new Uri("/api/v1/account/mfa",UriKind.Relative),new{password=MfaPassword,action="enable-totp"},TestContext.Current.CancellationToken);manage.EnsureSuccessStatusCode();var flow=await ReadJsonAsync(manage);
        flow=(await MfaAdvanceAsync(owner,flow,"method","totp")).GetProperty("challenge");var secret=flow.GetProperty("secret").GetString()!;
        var complete=await MfaAdvanceAsync(owner,flow,"verify","totp",Totp.Code(secret,clock.GetUtcNow().ToUnixTimeSeconds()/30));
        using(var denied=await old.GetAsync(new Uri("/api/v1/projects",UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        var codes=complete.GetProperty("recoveryCodes").EnumerateArray().Select(value=>value.GetString()!).ToArray();
        using var recovered=factory.CreateClient();var pending=await MfaLoginAsync(recovered);
        await MfaAdvanceAsync(recovered,pending,"verify","recovery",codes[0]);
        using var replay=factory.CreateClient();pending=await MfaLoginAsync(replay);await MfaAdvanceAsync(replay,pending,"verify","recovery",codes[0],HttpStatusCode.BadRequest);
        var state=await factory.Services.GetRequiredService<IMfaStore>().ReadAsync(complete.GetProperty("session").GetProperty("userId").GetGuid(),TestContext.Current.CancellationToken);
        Assert.Equal(9,state!.RecoveryHashes.Count);foreach(var code in codes)Assert.DoesNotContain(code,JsonSerializer.Serialize(state),StringComparison.Ordinal);
        owner.DefaultRequestHeaders.Remove("X-CSRF-Token");owner.DefaultRequestHeaders.Add("X-CSRF-Token",complete.GetProperty("session").GetProperty("csrfToken").GetString());
        using var export=await owner.GetAsync(new Uri("/api/v1/export",UriKind.Relative),TestContext.Current.CancellationToken);export.EnsureSuccessStatusCode();var text=await export.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);Assert.DoesNotContain(secret,text,StringComparison.Ordinal);Assert.DoesNotContain("RecoveryHashes",text,StringComparison.Ordinal);
    }
    [Fact]
    public async Task EmailMfaRequiresDeliveryAndBoundsAttemptsAndResends()
    {
        var clock=new MfaClock();var mail=new MfaMailbox();await using var factory=new CyTaskApiFactory(mfaPolicy:"required",mfaEmail:true,clock:clock,mfaMailer:mail,mfaAuthenticator:false);using var client=factory.CreateClient();
        using var response=await client.PostAsJsonAsync(new Uri("/api/v1/bootstrap",UriKind.Relative),CreateBootstrapRequest(),TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();var flow=(await ReadJsonAsync(response)).GetProperty("challenge");
        flow=(await MfaAdvanceAsync(client,flow,"method","email")).GetProperty("challenge");Assert.Single(mail.Codes);
        await MfaAdvanceAsync(client,flow,"email","email",expected:HttpStatusCode.TooManyRequests);
        var complete=await MfaAdvanceAsync(client,flow,"verify","email",mail.Codes[^1]);
        client.DefaultRequestHeaders.Add("X-CSRF-Token",complete.GetProperty("session").GetProperty("csrfToken").GetString());
        using(var forbidden=await client.PostAsJsonAsync(new Uri("/api/v1/account/mfa",UriKind.Relative),new{password=MfaPassword,action="disable-email"},TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Conflict,forbidden.StatusCode);
        using var other=factory.CreateClient();flow=await MfaLoginAsync(other);clock.Advance(TimeSpan.FromSeconds(61));
        flow=(await MfaAdvanceAsync(other,flow,"email","email")).GetProperty("challenge");
        for(var index=0;index<5;index++)await MfaAdvanceAsync(other,flow,"verify","email",mail.Codes[^1]=="000000"?"000001":"000000",HttpStatusCode.BadRequest);
        await MfaAdvanceAsync(other,flow,"verify","email",mail.Codes[^1],HttpStatusCode.BadRequest);
        clock.Advance(TimeSpan.FromMinutes(6));var pending=await other.GetFromJsonAsync<JsonElement>(new Uri("/api/v1/auth/mfa/pending",UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(JsonValueKind.Null,pending.GetProperty("challenge").ValueKind);
    }
    [Fact]
    public async Task FailedEmailCannotEnableAnAccountFactor()
    {
        var mail=new MfaMailbox{Fail=true};await using var factory=new CyTaskApiFactory(mfaPolicy:"required",mfaEmail:true,mfaMailer:mail);using var client=factory.CreateClient();
        using var response=await client.PostAsJsonAsync(new Uri("/api/v1/bootstrap",UriKind.Relative),CreateBootstrapRequest(),TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();var flow=(await ReadJsonAsync(response)).GetProperty("challenge");
        await MfaAdvanceAsync(client,flow,"method","email",expected:HttpStatusCode.ServiceUnavailable);
        await MfaAdvanceAsync(client,flow,"verify","email",mail.Codes[^1],HttpStatusCode.BadRequest);
        using var denied=await client.GetAsync(new Uri("/api/v1/projects",UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
    }
    [Fact]
    public void MfaConfigurationFailsClosed()
    {
        Assert.False(MfaService.ValidOptions(new(){MfaPolicy="required",MfaAuthenticatorEnabled=false}));
        Assert.False(MfaService.ValidOptions(new(){MfaPolicy="required"}));
        Assert.False(MfaService.ValidOptions(new(){UseInMemoryStore=true,MfaPolicy="optional",MfaEmailEnabled=true}));
        Assert.False(MfaService.ValidOptions(new(){UseInMemoryStore=true,MfaPolicy="optional",MfaEmailEnabled=true,SmtpHost="smtp.fixture.invalid",SmtpFrom="security@fixture.invalid",SmtpSecurity="None"}));
        Assert.True(MfaService.ValidOptions(new(){LocalMode=true,MfaPolicy="required"}));
    }
    private static async Task<JsonElement> MfaLoginAsync(HttpClient client)
    {
        using var response=await client.PostAsJsonAsync(new Uri("/api/v1/sessions",UriKind.Relative),new{email=MfaEmail,password=MfaPassword},TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();
        return (await ReadJsonAsync(response)).GetProperty("challenge");
    }
    [Fact]
    public async Task MfaRecoveryIsAtomicAcrossConcurrentLogins()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"required",clock:clock);using var owner=factory.CreateClient();
        var complete=await MfaEnrollAsync(owner,clock);var recovery=complete.GetProperty("recoveryCodes")[0].GetString();
        using var first=factory.CreateClient();using var second=factory.CreateClient();var a=await MfaLoginAsync(first);var b=await MfaLoginAsync(second);
        var results=await Task.WhenAll(first.PostAsJsonAsync(new Uri("/api/v1/auth/mfa/advance",UriKind.Relative),new{token=a.GetProperty("token").GetString(),operation="verify",method="recovery",code=recovery},TestContext.Current.CancellationToken),
            second.PostAsJsonAsync(new Uri("/api/v1/auth/mfa/advance",UriKind.Relative),new{token=b.GetProperty("token").GetString(),operation="verify",method="recovery",code=recovery},TestContext.Current.CancellationToken));
        Assert.Single(results,result=>result.StatusCode==HttpStatusCode.OK);Assert.Single(results,result=>result.StatusCode==HttpStatusCode.BadRequest);foreach(var result in results)result.Dispose();
    }
    [Fact]
    public async Task MfaBudgetsSurviveNewChallengesAndExpiredChallengesCannotGrantSessions()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"required",clock:clock);using var owner=factory.CreateClient();await MfaEnrollAsync(owner,clock);
        using var attacker=factory.CreateClient();
        for(var attempt=0;attempt<2;attempt++){
            var flow=await MfaLoginAsync(attacker);for(var index=0;index<5;index++)await MfaAdvanceAsync(attacker,flow,"verify","recovery","INVALID",HttpStatusCode.BadRequest);
        }
        using(var blocked=await attacker.PostAsJsonAsync(new Uri("/api/v1/sessions",UriKind.Relative),new{email=MfaEmail,password=MfaPassword},TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.TooManyRequests,blocked.StatusCode);
        clock.Advance(TimeSpan.FromMinutes(11));var expired=await MfaLoginAsync(attacker);clock.Advance(TimeSpan.FromMinutes(6));
        await MfaAdvanceAsync(attacker,expired,"verify","recovery","INVALID",HttpStatusCode.BadRequest);
        using var denied=await attacker.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
    }
    [Fact]
    public async Task MfaProofsFollowNativePkceAndInvalidateOlderNativeCredentials()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"required",clock:clock);using var owner=factory.CreateClient();var complete=await MfaEnrollAsync(owner,clock);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token",complete.GetProperty("session").GetProperty("csrfToken").GetString());
        var verifier=SessionSecurity.CreateToken();const string redirect="http://127.0.0.1:43829/cytask/oauth/callback";
        async Task<string> Authorize(){using var response=await owner.PostAsJsonAsync(new Uri("/api/v1/oauth/native/authorizations",UriKind.Relative),new{clientId="cytask-unreal",redirectUri=redirect,codeChallenge=NativeAuthorizationSecurity.ComputeCodeChallenge(verifier),codeChallengeMethod="S256",state=SessionSecurity.CreateToken()},TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();
            var callback=new Uri((await ReadJsonAsync(response)).GetProperty("redirectUri").GetString()!);return System.Web.HttpUtility.ParseQueryString(callback.Query)["code"]!;}
        Task<HttpResponseMessage> Exchange(string code)=>owner.PostAsync(new Uri("/api/v1/oauth/token",UriKind.Relative),new FormUrlEncodedContent(new Dictionary<string,string>{{"grant_type","authorization_code"},{"client_id","cytask-unreal"},{"redirect_uri",redirect},{"code",code},{"code_verifier",verifier}}),TestContext.Current.CancellationToken);
        var firstCode=await Authorize();using var exchanged=await Exchange(firstCode);exchanged.EnsureSuccessStatusCode();var access=(await ReadJsonAsync(exchanged)).GetProperty("access_token").GetString();
        using var native=factory.CreateClient();native.DefaultRequestHeaders.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",access);
        using(var me=await native.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken))me.EnsureSuccessStatusCode();
        var staleCode=await Authorize();
        using var management=await owner.PostAsJsonAsync(new Uri("/api/v1/account/mfa",UriKind.Relative),new{password=MfaPassword,action="recovery"},TestContext.Current.CancellationToken);management.EnsureSuccessStatusCode();
        var renewed=await MfaAdvanceAsync(owner,await ReadJsonAsync(management),"verify","recovery",complete.GetProperty("recoveryCodes")[0].GetString());
        Assert.Equal(10,renewed.GetProperty("recoveryCodes").GetArrayLength());
        using(var me=await native.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Unauthorized,me.StatusCode);
        using var stale=await Exchange(staleCode);Assert.Equal(HttpStatusCode.BadRequest,stale.StatusCode);
        using var revoked=await native.DeleteAsync(new Uri("/api/v1/oauth/token",UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.NoContent,revoked.StatusCode);
    }
    [Fact]
    public async Task DisablingOptionalLastFactorDoesNotResurrectOldSessions()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"optional",clock:clock);using var owner=factory.CreateClient();var csrf=await BootstrapAsync(owner);owner.DefaultRequestHeaders.Add("X-CSRF-Token",csrf);
        using var original=await owner.PostAsJsonAsync(new Uri("/api/v1/account/mfa",UriKind.Relative),new{password=MfaPassword,action="enable-totp"},TestContext.Current.CancellationToken);original.EnsureSuccessStatusCode();
        var flow=(await MfaAdvanceAsync(owner,await ReadJsonAsync(original),"method","totp")).GetProperty("challenge");var secret=flow.GetProperty("secret").GetString()!;
        var complete=await MfaAdvanceAsync(owner,flow,"verify","totp",Totp.Code(secret,clock.GetUtcNow().ToUnixTimeSeconds()/30));
        using var old=factory.CreateClient();var oldFlow=await MfaLoginAsync(old);await MfaAdvanceAsync(old,oldFlow,"verify","recovery",complete.GetProperty("recoveryCodes")[0].GetString());
        owner.DefaultRequestHeaders.Remove("X-CSRF-Token");owner.DefaultRequestHeaders.Add("X-CSRF-Token",complete.GetProperty("session").GetProperty("csrfToken").GetString());
        using var manage=await owner.PostAsJsonAsync(new Uri("/api/v1/account/mfa",UriKind.Relative),new{password=MfaPassword,action="disable-totp"},TestContext.Current.CancellationToken);manage.EnsureSuccessStatusCode();
        await MfaAdvanceAsync(owner,await ReadJsonAsync(manage),"verify","recovery",complete.GetProperty("recoveryCodes")[1].GetString());
        using var denied=await old.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        using var normal=factory.CreateClient();using var login=await normal.PostAsJsonAsync(new Uri("/api/v1/sessions",UriKind.Relative),new{email=MfaEmail,password=MfaPassword},TestContext.Current.CancellationToken);login.EnsureSuccessStatusCode();Assert.True((await ReadJsonAsync(login)).TryGetProperty("userId",out _));
    }
    [Fact]
    public void MfaEncryptionIsBoundToTheAccount()
    {
        var protector=new MfaSecretProtector(Microsoft.Extensions.Options.Options.Create(new CyTaskOptions{UseInMemoryStore=true}));var user=Guid.NewGuid();var value=protector.Protect(user,"Fictional setup material");
        Assert.Equal("Fictional setup material",protector.Unprotect(user,value));Assert.ThrowsAny<System.Security.Cryptography.CryptographicException>(()=>protector.Unprotect(Guid.NewGuid(),value));
    }
    private static async Task<JsonElement> MfaEnrollAsync(HttpClient client,MfaClock clock)
    {
        using var response=await client.PostAsJsonAsync(new Uri("/api/v1/bootstrap",UriKind.Relative),CreateBootstrapRequest(),TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();var flow=(await ReadJsonAsync(response)).GetProperty("challenge");
        flow=(await MfaAdvanceAsync(client,flow,"method","totp")).GetProperty("challenge");return await MfaAdvanceAsync(client,flow,"verify","totp",Totp.Code(flow.GetProperty("secret").GetString()!,clock.GetUtcNow().ToUnixTimeSeconds()/30));
    }
    private static async Task<JsonElement> MfaAdvanceAsync(HttpClient client,JsonElement challenge,string operation,string? method=null,string? code=null,HttpStatusCode expected=HttpStatusCode.OK)
    {
        using var response=await client.PostAsJsonAsync(new Uri("/api/v1/auth/mfa/advance",UriKind.Relative),new{token=challenge.GetProperty("token").GetString(),operation,method,code},TestContext.Current.CancellationToken);
        Assert.Equal(expected,response.StatusCode);return await ReadJsonAsync(response);
    }
    private static string MfaEmail=>JsonSerializer.SerializeToElement(CreateBootstrapRequest()).GetProperty("email").GetString()!;
    [Fact]
    public async Task RequiredMfaAlsoGatesInvitedMembers()
    {
        var clock=new MfaClock();await using var factory=new CyTaskApiFactory(mfaPolicy:"required",clock:clock);using var owner=factory.CreateClient();var session=await MfaEnrollAsync(owner,clock);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token",session.GetProperty("session").GetProperty("csrfToken").GetString());
        var invite=await PostAndReadAsync(owner,"/api/v1/invitations",new{email="mfa-member@fixture.invalid",role="member"});using var member=factory.CreateClient();
        using var accepted=await member.PostAsJsonAsync(new Uri("/api/v1/invitations/accept",UriKind.Relative),new{token=invite.GetProperty("token").GetString(),displayName="MFA fixture member",password=SessionSecurity.CreateToken()},TestContext.Current.CancellationToken);accepted.EnsureSuccessStatusCode();var flow=(await ReadJsonAsync(accepted)).GetProperty("challenge");
        using(var denied=await member.GetAsync(new Uri("/api/v1/projects",UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        flow=(await MfaAdvanceAsync(member,flow,"method","totp")).GetProperty("challenge");await MfaAdvanceAsync(member,flow,"verify","totp",Totp.Code(flow.GetProperty("secret").GetString()!,clock.GetUtcNow().ToUnixTimeSeconds()/30));
        using var me=await member.GetAsync(new Uri("/api/v1/me",UriKind.Relative),TestContext.Current.CancellationToken);me.EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task LocalSoloRemainsPasswordlessWithRequiredServerPolicy()
    {
        var root=Path.GetFullPath(Path.Combine(Path.GetTempPath(),"CyTask.MfaLocal.Tests"));var folder=Path.Combine(root,Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);
        try{
            await using var factory=new CyTaskApiFactory(localPath:folder,mfaPolicy:"required");using var client=factory.CreateClient();
            using var request=new HttpRequestMessage(HttpMethod.Post,"/api/v1/local/session");request.Headers.Add("X-CyTask-Local-Key",LocalAccessKey);
            using var opened=await client.SendAsync(request,TestContext.Current.CancellationToken);opened.EnsureSuccessStatusCode();Assert.True((await ReadJsonAsync(opened)).TryGetProperty("userId",out _));
            using var status=await client.GetAsync(new Uri("/api/v1/account/mfa",UriKind.Relative),TestContext.Current.CancellationToken);status.EnsureSuccessStatusCode();Assert.False((await ReadJsonAsync(status)).GetProperty("available").GetBoolean());
        }finally{if(Directory.Exists(folder)&&Path.GetFullPath(folder).StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))Directory.Delete(folder,true);}
    }
    [Fact]
    public async Task NullAuthenticationFieldsReturnClientErrors()
    {
        await using var factory=new CyTaskApiFactory();using var client=factory.CreateClient();
        using var bootstrap=await client.PostAsJsonAsync(new Uri("/api/v1/bootstrap",UriKind.Relative),new{email=(string?)null,displayName=(string?)null,password=(string?)null,organizationName=(string?)null},TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.BadRequest,bootstrap.StatusCode);
        using var login=await client.PostAsJsonAsync(new Uri("/api/v1/sessions",UriKind.Relative),new{email=(string?)null,password=(string?)null},TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.Unauthorized,login.StatusCode);
        using var advance=await client.PostAsJsonAsync(new Uri("/api/v1/auth/mfa/advance",UriKind.Relative),new{token=(string?)null,operation=(string?)null},TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.BadRequest,advance.StatusCode);
    }
    private static string MfaPassword=>JsonSerializer.SerializeToElement(CreateBootstrapRequest()).GetProperty("password").GetString()!;
    private sealed class MfaClock : TimeProvider
    {
        private DateTimeOffset _now=DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow()=>_now;
        public void Advance(TimeSpan interval)=>_now+=interval;
    }
    private sealed class MfaMailbox : IMfaMailer
    {
        public List<string> Codes { get; }=[];public bool Fail { get; init; }
        public Task SendAsync(string recipient,string code,CancellationToken cancellationToken){Codes.Add(code);return Fail?Task.FromException(new IOException("Synthetic delivery failure")):Task.CompletedTask;}
    }
}
