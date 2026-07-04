using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public class TenantScopingTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task User_cannot_read_a_board_in_a_workspace_they_do_not_belong_to()
    {
        var ownerClient = factory.CreateClientAs("owner-uid");

        var workspace = await (await ownerClient.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Owner's Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await ownerClient.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Owner's Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        // Sanity check: the owner can read their own board.
        var ownerRead = await ownerClient.GetAsync($"/boards/{board!.Id}");
        Assert.Equal(HttpStatusCode.OK, ownerRead.StatusCode);

        // An unrelated, authenticated user must not be able to read it.
        var strangerClient = factory.CreateClientAs("stranger-uid");
        var strangerRead = await strangerClient.GetAsync($"/boards/{board.Id}");

        Assert.Equal(HttpStatusCode.NotFound, strangerRead.StatusCode);
    }
}
