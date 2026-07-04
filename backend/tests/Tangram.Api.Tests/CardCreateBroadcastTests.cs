using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public record TestOperationBroadcast(long Seq, string OpType, JsonElement Payload);

public class CardCreateBroadcastTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Creating_a_card_assigns_a_seq_logs_an_operation_and_broadcasts_to_the_board_group()
    {
        const string userId = "spine-uid";
        var client = factory.CreateClientAs(userId);

        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Spine Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Spine Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync($"/boards/{board!.Id}/columns", new CreateColumnRequest("To Do")))
            .Content.ReadFromJsonAsync<ColumnResponse>();

        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/board"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.Headers.Add(TestAuthHandler.UserHeader, userId);
            })
            .Build();

        var received = new TaskCompletionSource<TestOperationBroadcast>();
        connection.On<TestOperationBroadcast>("operation", op => received.TrySetResult(op));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinBoard", board.Id);

        var createResponse = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{column!.Id}/cards",
            new CreateCardRequest("Ship the spine", null));
        var createdCard = await createResponse.Content.ReadFromJsonAsync<CardResponse>();

        var completed = await Task.WhenAny(received.Task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.True(completed == received.Task, "Timed out waiting for the board group broadcast.");

        var broadcast = await received.Task;
        Assert.Equal("card.create", broadcast.OpType);
        Assert.Equal(createdCard!.Id, broadcast.Payload.GetProperty("id").GetGuid());
        Assert.Equal("Ship the spine", broadcast.Payload.GetProperty("title").GetString());

        await connection.DisposeAsync();

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // Column creation goes through the same spine and already claimed
        // seq 1, so the card's operation (and its broadcast) should be seq 2.
        var operation = await db.Operations.IgnoreQueryFilters().SingleAsync(o => o.BoardId == board.Id && o.OpType == "card.create");
        Assert.Equal(2, operation.Seq);
        Assert.Equal(broadcast.Seq, operation.Seq);
    }
}
