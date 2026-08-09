using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public class BoardManagementTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid WorkspaceId, BoardResponse Board)> SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Managed")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("First board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        return (client, workspace.Id, board!);
    }

    private static async Task<List<WorkspaceSummaryResponse>> ListAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<List<WorkspaceSummaryResponse>>("/workspaces"))!;

    private async Task<HttpClient> AddMemberAsync(HttpClient owner, Guid workspaceId, string uid, string role)
    {
        var client = factory.CreateClientAs(uid);
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor(uid), role));
        // Touching any endpoint claims the pending invitation.
        await client.GetAsync("/me");
        return client;
    }

    [Fact]
    public async Task Renaming_a_board_changes_what_the_workspace_lists()
    {
        var (client, workspaceId, board) = await SeedAsync("rename-board-uid");

        var response = await client.PatchAsJsonAsync($"/boards/{board.Id}", new RenameBoardRequest("  Renamed  "));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var workspaces = await ListAsync(client);
        Assert.Equal("Renamed", workspaces.Single(w => w.Id == workspaceId).Boards.Single().Name);
    }

    [Fact]
    public async Task A_blank_board_name_is_rejected()
    {
        var (client, _, board) = await SeedAsync("blank-name-uid");

        var response = await client.PatchAsJsonAsync($"/boards/{board.Id}", new RenameBoardRequest("   "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Archiving_flags_the_board_rather_than_removing_it()
    {
        // A board that vanished from the listing entirely would read as data
        // loss, and there would be no way back to it.
        var (client, workspaceId, first) = await SeedAsync("archive-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second board"));

        var response = await client.PostAsync($"/boards/{first.Id}/archive", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var boards = (await ListAsync(client)).Single(w => w.Id == workspaceId).Boards;
        Assert.True(boards.Single(b => b.Id == first.Id).Archived);
        Assert.Equal(2, boards.Count);
    }

    [Fact]
    public async Task An_archived_board_can_be_brought_back()
    {
        var (client, workspaceId, first) = await SeedAsync("unarchive-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second board"));
        await client.PostAsync($"/boards/{first.Id}/archive", null);

        var response = await client.PostAsync($"/boards/{first.Id}/unarchive", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var boards = (await ListAsync(client)).Single(w => w.Id == workspaceId).Boards;
        Assert.False(boards.Single(b => b.Id == first.Id).Archived);
    }

    [Fact]
    public async Task An_archived_board_keeps_its_contents()
    {
        var (client, workspaceId, first) = await SeedAsync("archive-keeps-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second board"));
        var column = await (await client.PostAsJsonAsync($"/boards/{first.Id}/columns", new CreateColumnRequest("Kept")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        await client.PostAsJsonAsync($"/boards/{first.Id}/columns/{column!.Id}/cards",
            new CreateCardRequest("Still here", null));

        await client.PostAsync($"/boards/{first.Id}/archive", null);

        // Archiving is a listing decision, not a delete. Everything on the board
        // survives and the board is still reachable by its own URL.
        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{first.Id}");
        Assert.Single(detail!.Columns);
        Assert.Equal("Still here", detail.Columns.Single().Cards.Single().Title);
    }

    [Fact]
    public async Task The_last_active_board_cannot_be_archived()
    {
        // Otherwise the home screen's only option is "create a board", with no
        // way back to the work that was there.
        var (client, _, board) = await SeedAsync("last-board-uid");

        var response = await client.PostAsync($"/boards/{board.Id}/archive", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemShape>();
        Assert.Contains("only active board", problem!.Detail);
    }

    private record ProblemShape(string? Detail);

    [Fact]
    public async Task An_editor_can_rename_but_not_archive()
    {
        var (owner, workspaceId, board) = await SeedAsync("editor-scope-owner");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second"));
        var editor = await AddMemberAsync(owner, workspaceId, "editor-scope-editor", "Editor");

        var rename = await editor.PatchAsJsonAsync($"/boards/{board.Id}", new RenameBoardRequest("Editor renamed"));
        var archive = await editor.PostAsync($"/boards/{board.Id}/archive", null);

        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);
        // Archiving changes what the whole workspace sees, which puts it with
        // the other owner-shaped decisions.
        Assert.Equal(HttpStatusCode.Forbidden, archive.StatusCode);
    }

    [Fact]
    public async Task A_viewer_cannot_rename_or_create_boards()
    {
        var (owner, workspaceId, board) = await SeedAsync("viewer-scope-owner");
        var viewer = await AddMemberAsync(owner, workspaceId, "viewer-scope-viewer", "Viewer");

        var rename = await viewer.PatchAsJsonAsync($"/boards/{board.Id}", new RenameBoardRequest("Nope"));
        var create = await viewer.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Nope"));

        Assert.Equal(HttpStatusCode.Forbidden, rename.StatusCode);
        // Creating a board was previously unchecked, so a viewer could make one
        // and then be unable to put anything on it.
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task A_non_member_cannot_reach_another_workspaces_board()
    {
        var (_, _, board) = await SeedAsync("tenant-board-owner");
        var outsider = factory.CreateClientAs("tenant-board-outsider");

        var rename = await outsider.PatchAsJsonAsync($"/boards/{board.Id}", new RenameBoardRequest("Mine now"));
        var archive = await outsider.PostAsync($"/boards/{board.Id}/archive", null);

        // 404 rather than 403: the query filter hides the board before any role
        // check runs, so "not found" and "not permitted" stay conflated.
        Assert.Equal(HttpStatusCode.NotFound, rename.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, archive.StatusCode);
    }

    [Fact]
    public async Task Workspaces_list_boards_most_recently_touched_first()
    {
        var (client, workspaceId, first) = await SeedAsync("ordering-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second"));

        // Touching the older board should float it back to the top, which is
        // what makes the home screen useful rather than just chronological.
        await client.PatchAsJsonAsync($"/boards/{first.Id}", new RenameBoardRequest("Touched"));

        var boards = (await ListAsync(client)).Single(w => w.Id == workspaceId).Boards;
        Assert.Equal(first.Id, boards[0].Id);
    }
}
