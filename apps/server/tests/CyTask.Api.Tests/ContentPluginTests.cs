using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CyTask.Api.LocalSync;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace CyTask.Api.Tests;
public sealed partial class CyTaskApiTests
{
    private static readonly string[] ContentFixtureAssets = ["/Game/Props/Chair"];
    [Fact]
    public async Task MessagePluginsValidateTargetsRevisionsAndActivation()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-CSRF-Token", await BootstrapAsync(client));
        var project = await PostAndReadAsync(client,"/api/v1/projects",new {name="Content extensions",key="CE"});
        var projectId = project.GetProperty("id").GetGuid();
        var channel = await PostAndReadAsync(client,$"/api/v1/projects/{projectId}/chat/channels",new {name="Review"});
        var message = await PostAndReadAsync(client,$"/api/v1/chat/channels/{channel.GetProperty("id").GetGuid()}/messages",new {body="Review this context"});
        var target = $"/api/v1/projects/{projectId}/content/message/{message.GetProperty("id").GetGuid()}/plugins/dev.cytask.unreal/context";
        using (var disabled=await client.GetAsync(new Uri(target,UriKind.Relative),TestContext.Current.CancellationToken)) Assert.Equal(HttpStatusCode.NotFound,disabled.StatusCode);
        await EnableFixturePluginAsync(client,projectId,"dev.cytask.unreal");
        using (var initial=await client.GetAsync(new Uri(target,UriKind.Relative),TestContext.Current.CancellationToken))
            Assert.Equal(0,(await ReadJsonAsync(initial)).GetProperty("revision").GetInt64());
        for(var revision=0;revision<2;revision++)
        {
            using var saved=await client.PutAsJsonAsync(new Uri(target,UriKind.Relative),new {data=new {mapPath="/Game/Maps/Review",notes=$"**Revision {revision+1}**",assetPaths=ContentFixtureAssets},expectedRevision=revision},TestContext.Current.CancellationToken);
            saved.EnsureSuccessStatusCode();Assert.Equal(revision+1,(await ReadJsonAsync(saved)).GetProperty("revision").GetInt64());
        }
        using (var stale=await client.PutAsJsonAsync(new Uri(target,UriKind.Relative),new {data=new{notes="stale"},expectedRevision=0},TestContext.Current.CancellationToken)) Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        using (var unknown=await client.PutAsJsonAsync(new Uri(target,UriKind.Relative),new {data=new{undeclared="value"},expectedRevision=2},TestContext.Current.CancellationToken)) Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
        var other=await PostAndReadAsync(client,"/api/v1/projects",new{name="Other",key="OTH"});
        await EnableFixturePluginAsync(client,other.GetProperty("id").GetGuid(),"dev.cytask.unreal");
        var group=await PostAndReadAsync(client,$"/api/v1/projects/{projectId}/chat/channels",new{name="Private review",channelType="group",memberIds=Array.Empty<Guid>()});
        var privateMessage=await PostAndReadAsync(client,$"/api/v1/chat/channels/{group.GetProperty("id").GetGuid()}/messages",new{body="Private review fixture"});
        using var outsider=factory.CreateClient();
        var invitation=await PostAndReadAsync(client,"/api/v1/invitations",new{email="plugin-outsider@fixture.invalid",role="member"});
        using var joined=await outsider.PostAsJsonAsync(new Uri("/api/v1/invitations/accept",UriKind.Relative),new{token=invitation.GetProperty("token").GetString(),displayName="Fixture outsider",password="Fictional plugin outsider password 93541"},TestContext.Current.CancellationToken);joined.EnsureSuccessStatusCode();
        using(var publicAccess=await outsider.GetAsync(new Uri(target,UriKind.Relative),TestContext.Current.CancellationToken))publicAccess.EnsureSuccessStatusCode();
        using(var privateAccess=await outsider.GetAsync(new Uri($"/api/v1/projects/{projectId}/content/message/{privateMessage.GetProperty("id").GetGuid()}/plugins/dev.cytask.unreal/context",UriKind.Relative),TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.NotFound,privateAccess.StatusCode);
        using (var wrongProject=await client.GetAsync(new Uri(target.Replace(projectId.ToString(),other.GetProperty("id").GetString(),StringComparison.Ordinal),UriKind.Relative),TestContext.Current.CancellationToken)) Assert.Equal(HttpStatusCode.NotFound,wrongProject.StatusCode);
        using var disable=await client.DeleteAsync(new Uri($"/api/v1/projects/{projectId}/plugins/dev.cytask.unreal",UriKind.Relative),TestContext.Current.CancellationToken);disable.EnsureSuccessStatusCode();
        using var hidden=await client.GetAsync(new Uri(target,UriKind.Relative),TestContext.Current.CancellationToken);Assert.Equal(HttpStatusCode.NotFound,hidden.StatusCode);
    }

    [Fact]
    public async Task SharedMediaAnnotationsPersistAndAreReadOnlyForProjectViewers()
    {
        var root=Path.Combine(Path.GetTempPath(),"CyTask.ContentPluginTests",Guid.NewGuid().ToString("N"));var device=Guid.NewGuid();
        string route="";
        try
        {
            await using(var factory=new CyTaskApiFactory(root,device))
            using(var client=factory.CreateClient())
            {
                client.DefaultRequestHeaders.Add("X-CSRF-Token",await BootstrapAsync(client));
                var project=await PostAndReadAsync(client,"/api/v1/projects",new{name="Shared annotations",key="SA"});var projectId=project.GetProperty("id").GetGuid();
                await EnableFixturePluginAsync(client,projectId,"dev.cytask.cyannota");
                var bytes=SinglePixelPng();var hash=Sha256(bytes);
                var upload=await PostAndReadAsync(client,$"/api/v1/projects/{projectId}/resource-uploads",new{fileName="fixture.png",contentType="image/png",sizeBytes=bytes.Length,sha256=hash});
                var uploadId=upload.GetProperty("id").GetGuid();
                using(var chunk=new HttpRequestMessage(HttpMethod.Put,$"/api/v1/resource-uploads/{uploadId}/chunks/0"))
                {chunk.Headers.Add("X-Chunk-SHA256",hash);chunk.Content=new ByteArrayContent(bytes);chunk.Content.Headers.ContentType=new("application/octet-stream");using var sent=await client.SendAsync(chunk,TestContext.Current.CancellationToken);sent.EnsureSuccessStatusCode();}
                using var completed=await client.PostAsync(new Uri($"/api/v1/resource-uploads/{uploadId}/complete",UriKind.Relative),null,TestContext.Current.CancellationToken);completed.EnsureSuccessStatusCode();
                var id=(await ReadJsonAsync(completed)).GetProperty("id").GetGuid();
                route=$"/api/v1/projects/{projectId}/content/resource/{id}/plugins/dev.cytask.cyannota/annotate";
                using(var saved=await client.PutAsJsonAsync(new Uri(route,UriKind.Relative),new{data=new{version=1,title="Preserved shared annotations",annotations=Array.Empty<object>(),image=new{src=$"cytask-attachment:{id}"}},expectedRevision=0},TestContext.Current.CancellationToken))saved.EnsureSuccessStatusCode();
                using(var source=await client.PutAsJsonAsync(new Uri(route,UriKind.Relative),new{data=new{version=1,annotations=Array.Empty<object>(),image=new{src="data:image/png;base64,forbidden"}},expectedRevision=1},TestContext.Current.CancellationToken)) Assert.Equal(HttpStatusCode.BadRequest,source.StatusCode);
                using var viewer=factory.CreateClient();
                var invite=await PostAndReadAsync(client,"/api/v1/invitations",new{email="content-viewer@fixture.invalid",role="member"});
                using var joined=await viewer.PostAsJsonAsync(new Uri("/api/v1/invitations/accept",UriKind.Relative),new{token=invite.GetProperty("token").GetString(),displayName="Fixture viewer",password="Fictional viewer password 94357"},TestContext.Current.CancellationToken);joined.EnsureSuccessStatusCode();
                var identity=await ReadJsonAsync(joined);viewer.DefaultRequestHeaders.Add("X-CSRF-Token",identity.GetProperty("csrfToken").GetString());
                var space=await ReadSpaceAsync(client,projectId);await SaveSpaceAsync(client,space with {Visibility="private",Members=[new(identity.GetProperty("userId").GetGuid(),"viewer")]});
                using(var allowed=await viewer.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken))allowed.EnsureSuccessStatusCode();
                using(var denied=await viewer.PutAsJsonAsync(new Uri(route,UriKind.Relative),new{data=new{version=1,annotations=Array.Empty<object>()},expectedRevision=1},TestContext.Current.CancellationToken))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
                await factory.Services.GetRequiredService<ILocalSyncService>().FlushAsync(TestContext.Current.CancellationToken);
            }
            await using var restarted=new CyTaskApiFactory(root,device);using var reader=restarted.CreateClient();await LoginAsync(reader);
            using var restored=await reader.GetAsync(new Uri(route,UriKind.Relative),TestContext.Current.CancellationToken);restored.EnsureSuccessStatusCode();var value=await ReadJsonAsync(restored);
            Assert.Equal(1,value.GetProperty("revision").GetInt64());Assert.Equal("Preserved shared annotations",value.GetProperty("data").GetProperty("title").GetString());
        }
        finally {if(Directory.Exists(root))Directory.Delete(root,true);}
    }
    private static async Task EnableFixturePluginAsync(HttpClient client,Guid projectId,string pluginId)
    {
        using var response=await client.PutAsync(new Uri($"/api/v1/projects/{projectId}/plugins/{pluginId}",UriKind.Relative),null,TestContext.Current.CancellationToken);response.EnsureSuccessStatusCode();
    }
}
