using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// Work-in-progress limits on a column.
/// </summary>
/// <remarks>
/// Advisory, never enforced: the server records a limit and reports it, and
/// nothing rejects a move because a column is full. A limit that blocked work
/// would strand it in the previous stage, which is the opposite of what a WIP
/// limit exists to do — it is a signal to a team about their own flow.
/// </remarks>
public class ColumnLimitTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, BoardResponse Board, ColumnResponse Column)> SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Flow")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync(
            $"/boards/{board!.Id}/columns", new CreateColumnRequest("Doing")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        return (client, board, column!);
    }

    private static Task<HttpResponseMessage> SetLimitsAsync(
        HttpClient client, Guid boardId, Guid columnId, SetColumnLimitsRequest request) =>
        client.PatchAsJsonAsync($"/boards/{boardId}/columns/{columnId}/limits", request);

    [Fact]
    public async Task Column_starts_with_no_limits()
    {
        var (_, _, column) = await SeedAsync("limits-none");

        Assert.Null(column.MinCards);
        Assert.Null(column.MaxCards);
    }

    [Fact]
    public async Task Sets_both_limits()
    {
        var (client, board, column) = await SeedAsync("limits-set");

        var response = await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(2, 5));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<ColumnResponse>();
        Assert.Equal(2, updated!.MinCards);
        Assert.Equal(5, updated.MaxCards);
    }

    [Fact]
    public async Task Zero_is_a_limit_a_team_can_mean()
    {
        // "Nothing should be in progress here" is a real thing to say about a
        // staging column, so zero is a value rather than an absence.
        var (client, board, column) = await SeedAsync("limits-zero");

        var response = await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(null, 0));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<ColumnResponse>();
        Assert.Equal(0, updated!.MaxCards);
    }

    [Fact]
    public async Task Omitting_a_limit_leaves_it_alone()
    {
        var (client, board, column) = await SeedAsync("limits-partial");
        await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(2, 5));

        var response = await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(3, null));

        var updated = await response.Content.ReadFromJsonAsync<ColumnResponse>();
        Assert.Equal(3, updated!.MinCards);
        Assert.Equal(5, updated.MaxCards);
    }

    [Fact]
    public async Task Clearing_is_distinct_from_omitting()
    {
        // The flags exist because JSON cannot tell an absent field from a null
        // one, so without them "leave the maximum alone" and "remove the
        // maximum" are the same request.
        var (client, board, column) = await SeedAsync("limits-clear");
        await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(2, 5));

        var response = await SetLimitsAsync(
            client, board.Id, column.Id, new SetColumnLimitsRequest(null, null, ClearMaxCards: true));

        var updated = await response.Content.ReadFromJsonAsync<ColumnResponse>();
        Assert.Equal(2, updated!.MinCards);
        Assert.Null(updated.MaxCards);
    }

    [Fact]
    public async Task Rejects_a_negative_limit()
    {
        var (client, board, column) = await SeedAsync("limits-negative");

        var response = await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(null, -1));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_minimum_above_the_maximum()
    {
        var (client, board, column) = await SeedAsync("limits-inverted");

        var response = await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(6, 5));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_minimum_raised_past_a_maximum_already_stored()
    {
        // The check reads what the request will leave behind rather than what it
        // carries, or raising only the minimum walks straight past an existing
        // maximum and leaves a column both over and under at once.
        var (client, board, column) = await SeedAsync("limits-inverted-stored");
        await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(1, 3));

        var response = await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(9, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Limits_come_back_on_the_board()
    {
        var (client, board, column) = await SeedAsync("limits-board");
        await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(1, 4));

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");

        var reloaded = Assert.Single(detail!.Columns);
        Assert.Equal(1, reloaded.MinCards);
        Assert.Equal(4, reloaded.MaxCards);
    }

    [Fact]
    public async Task Does_not_stop_a_card_from_landing_in_a_full_column()
    {
        // The whole point. Blocking the move would strand the work in the
        // previous stage, which is worse than the column being over its limit.
        var (client, board, column) = await SeedAsync("limits-advisory");
        await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(null, 1));

        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{column.Id}/cards", new CreateCardRequest("One", null));
        var second = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{column.Id}/cards", new CreateCardRequest("Two", null));

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
    }

    [Fact]
    public async Task Setting_a_limit_advances_the_board_sequence()
    {
        // It is a board mutation like any other, so it has to reach everyone
        // else's screen — otherwise one person's limit is invisible to the team
        // it is meant to be a signal to.
        var (client, board, column) = await SeedAsync("limits-seq");
        var before = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");

        await SetLimitsAsync(client, board.Id, column.Id, new SetColumnLimitsRequest(null, 3));

        var after = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.True(after!.Seq > before!.Seq);
    }

    [Fact]
    public async Task A_viewer_cannot_set_one()
    {
        var (owner, board, column) = await SeedAsync("limits-owner");
        var workspaces = await owner.GetFromJsonAsync<List<WorkspaceResponse>>("/workspaces");
        var viewer = await factory.CreateRegisteredClientAs("limits-viewer");
        await owner.PostAsJsonAsync(
            $"/workspaces/{workspaces!.Single().Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("limits-viewer"), "Viewer"));

        var response = await SetLimitsAsync(viewer, board.Id, column.Id, new SetColumnLimitsRequest(null, 3));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
