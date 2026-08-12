using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Services;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// Ranks sort ordinally in the database, not by locale.
/// </summary>
/// <remarks>
/// <see cref="RankService"/> builds keys from "0-9A-Za-z" and compares them with
/// <c>string.CompareOrdinal</c>, where every uppercase letter sorts before every
/// lowercase one. Postgres was ordering the same column under the database's
/// en_US collation, which sorts case-insensitively — so <c>ORDER BY rank</c>
/// returned a different sequence than the code generating those ranks assumed.
///
/// Nothing caught it because the disagreement only shows once a board holds
/// ranks on both sides of the case boundary, which four columns is enough to
/// produce: the generator's own output for four appends is V, k, s, w.
/// </remarks>
public class RankCollationTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public void The_generator_produces_ranks_that_straddle_the_case_boundary()
    {
        // The premise of everything below. If this ever stops being true the
        // tests underneath stop testing anything.
        var ranks = new List<string>();
        string? last = null;
        for (var i = 0; i < 4; i++)
        {
            last = RankService.GenerateBetween(last, null);
            ranks.Add(last);
        }

        Assert.Contains(ranks, r => char.IsUpper(r[0]));
        Assert.Contains(ranks, r => char.IsLower(r[0]));
    }

    private async Task<(HttpClient Client, BoardResponse Board)> SeedAsync(string uid, params string[] columns)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Ranks")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        foreach (var name in columns)
        {
            await client.PostAsJsonAsync($"/boards/{board!.Id}/columns", new CreateColumnRequest(name));
        }

        return (client, board!);
    }

    private static async Task<List<ColumnWithCardsResponse>> ColumnsAsync(HttpClient client, Guid boardId) =>
        (await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{boardId}"))!.Columns;

    [Fact]
    public async Task Moving_a_column_across_the_case_boundary_succeeds()
    {
        // The 500. Under the wrong collation the neighbours came back in a
        // different order than the board was drawn in, so GenerateBetween was
        // handed a lower that did not sort before its upper and threw.
        var (client, board) = await SeedAsync("rank-move", "One", "Two", "Three", "Four");
        var columns = await ColumnsAsync(client, board.Id);

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columns[2].Id}/move",
            new MoveColumnRequest(columns[0].Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            ["Three", "One", "Two", "Four"],
            (await ColumnsAsync(client, board.Id)).Select(c => c.Name));
    }

    [Fact]
    public async Task Moving_a_column_to_the_end_succeeds()
    {
        var (client, board) = await SeedAsync("rank-move-end", "One", "Two", "Three", "Four");
        var columns = await ColumnsAsync(client, board.Id);

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columns[0].Id}/move",
            new MoveColumnRequest(null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            ["Two", "Three", "Four", "One"],
            (await ColumnsAsync(client, board.Id)).Select(c => c.Name));
    }

    [Fact]
    public async Task Appending_never_reuses_a_rank()
    {
        // The other half of the same bug: "the last rank" was ordering under
        // en_US and so returned the wrong maximum, which let two appends
        // generate the same key.
        var (client, board) = await SeedAsync(
            "rank-append", "A", "B", "C", "D", "E", "F", "G", "H");

        var ranks = (await ColumnsAsync(client, board.Id)).Select(c => c.Rank).ToList();

        Assert.Equal(8, ranks.Count);
        Assert.Equal(ranks.Count, ranks.Distinct().Count());
    }

    [Fact]
    public async Task The_board_comes_back_in_ordinal_order()
    {
        // What the client draws, so it has to be what the server sorts by.
        var (client, board) = await SeedAsync("rank-order", "One", "Two", "Three", "Four");

        var columns = await ColumnsAsync(client, board.Id);

        Assert.Equal(
            columns.Select(c => c.Rank).Order(StringComparer.Ordinal),
            columns.Select(c => c.Rank));
    }

    [Fact]
    public async Task Cards_rank_the_same_way()
    {
        var (client, board) = await SeedAsync("rank-cards", "Only");
        var column = (await ColumnsAsync(client, board.Id)).Single();
        foreach (var title in new[] { "1", "2", "3", "4" })
        {
            await client.PostAsJsonAsync(
                $"/boards/{board.Id}/columns/{column.Id}/cards", new CreateCardRequest(title, null));
        }

        var cards = (await ColumnsAsync(client, board.Id)).Single().Cards;
        var first = cards[0];

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/cards/{first.Id}/move",
            new MoveCardRequest(column.Id, null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = (await ColumnsAsync(client, board.Id)).Single().Cards;
        Assert.Equal(["2", "3", "4", "1"], after.Select(c => c.Title));
    }
}
