using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using CyTask.Api.Configuration;
using CyTask.Api.Domain;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Security;

public sealed record MfaView(string Token,string Stage,string Action,string[] Methods,DateTimeOffset ExpiresAt,
    string? Secret=null,string? ProvisioningUri=null,string? Destination=null,DateTimeOffset? ResendAt=null);
public sealed record MfaAdvance(MfaView? Challenge,Guid UserId=default,[property:JsonIgnore]string? Grant=null,string[]? RecoveryCodes=null,
    [property:JsonIgnore]string? MailCode=null,[property:JsonIgnore]string? Recipient=null);
public sealed record MfaStatus(bool Available,string Policy,bool AuthenticatorAllowed,bool EmailAllowed,
    bool AuthenticatorConfigured,bool EmailConfigured,int RecoveryCodesRemaining);
public sealed class MfaException(int status,string message) : Exception(message) { public int Status { get; }=status; }

public sealed class MfaService(IMfaStore store,MfaSecretProtector protector,IMfaMailer mailer,
    IOptions<CyTaskOptions> options,TimeProvider time)
{
    private CyTaskOptions Options=>options.Value;
    public bool Enabled=>!Options.LocalMode&&Options.MfaPolicy!="disabled";
    private DateTimeOffset Now=>time.GetUtcNow();
    private static string Hash(string value)=>Convert.ToHexString(SessionSecurity.HashToken(value));
    private bool Usable(MfaAccount state)=>(Options.MfaAuthenticatorEnabled&&state.TotpSecret is not null)||(Options.MfaEmailEnabled&&state.EmailEnabled);
    private bool NeedsProof(MfaAccount state)=>state.Version>0||state.Enrolled||Options.MfaPolicy=="required";
    private bool Allowed(MfaAccount state,byte[] credential)
    {
        if((state.Enrolled||Options.MfaPolicy=="required")&&!Usable(state))return false;
        return !NeedsProof(state)||(state.Proofs.TryGetValue("session/"+Convert.ToHexString(credential),out var proof)&&proof.Version==state.Version&&proof.ExpiresAt>Now);
    }
    public static bool ValidOptions(CyTaskOptions value)
    {
        if(value.MfaPolicy is not ("disabled" or "optional" or "required")||value.MfaIssuer.Length is <1 or >64||value.MfaIssuer.Any(char.IsControl)||value.MfaIssuer.Contains(':'))return false;
        if(!string.IsNullOrEmpty(value.MfaEncryptionKey)&&!MfaSecretProtector.ValidKey(value.MfaEncryptionKey))return false;
        if(value.MfaPolicy=="disabled"||value.LocalMode)return true;
        if(!value.MfaAuthenticatorEnabled&&!value.MfaEmailEnabled)return false;
        if(!value.UseInMemoryStore&&!MfaSecretProtector.ValidKey(value.MfaEncryptionKey))return false;
        return !value.MfaEmailEnabled||(value.SmtpHost is {Length:>0 and <=253}&&Uri.CheckHostName(value.SmtpHost)!=UriHostNameType.Unknown
            &&value.SmtpPort is >=1 and <=65535&&value.SmtpSecurity is "StartTls" or "SslOnConnect"
            &&SessionSecurity.IsValidEmail(value.SmtpFrom??"")&&string.IsNullOrEmpty(value.SmtpUsername)==string.IsNullOrEmpty(value.SmtpPassword));
    }
    public async Task<bool> CredentialAllowedAsync(Guid userId,byte[] hash,CancellationToken cancellationToken)
    {
        if(!Enabled)return true;var state=await store.ReadAsync(userId,cancellationToken)??new();return Allowed(state,hash);
    }
    public async Task<bool> ContextAllowedAsync(HttpContext context,CancellationToken cancellationToken)
    {
        if(!Enabled||context.GetTokenScopes() is not null)return true;
        var user=context.GetUser();if(user is null||user.SessionExpiresAt<=Now)return false;
        return CredentialHash(context) is { } hash&&await CredentialAllowedAsync(user.UserId,hash,cancellationToken);
    }
    public byte[]? CredentialHash(HttpContext context)
    {
        if(context.Items.TryGetValue(SessionSecurity.AccessTokenHashItem,out var value)&&value is byte[] hash)return hash;
        var cookie=context.Request.Cookies[SessionSecurity.SessionCookie(context.RequestServices.GetRequiredService<IHostEnvironment>(),Options.LocalMode)];
        return string.IsNullOrEmpty(cookie)?null:SessionSecurity.HashToken(cookie);
    }
    public async Task<MfaStatus> StatusAsync(Guid userId,CancellationToken cancellationToken)
    {
        var state=Enabled?await store.ReadAsync(userId,cancellationToken):null;
        return new(Enabled,Options.LocalMode?"local":Options.MfaPolicy,Enabled&&Options.MfaAuthenticatorEnabled,Enabled&&Options.MfaEmailEnabled,
            state?.TotpSecret is not null,state?.EmailEnabled??false,state?.RecoveryHashes.Count??0);
    }
    public async Task<MfaView?> StartLoginAsync(UserAccount user,CancellationToken cancellationToken)
    {
        if(!Enabled)return null;var state=await store.ReadAsync(user.Id,cancellationToken);
        if(Options.MfaPolicy!="required"&&state?.Enrolled!=true)return null;
        return await StartAsync(user,"login",cancellationToken);
    }
    public async Task<MfaView> StartAsync(UserAccount user,string action,CancellationToken cancellationToken)
    {
        if(!Enabled)throw new MfaException(409,"Two-factor authentication is disabled on this server.");
        if(action is not ("login" or "enable-totp" or "enable-email" or "disable-totp" or "disable-email" or "recovery"))throw new MfaException(400,"Invalid security action.");
        if(action=="enable-totp"&&!Options.MfaAuthenticatorEnabled||action=="enable-email"&&!Options.MfaEmailEnabled)throw new MfaException(409,"This authentication method is unavailable.");
        var token=$"{user.Id:N}.{SessionSecurity.CreateToken()}";
        return await store.UpdateAsync(user.Id,state=>{
            Prune(state);CheckBudget(state);
            if(state.Challenges.Count>=3)throw new MfaException(429,"Too many pending verifications. Wait a few minutes.");
            if(!state.Enrolled&&action is "disable-totp" or "disable-email" or "recovery")throw new MfaException(409,"No second factor is configured.");
            if(Options.MfaPolicy=="required"&&(action=="disable-totp"&&!(Options.MfaEmailEnabled&&state.EmailEnabled)
                ||action=="disable-email"&&!(Options.MfaAuthenticatorEnabled&&state.TotpSecret is not null)))throw new MfaException(409,"Server policy requires at least one enabled second factor.");
            var challenge=new MfaChallenge{Action=action,Email=user.Email,Version=state.Version,ExpiresAt=Now.AddMinutes(5),Stage=state.Enrolled?"verify":"choose"};
            state.Challenges[Hash(token)]=challenge;return View(user.Id,token,state,challenge);
        },cancellationToken);
    }
    public async Task<MfaView?> PendingAsync(string? token,CancellationToken cancellationToken)
    {
        if(!Enabled||!Parse(token,out var id))return null;var state=await store.ReadAsync(id,cancellationToken);
        if(state is null||!state.Challenges.TryGetValue(Hash(token!),out var challenge)||challenge.ExpiresAt<=Now||challenge.Version!=state.Version)return null;
        return View(id,token!,state,challenge);
    }
    public async Task CancelAsync(string token,CancellationToken cancellationToken)
    {
        if(!Parse(token,out var id)||await store.ReadAsync(id,cancellationToken) is null)return;
        await store.UpdateAsync(id,state=>state.Challenges.Remove(Hash(token)),cancellationToken);
    }
    public async Task<MfaAdvance> AdvanceAsync(string token,string operation,string? method,string? code,CancellationToken cancellationToken)
    {
        if(!Enabled||!Parse(token,out var id)||await store.ReadAsync(id,cancellationToken) is null)throw Invalid();
        var result=await store.UpdateAsync(id,state=>{
            Prune(state);CheckBudget(state);
            if(!state.Challenges.TryGetValue(Hash(token),out var challenge)||challenge.Version!=state.Version)throw Invalid();
            if(operation=="method"){
                if(challenge.Stage!="choose"||method is not ("totp" or "email")||!SetupMethods(challenge).Contains(method,StringComparer.Ordinal))throw Invalid();
                challenge.SetupMethod=method;challenge.EmailHash=null;
                if(method=="totp"){
                    challenge.PendingSecret=protector.Protect(id,Totp.NewSecret());challenge.Stage="totp";
                    return new MfaAdvance(View(id,token,state,challenge));
                }
                challenge.Stage="email";return PrepareEmail(id,token,state,challenge,"setup");
            }
            if(operation=="email"){
                if(!Options.MfaEmailEnabled||challenge.Stage is not ("email" or "verify")||challenge.Stage=="verify"&&!state.EmailEnabled)throw Invalid();
                return PrepareEmail(id,token,state,challenge,challenge.Stage=="verify"?"verify":"setup");
            }
            if(operation!="verify"||code is null||code.Length>80)throw Invalid();
            var verified=false;
            if(challenge.Stage=="verify"){
                if(method=="totp"&&Options.MfaAuthenticatorEnabled&&state.TotpSecret is not null){
                    var step=Totp.Match(protector.Unprotect(id,state.TotpSecret),code,Now,state.LastTotpStep);
                    if(step is not null){state.LastTotpStep=step.Value;verified=true;}
                }else if(method=="email"&&Options.MfaEmailEnabled&&state.EmailEnabled)verified=CheckEmail(id,token,challenge,code,"verify");
                else if(method=="recovery"){
                    var normalized=code.Replace("-","",StringComparison.Ordinal).Replace(" ","",StringComparison.Ordinal).ToUpperInvariant();
                    var digest=Hash(normalized);var found=state.RecoveryHashes.FindIndex(hash=>Fixed(hash,digest));
                    if(found>=0){state.RecoveryHashes.RemoveAt(found);verified=true;}
                }
            }else if(challenge.Stage=="totp"&&method=="totp"&&challenge.PendingSecret is not null){
                var step=Totp.Match(protector.Unprotect(id,challenge.PendingSecret),code,Now,-1);
                if(step is not null){state.TotpSecret=challenge.PendingSecret;state.LastTotpStep=step.Value;verified=true;}
            }else if(challenge.Stage=="email"&&method=="email"&&CheckEmail(id,token,challenge,code,"setup")){state.EmailEnabled=true;verified=true;}
            if(!verified){
                if(Now-state.FailureWindow>=TimeSpan.FromMinutes(10)){state.Failures=0;state.FailureWindow=Now;}
                state.Failures++;challenge.Attempts++;if(challenge.Attempts>=5)state.Challenges.Remove(Hash(token));
                return new MfaAdvance(null); // Persist failure budgets before returning the generic error.
            }
            state.Failures=0;state.FailureWindow=Now;
            if(challenge.Stage=="verify"){
                if(challenge.Action is "enable-totp" or "enable-email"||challenge.Action=="login"&&!Usable(state)){
                    challenge.Stage="choose";challenge.EmailHash=null;return new MfaAdvance(View(id,token,state,challenge));
                }
                if(challenge.Action=="login")return Complete(id,token,state,null);
                if(challenge.Action=="disable-totp"){
                    if(Options.MfaPolicy=="required"&&!(state.EmailEnabled&&Options.MfaEmailEnabled))throw new MfaException(409,"Server policy requires at least one enabled second factor.");
                    state.TotpSecret=null;state.LastTotpStep=-1;
                }else if(challenge.Action=="disable-email"){
                    if(Options.MfaPolicy=="required"&&!(state.TotpSecret is not null&&Options.MfaAuthenticatorEnabled))throw new MfaException(409,"Server policy requires at least one enabled second factor.");
                    state.EmailEnabled=false;
                }
            }
            // Changing factors or backup codes invalidates every previous proof.
            state.Version++;state.Proofs.Clear();state.Challenges.Clear();
            string[]? codes=null;
            if(state.Enrolled){codes=Enumerable.Range(0,10).Select(_=>Convert.ToHexString(RandomNumberGenerator.GetBytes(16))).ToArray();
                state.RecoveryHashes=codes.Select(Hash).ToList();codes=codes.Select(value=>string.Join('-',Enumerable.Range(0,8).Select(index=>value.Substring(index*4,4)))).ToArray();
            }else state.RecoveryHashes.Clear();
            return Complete(id,token,state,codes);
        },cancellationToken);
        if(result.Challenge is null&&result.Grant is null)throw Invalid();
        if(result.MailCode is not null){
            try{await mailer.SendAsync(result.Recipient!,result.MailCode,cancellationToken);}
            catch(Exception exception) when(exception is not OutOfMemoryException){
                await store.UpdateAsync(id,state=>{if(state.Challenges.TryGetValue(Hash(token),out var challenge)&&challenge.EmailHash==protector.Digest(id,token+":"+result.MailCode)){challenge.EmailHash=null;challenge.EmailExpiresAt=null;}return true;},CancellationToken.None);
                throw new MfaException(503,"The verification email could not be delivered. Try again later.");
            }
        }
        return result;
    }
    private MfaAdvance PrepareEmail(Guid id,string token,MfaAccount state,MfaChallenge challenge,string purpose)
    {
        if(state.LastEmailAt is { } sent&&Now-sent<TimeSpan.FromSeconds(60))throw new MfaException(429,"Wait 60 seconds before requesting another email.");
        var code=RandomNumberGenerator.GetInt32(1_000_000).ToString("D6",CultureInfo.InvariantCulture);
        state.LastEmailAt=Now;challenge.EmailHash=protector.Digest(id,token+":"+code);challenge.EmailPurpose=purpose;
        challenge.EmailExpiresAt=Now.AddMinutes(5);if(challenge.EmailExpiresAt>challenge.ExpiresAt)challenge.EmailExpiresAt=challenge.ExpiresAt;
        return new(View(id,token,state,challenge),MailCode:code,Recipient:challenge.Email);
    }
    private bool CheckEmail(Guid id,string token,MfaChallenge challenge,string code,string purpose)
    {
        if(code.Length!=6||code.Any(character=>character is <'0' or >'9')||challenge.EmailPurpose!=purpose||challenge.EmailExpiresAt is not { } expires||expires<=Now||challenge.EmailHash is null||!Fixed(challenge.EmailHash,protector.Digest(id,token+":"+code)))return false;
        challenge.EmailHash=null;challenge.EmailExpiresAt=null;return true;
    }
    private MfaAdvance Complete(Guid id,string token,MfaAccount state,string[]? codes)
    {
        state.Challenges.Remove(Hash(token));var grant=SessionSecurity.CreateToken();state.Proofs["grant/"+Hash(grant)]=new(state.Version,Now.AddSeconds(30));
        return new(null,id,grant,codes);
    }
    public async Task<bool> CompleteSessionAsync(Guid id,string grant,byte[] credential,DateTimeOffset expires,CancellationToken cancellationToken)=>
        await store.UpdateAsync(id,state=>{
            Prune(state);if(!state.Proofs.Remove("grant/"+Hash(grant),out var proof)||proof.Version!=state.Version||proof.ExpiresAt<=Now)return false;
            state.Proofs["session/"+Convert.ToHexString(credential)]=new(state.Version,expires);return true;
        },cancellationToken);
    public async Task<bool> ProvePasswordSessionAsync(Guid id,byte[] credential,DateTimeOffset expires,CancellationToken cancellationToken)
    {
        if(!Enabled)return true;
        return await store.UpdateAsync(id,state=>{
            if(state.Enrolled||Options.MfaPolicy=="required")return false;Prune(state);
            state.Proofs["session/"+Convert.ToHexString(credential)]=new(state.Version,expires);return true;
        },cancellationToken);
    }
    public async Task RevokeProofAsync(Guid userId,byte[] credential,CancellationToken cancellationToken)
    {
        if(Enabled&&await store.ReadAsync(userId,cancellationToken) is not null)
            await store.UpdateAsync(userId,state=>state.Proofs.Remove("session/"+Convert.ToHexString(credential)),cancellationToken);
    }
    public async Task<bool> AuthorizeNativeAsync(HttpContext context,byte[] code,DateTimeOffset expires,CancellationToken cancellationToken)
    {
        if(!Enabled)return true;var user=context.GetUser()!;var credential=CredentialHash(context);
        return await store.UpdateAsync(user.UserId,state=>{
            if(credential is null||!Allowed(state,credential))return false;Prune(state);
            state.Proofs["code/"+Convert.ToHexString(code)]=new(state.Version,expires);return true;
        },cancellationToken);
    }
    public async Task<bool> RedeemNativeAsync(Guid userId,byte[] code,byte[] credential,DateTimeOffset expires,CancellationToken cancellationToken)
    {
        if(!Enabled)return true;
        return await store.UpdateAsync(userId,state=>{
            Prune(state);var found=state.Proofs.Remove("code/"+Convert.ToHexString(code),out var proof);
            if(found?(proof!.Version!=state.Version||proof.ExpiresAt<=Now):NeedsProof(state))return false;
            if((state.Enrolled||Options.MfaPolicy=="required")&&!Usable(state))return false;
            state.Proofs["session/"+Convert.ToHexString(credential)]=new(state.Version,expires);return true;
        },cancellationToken);
    }
    private MfaView View(Guid id,string token,MfaAccount state,MfaChallenge challenge)
    {
        var methods=challenge.Stage=="verify"?Methods(state):challenge.Stage=="choose"?SetupMethods(challenge):[challenge.Stage=="totp"?"totp":"email"];
        var secret=challenge.Stage=="totp"&&challenge.PendingSecret is not null?protector.Unprotect(id,challenge.PendingSecret):null;
        var uri=secret is null?null:$"otpauth://totp/{Uri.EscapeDataString(Options.MfaIssuer)}:{Uri.EscapeDataString(challenge.Email)}?secret={secret}&issuer={Uri.EscapeDataString(Options.MfaIssuer)}&algorithm=SHA1&digits=6&period=30";
        var at=challenge.Email.IndexOf('@');var destination=at>0?challenge.Email[..1]+"***"+challenge.Email[at..]:"***";
        return new(token,challenge.Stage,challenge.Action,methods,challenge.ExpiresAt,secret,uri,destination,state.LastEmailAt?.AddSeconds(60));
    }
    private string[] Methods(MfaAccount state)
    {
        var methods=new List<string>();if(Options.MfaAuthenticatorEnabled&&state.TotpSecret is not null)methods.Add("totp");
        if(Options.MfaEmailEnabled&&state.EmailEnabled)methods.Add("email");if(state.RecoveryHashes.Count>0)methods.Add("recovery");return methods.ToArray();
    }
    private string[] SetupMethods(MfaChallenge challenge)
    {
        var methods=new List<string>();if(Options.MfaAuthenticatorEnabled&&challenge.Action!="enable-email")methods.Add("totp");
        if(Options.MfaEmailEnabled&&challenge.Action!="enable-totp")methods.Add("email");return methods.ToArray();
    }
    private void Prune(MfaAccount state)
    {
        foreach(var key in state.Challenges.Where(item=>item.Value.ExpiresAt<=Now||item.Value.Version!=state.Version).Select(item=>item.Key).ToArray())state.Challenges.Remove(key);
        foreach(var key in state.Proofs.Where(item=>item.Value.ExpiresAt<=Now||item.Value.Version!=state.Version).Select(item=>item.Key).ToArray())state.Proofs.Remove(key);
        while(state.Proofs.Count>256)state.Proofs.Remove(state.Proofs.MinBy(item=>item.Value.ExpiresAt).Key);
    }
    private void CheckBudget(MfaAccount state){if(state.Failures>=10&&Now-state.FailureWindow<TimeSpan.FromMinutes(10))throw new MfaException(429,"Too many failed verifications. Wait ten minutes before trying again.");}
    private static bool Fixed(string first,string second)=>CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(first),System.Text.Encoding.UTF8.GetBytes(second));
    public static bool Parse(string? token,out Guid id){id=Guid.Empty;return token is {Length:76}&&token[32]=='.'&&Guid.TryParseExact(token[..32],"N",out id)&&token[33..].All(character=>char.IsAsciiLetterOrDigit(character)||character is '-' or '_');}
    private static MfaException Invalid()=>new(400,"The verification code is invalid, expired or already used.");
}
