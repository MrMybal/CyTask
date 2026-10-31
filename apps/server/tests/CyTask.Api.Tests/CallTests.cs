using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using CyTask.Api.Collaboration;
using CyTask.Api.Configuration;
using Microsoft.AspNetCore.TestHost;
using Xunit;

namespace CyTask.Api.Tests;
public sealed partial class CyTaskApiTests
{
    [Fact]
    public void CallCredentialsAreScopedAndExpireWithoutReturningSharedSecret()
    {
        var secret=new string('x',40);var options=new CyTaskOptions{WebRtcTurnUrls=["turn:relay.example.invalid:3478?transport=udp"],WebRtcTurnSharedSecret=secret,WebRtcRelayOnly=true};
        var now=new DateTimeOffset(2026,1,1,12,0,0,TimeSpan.Zero);var organization=Guid.NewGuid();var user=Guid.NewGuid();var channel=Guid.NewGuid();
        Assert.True(CallConfiguration.ValidOptions(options));
        var first=CallConfiguration.Create(options,organization,user,channel,now);
        var next=CallConfiguration.Create(options,organization,user,Guid.NewGuid(),now);
        var server=Assert.Single(first.IceServers);
        Assert.Equal("relay",first.IceTransportPolicy);Assert.Equal(now.AddHours(1),first.CredentialsExpireAt);
        Assert.StartsWith($"{now.AddHours(1).ToUnixTimeSeconds()}:{organization:N}:{user:N}:",server.Username);
        Assert.Equal(20,Convert.FromBase64String(server.Credential!).Length);
        Assert.NotEqual(server.Credential,next.IceServers[0].Credential);
        Assert.DoesNotContain(secret,JsonSerializer.Serialize(first),StringComparison.Ordinal);
        Assert.False(CallConfiguration.ValidOptions(new(){WebRtcRelayOnly=true}));
        Assert.False(CallConfiguration.ValidOptions(new(){WebRtcTurnUrls=["turn:relay.example.invalid"],WebRtcTurnSharedSecret="short"}));
    }
    [Theory]
    [InlineData("https://stun.example.invalid")]
    [InlineData("stun://stun.example.invalid")]
    [InlineData("stun:user@stun.example.invalid")]
    [InlineData("stun:stun.example.invalid:99999")]
    [InlineData("stun:stun.example.invalid/path")]
    [InlineData("stun:stun.example.invalid?transport=udp")]
    public void InvalidIceUrlsAreRejected(string url)=>Assert.False(CallConfiguration.ValidOptions(new(){WebRtcStunUrls=[url]}));

    [Theory]
    [InlineData("http://cytask.example.invalid")]
    [InlineData("https://user:password@cytask.example.invalid")]
    [InlineData("https://cytask.example.invalid/path")]
    [InlineData("https://cytask.example.invalid/?query=1")]
    [InlineData("https://cytask.example.invalid/#fragment")]
    public void InvalidCallPublicOriginsAreRejected(string origin)=>Assert.False(CallConfiguration.ValidOptions(new(){WebRtcPublicOrigin=origin}));

    [Fact]
    public async Task CallOriginSupportsExplicitTlsProxyWithoutTrustingForwardedHeaders()
    {
        const string origin="https://cytask.example.invalid";
        await using var factory=new CyTaskApiFactory(webRtcPublicOrigin:origin);using var client=factory.CreateClient();
        var auth=await CallFixtureAuthAsync(client);client.DefaultRequestHeaders.Add("X-CSRF-Token",auth.Csrf);
        var project=await PostAndReadAsync(client,"/api/v1/projects",new{name="TLS call",key="TLS"});
        var channel=await PostAndReadAsync(client,$"/api/v1/projects/{project.GetProperty("id").GetGuid()}/chat/channels",new{name="TLS"});
        var id=channel.GetProperty("id").GetGuid();
        using var socket=await ConnectCallAsync(factory,id,auth.Cookie,origin);Assert.Equal("presence",(await ReadCallSignalAsync(socket)).GetProperty("type").GetString());
        var rejected=await Record.ExceptionAsync(()=>ConnectCallAsync(factory,id,auth.Cookie));
        Assert.IsType<InvalidOperationException>(rejected);Assert.Contains("403",rejected.Message,StringComparison.Ordinal);
    }

    [Fact]
    public async Task CallSignalingDistinguishesTabsAndAcceptsFragmentedMessages()
    {
        await using var factory=new CyTaskApiFactory();using var client=factory.CreateClient();
        var auth=await CallFixtureAuthAsync(client);client.DefaultRequestHeaders.Add("X-CSRF-Token",auth.Csrf);
        var project=await PostAndReadAsync(client,"/api/v1/projects",new{name="Call protocol",key="CP"});
        var channel=await PostAndReadAsync(client,$"/api/v1/projects/{project.GetProperty("id").GetGuid()}/chat/channels",new{name="Call"});var id=channel.GetProperty("id").GetGuid();
        using var first=await ConnectCallAsync(factory,id,auth.Cookie);var firstPresence=await ReadCallSignalAsync(first);var firstId=firstPresence.GetProperty("peerId").GetGuid();
        using var second=await ConnectCallAsync(factory,id,auth.Cookie);var secondPresence=await ReadCallSignalAsync(second);var secondId=secondPresence.GetProperty("peerId").GetGuid();
        Assert.NotEqual(firstId,secondId);Assert.Equal(firstId,Assert.Single(secondPresence.GetProperty("peers").EnumerateArray()).GetProperty("peerId").GetGuid());
        Assert.Equal("peer.joined",(await ReadCallSignalAsync(first)).GetProperty("type").GetString());
        var bytes=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{type="offer",sender=Guid.NewGuid(),target=secondId,payload=new{type="offer",sdp="v=0\r\n"}}));
        await first.SendAsync(new ArraySegment<byte>(bytes,0,10),WebSocketMessageType.Text,false,TestContext.Current.CancellationToken);
        await first.SendAsync(new ArraySegment<byte>(bytes,10,bytes.Length-10),WebSocketMessageType.Text,true,TestContext.Current.CancellationToken);
        var relayed=await ReadCallSignalAsync(second);Assert.Equal(firstId,relayed.GetProperty("sender").GetGuid());
        await SendCallSignalAsync(first,new{type="media-state",state=new{muted=false,camera=true,screen=true}});
        Assert.True((await ReadCallSignalAsync(second)).GetProperty("state").GetProperty("screen").GetBoolean());
        await first.SendAsync(Encoding.UTF8.GetBytes("{"),WebSocketMessageType.Text,true,TestContext.Current.CancellationToken);
        var closed=await first.ReceiveAsync(new ArraySegment<byte>(new byte[1024]),TestContext.Current.CancellationToken);
        Assert.Equal(WebSocketCloseStatus.InvalidPayloadData,closed.CloseStatus);
        Assert.Equal(firstId,(await ReadCallSignalAsync(second)).GetProperty("peerId").GetGuid());
    }

    [Fact]
    public async Task CallCapacityAndSessionRevocationAreEnforced()
    {
        await using var factory=new CyTaskApiFactory(callMaxParticipants:2,callAccessCheckSeconds:1);using var client=factory.CreateClient();
        var auth=await CallFixtureAuthAsync(client);client.DefaultRequestHeaders.Add("X-CSRF-Token",auth.Csrf);
        var project=await PostAndReadAsync(client,"/api/v1/projects",new{name="Call access",key="CA"});
        var channel=await PostAndReadAsync(client,$"/api/v1/projects/{project.GetProperty("id").GetGuid()}/chat/channels",new{name="Call"});var id=channel.GetProperty("id").GetGuid();
        using var first=await ConnectCallAsync(factory,id,auth.Cookie);await ReadCallSignalAsync(first);
        using var second=await ConnectCallAsync(factory,id,auth.Cookie);await ReadCallSignalAsync(second);await ReadCallSignalAsync(first);
        using var third=await ConnectCallAsync(factory,id,auth.Cookie);
        var full=await third.ReceiveAsync(new ArraySegment<byte>(new byte[1024]),TestContext.Current.CancellationToken);Assert.Equal(WebSocketCloseStatus.PolicyViolation,full.CloseStatus);Assert.Equal("Room is full",full.CloseStatusDescription);
        using var loggedOut=await client.DeleteAsync(new Uri("/api/v1/session",UriKind.Relative),TestContext.Current.CancellationToken);loggedOut.EnsureSuccessStatusCode();
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var interrupted=false;
        try { var end=await first.ReceiveAsync(new ArraySegment<byte>(new byte[1024]),timeout.Token);Assert.Equal(WebSocketMessageType.Close,end.MessageType);interrupted=true; }
        catch(WebSocketException) { interrupted=true; }
        catch(IOException) { interrupted=true; } // TestHost keeps State=Open after a remote transport abort.
        Assert.False(timeout.IsCancellationRequested);
        Assert.True(interrupted);
    }

    [Fact]
    public async Task CallConfigurationRequiresMembershipWritableRoleAndBrowserSession()
    {
        await using var factory=new CyTaskApiFactory();using var owner=factory.CreateClient();
        var auth=await CallFixtureAuthAsync(owner);owner.DefaultRequestHeaders.Add("X-CSRF-Token",auth.Csrf);
        var project=await PostAndReadAsync(owner,"/api/v1/projects",new{name="Call roles",key="CR"});var projectId=project.GetProperty("id").GetGuid();
        var channel=await PostAndReadAsync(owner,$"/api/v1/projects/{projectId}/chat/channels",new{name="Private",channelType="group",memberIds=Array.Empty<Guid>()});
        var route=$"/api/v1/chat/channels/{channel.GetProperty("id").GetGuid()}/call";
        using(var config=await owner.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken)){config.EnsureSuccessStatusCode();Assert.Equal("no-store",config.Headers.CacheControl!.ToString());Assert.Empty((await ReadJsonAsync(config)).GetProperty("iceServers").EnumerateArray());}
        var wrongOrigin=await Record.ExceptionAsync(()=>ConnectCallAsync(factory,channel.GetProperty("id").GetGuid(),auth.Cookie,"https://outside.example.invalid"));
        Assert.IsType<InvalidOperationException>(wrongOrigin);Assert.Contains("403",wrongOrigin.Message,StringComparison.Ordinal);
        var token=await PostAndReadAsync(owner,"/api/v1/tokens",new{name="Call access fixture",scope="write"});
        using var bearer=factory.CreateClient();bearer.DefaultRequestHeaders.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",token.GetProperty("secret").GetString());
        using(var denied=await bearer.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        using var anonymous=factory.CreateClient();using(var denied=await anonymous.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);
        using var member=factory.CreateClient();var invitation=await PostAndReadAsync(owner,"/api/v1/invitations",new{email="call-member@fixture.invalid",role="member"});
        using var accepted=await member.PostAsJsonAsync(new Uri("/api/v1/invitations/accept",UriKind.Relative),new{token=invitation.GetProperty("token").GetString(),displayName="Call member",password="Fictional call member password 424392"},TestContext.Current.CancellationToken);accepted.EnsureSuccessStatusCode();
        var identity=await ReadJsonAsync(accepted);
        var memberCookie=string.Join("; ",accepted.Headers.GetValues("Set-Cookie").Select(value=>value.Split(';')[0]));
        using(var denied=await member.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);
        var privateSignal=await Record.ExceptionAsync(()=>ConnectCallAsync(factory,channel.GetProperty("id").GetGuid(),memberCookie));
        Assert.IsType<InvalidOperationException>(privateSignal);Assert.Contains("404",privateSignal.Message,StringComparison.Ordinal);
        var publicChannel=await PostAndReadAsync(owner,$"/api/v1/projects/{projectId}/chat/channels",new{name="Public"});route=$"/api/v1/chat/channels/{publicChannel.GetProperty("id").GetGuid()}/call";
        var space=await ReadSpaceAsync(owner,projectId);await SaveSpaceAsync(owner,space with{Members=[new(identity.GetProperty("userId").GetGuid(),"viewer")]});
        using var viewer=await member.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.Forbidden,viewer.StatusCode);
        var viewerSignal=await Record.ExceptionAsync(()=>ConnectCallAsync(factory,publicChannel.GetProperty("id").GetGuid(),memberCookie));
        Assert.IsType<InvalidOperationException>(viewerSignal);Assert.Contains("403",viewerSignal.Message,StringComparison.Ordinal);
    }
    private static async Task<(string Cookie,string Csrf)> CallFixtureAuthAsync(HttpClient client)
    {
        using var response=await client.PostAsJsonAsync(new Uri("/api/v1/bootstrap",UriKind.Relative),CreateBootstrapRequest(),TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();
        return (string.Join("; ",response.Headers.GetValues("Set-Cookie").Select(value=>value.Split(';')[0])),(await ReadJsonAsync(response)).GetProperty("csrfToken").GetString()!);
    }
    private static Task<WebSocket> ConnectCallAsync(CyTaskApiFactory factory,Guid channelId,string cookie,string origin="http://localhost")
    {
        var client=factory.Server.CreateWebSocketClient();client.ConfigureRequest=request=>{request.Headers.Cookie=cookie;request.Headers.Origin=origin;};
        return client.ConnectAsync(new Uri($"ws://localhost/api/v1/chat/channels/{channelId}/signal"),TestContext.Current.CancellationToken);
    }
    private static async Task<JsonElement> ReadCallSignalAsync(WebSocket socket)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var buffer=new byte[65536];var received=await socket.ReceiveAsync(new ArraySegment<byte>(buffer),timeout.Token);Assert.Equal(WebSocketMessageType.Text,received.MessageType);
        using var document=JsonDocument.Parse(buffer.AsMemory(0,received.Count));return document.RootElement.Clone();
    }
    private static Task SendCallSignalAsync(WebSocket socket,object message)=>socket.SendAsync(new ArraySegment<byte>(JsonSerializer.SerializeToUtf8Bytes(message)),WebSocketMessageType.Text,true,TestContext.Current.CancellationToken);
}
