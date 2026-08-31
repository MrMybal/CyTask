using CyTask.Api.Security;

namespace CyTask.Api.Migrations;

public static class MigrationEndpoints
{
    public static RouteGroupBuilder MapMigrationEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/migrations/capabilities", () => Results.Ok(new
        {
            sources = new[]
            {
                new { id = "clickup", name = "ClickUp", container = "list" },
                new { id = "jira", name = "Jira Cloud", container = "project" }
            },
            maximumItems = 2000,
            previewLifetimeMinutes = 30,
            credentialsStored = false
        }));

        group.MapPost("/migrations/analyze", AnalyzeAsync)
            .RequireRateLimiting("migration")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        group.MapPost("/migrations/{previewId:guid}/import", ImportAsync)
            .RequireRateLimiting("migration")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        return group;
    }

    private static async Task<IResult> AnalyzeAsync(
        MigrationAnalyzeRequest request,
        HttpContext context,
        MigrationService service,
        CancellationToken cancellationToken)
    {
        try
        {
            var user = context.GetUser()!;
            return Results.Ok(await service.AnalyzeAsync(
                user.OrganizationId, user.UserId, request, cancellationToken));
        }
        catch (MigrationValidationException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: exception.Message);
        }
        catch (MigrationSourceException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: exception.Message);
        }
        catch (HttpRequestException)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: "The source service could not be reached.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status504GatewayTimeout,
                title: "The source service did not answer in time.");
        }
        catch (MigrationNotFoundException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: exception.Message);
        }
    }

    private static async Task<IResult> ImportAsync(
        Guid previewId,
        MigrationImportRequest request,
        HttpContext context,
        MigrationService service,
        CancellationToken cancellationToken)
    {
        try
        {
            var user = context.GetUser()!;
            return Results.Ok(await service.ImportAsync(
                user.OrganizationId, user.UserId, previewId, request, cancellationToken));
        }
        catch (MigrationValidationException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: exception.Message);
        }
        catch (MigrationNotFoundException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: exception.Message);
        }
    }
}
