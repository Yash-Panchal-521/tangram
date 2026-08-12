using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// Seeding an existing board's columns in one call.
/// </summary>
/// <remarks>
/// Distinct from the seeding that happens when a board is created. That one
/// writes columns directly with no operations rows, because nobody can be
/// connected to a board that did not exist a moment ago. This board exists and
/// people may be watching it, so every column is an ordinary
/// <c>column.create</c> — just all inside one transaction.
/// </remarks>
public class BulkColumnTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, BoardResponse Board)> SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Bulk")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        return (client, board!);
    }

    private static Task<HttpResponseMessage> AddAsync(HttpClient client, Guid boardId, params string[] names) =>
        client.PostAsJsonAsync($"/boards/{boardId}/columns/bulk", new CreateColumnsRequest([.. names]));

    [Fact]
    public async Task Creates_them_in_the_order_given()
    {
        var (client, board) = await SeedAsync("bulk-order");

        var response = await AddAsync(client, board.Id, "Backlog", "Doing", "Review", "Done");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(["Backlog", "Doing", "Review", "Done"], detail!.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task Appends_rather_than_rebuilding_an_order_somebody_chose()
    {
        var (client, board) = await SeedAsync("bulk-append");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns", new CreateColumnRequest("First"));

        await AddAsync(client, board.Id, "Second", "Third");

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(["First", "Second", "Third"], detail!.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task Advances_the_sequence_once_per_column()
    {
        // Each is an ordinary column.create, so a client that missed them
        // replays them one by one on resync — no new operation type to teach.
        var (client, board) = await SeedAsync("bulk-seq");
        var before = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");

        await AddAsync(client, board.Id, "One", "Two", "Three");

        var after = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(before!.Seq + 3, after!.Seq);
    }

    [Fact]
    public async Task Trims_names_and_drops_the_gaps()
    {
        // "To Do, , In Progress," is what a trailing comma actually produces,
        // and an empty column name is not a column.
        var (client, board) = await SeedAsync("bulk-trim");

        await AddAsync(client, board.Id, "  To Do  ", "   ", "In Progress", "");

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(["To Do", "In Progress"], detail!.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task Refuses_a_request_that_names_nothing()
    {
        var (client, board) = await SeedAsync("bulk-empty");

        var response = await AddAsync(client, board.Id, "   ", "");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_more_than_the_ceiling()
    {
        // A pasted paragraph would otherwise become forty columns and a board
        // nobody can read.
        var (client, board) = await SeedAsync("bulk-ceiling");

        var response = await AddAsync(
            client, board.Id, "1", "2", "3", "4", "5", "6", "7", "8", "9");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Empty(detail!.Columns);
    }

    [Fact]
    public async Task A_viewer_cannot_seed_a_board()
    {
        var (owner, board) = await SeedAsync("bulk-owner");
        var workspaces = await owner.GetFromJsonAsync<List<WorkspaceResponse>>("/workspaces");
        var viewer = await factory.CreateRegisteredClientAs("bulk-viewer");
        await owner.PostAsJsonAsync(
            $"/workspaces/{workspaces!.Single().Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("bulk-viewer"), "Viewer"));

        var response = await AddAsync(viewer, board.Id, "Nope");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
