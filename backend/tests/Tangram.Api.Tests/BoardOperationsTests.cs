using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public class BoardOperationsTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, BoardResponse Board, ColumnResponse ColumnA, ColumnResponse ColumnB)> SeedBoardAsync(string ownerUid)
    {
        var client = factory.CreateClientAs(ownerUid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Ops Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Ops Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var columnA = await (await client.PostAsJsonAsync($"/boards/{board!.Id}/columns", new CreateColumnRequest("A")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var columnB = await (await client.PostAsJsonAsync($"/boards/{board.Id}/columns", new CreateColumnRequest("B")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        return (client, board, columnA!, columnB!);
    }

    [Fact]
    public async Task Sequential_moves_on_the_same_card_converge_to_the_last_move_by_server_seq()
    {
        var (client, board, columnA, columnB) = await SeedBoardAsync("mover-uid");

        var card = await (await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Movable", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        var firstMove = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/cards/{card!.Id}/move", new MoveCardRequest(columnB.Id, null));
        var secondMove = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/cards/{card.Id}/move", new MoveCardRequest(columnA.Id, null));

        Assert.Equal(HttpStatusCode.OK, firstMove.StatusCode);
        Assert.Equal(HttpStatusCode.OK, secondMove.StatusCode);

        var finalCard = await secondMove.Content.ReadFromJsonAsync<CardResponse>();
        Assert.Equal(columnA.Id, finalCard!.ColumnId);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var moveOps = await db.Operations
            .IgnoreQueryFilters()
            .Where(o => o.BoardId == board.Id && o.OpType == "card.move")
            .OrderBy(o => o.Seq)
            .ToListAsync();

        Assert.Equal(2, moveOps.Count);
        Assert.True(moveOps[0].Seq < moveOps[1].Seq);

        var persistedCard = await db.Cards.IgnoreQueryFilters().SingleAsync(c => c.Id == card.Id);
        Assert.Equal(columnA.Id, persistedCard.ColumnId);
    }

    [Fact]
    public async Task Viewer_cannot_mutate_the_board()
    {
        var (ownerClient, board, columnA, _) = await SeedBoardAsync("owner-of-viewer-test");

        const string viewerUid = "viewer-uid";
        var viewerClient = factory.CreateClientAs(viewerUid);
        var me = await (await viewerClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var workspaceId = await db.Boards.IgnoreQueryFilters().Where(b => b.Id == board.Id).Select(b => b.WorkspaceId).SingleAsync();
            db.Memberships.Add(new Membership
            {
                Id = Guid.NewGuid(),
                WorkspaceId = workspaceId,
                UserId = me!.Id,
                Role = MembershipRole.Viewer,
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var response = await viewerClient.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Should be blocked", null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_column_cascades_its_cards_and_logs_the_operation()
    {
        var (client, board, columnA, _) = await SeedBoardAsync("deleter-uid");

        var card = await (await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Doomed", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        var deleteResponse = await client.DeleteAsync($"/boards/{board.Id}/columns/{columnA.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        Assert.False(await db.Columns.IgnoreQueryFilters().AnyAsync(c => c.Id == columnA.Id));
        Assert.False(await db.Cards.IgnoreQueryFilters().AnyAsync(c => c.Id == card!.Id));

        var deleteOp = await db.Operations
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(o => o.BoardId == board.Id && o.OpType == "column.delete");
        Assert.NotNull(deleteOp);
    }
}
