using System.Net.Http.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Services;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public class PresenceAndResyncTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private HubConnection BuildConnection(string userId) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/board"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.Headers.Add(TestAuthHandler.UserHeader, userId);
            })
            .Build();

    [Fact]
    public async Task Joining_and_leaving_a_board_broadcasts_presence_to_others()
    {
        const string ownerUid = "presence-owner";
        var client = factory.CreateClientAs(ownerUid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Presence Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Presence Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        await using var connectionA = BuildConnection(ownerUid);
        var joinReceived = new TaskCompletionSource<PresenceUser>();
        connectionA.On<PresenceUser>("presence.join", u => joinReceived.TrySetResult(u));
        await connectionA.StartAsync();
        var initialPresenceForA = await connectionA.InvokeAsync<List<PresenceUser>>("JoinBoard", board!.Id);
        Assert.Empty(initialPresenceForA);

        const string secondUid = "presence-second";
        var secondClient = factory.CreateClientAs(secondUid);
        var secondUser = await (await secondClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var workspaceId = await db.Boards.IgnoreQueryFilters().Where(b => b.Id == board.Id).Select(b => b.WorkspaceId).SingleAsync();
            db.Memberships.Add(new Membership
            {
                Id = Guid.NewGuid(),
                WorkspaceId = workspaceId,
                UserId = secondUser!.Id,
                Role = MembershipRole.Editor,
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await using var connectionB = BuildConnection(secondUid);
        await connectionB.StartAsync();
        var initialPresenceForB = await connectionB.InvokeAsync<List<PresenceUser>>("JoinBoard", board.Id);
        Assert.Contains(initialPresenceForB, p => p.DisplayName.Contains(ownerUid));

        var joinCompleted = await Task.WhenAny(joinReceived.Task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.True(joinCompleted == joinReceived.Task, "Timed out waiting for presence.join broadcast.");

        var leaveReceived = new TaskCompletionSource<PresenceUser>();
        connectionA.On<PresenceUser>("presence.leave", u => leaveReceived.TrySetResult(u));

        await connectionB.DisposeAsync();

        var leaveCompleted = await Task.WhenAny(leaveReceived.Task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.True(leaveCompleted == leaveReceived.Task, "Timed out waiting for presence.leave broadcast.");
    }

    [Fact]
    public async Task Cursor_updates_are_relayed_to_others_but_not_echoed_back_to_the_sender()
    {
        const string ownerUid = "cursor-owner";
        var client = factory.CreateClientAs(ownerUid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Cursor Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Cursor Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        const string secondUid = "cursor-second";
        var secondClient = factory.CreateClientAs(secondUid);
        var secondUser = await (await secondClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var workspaceId = await db.Boards.IgnoreQueryFilters().Where(b => b.Id == board!.Id).Select(b => b.WorkspaceId).SingleAsync();
            db.Memberships.Add(new Membership
            {
                Id = Guid.NewGuid(),
                WorkspaceId = workspaceId,
                UserId = secondUser!.Id,
                Role = MembershipRole.Editor,
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await using var sender = BuildConnection(ownerUid);
        var senderReceivedCursor = false;
        sender.On<object>("cursor", _ => senderReceivedCursor = true);
        await sender.StartAsync();
        await sender.InvokeAsync<List<PresenceUser>>("JoinBoard", board!.Id);

        await using var receiver = BuildConnection(secondUid);
        var cursorReceived = new TaskCompletionSource<CursorUpdate>();
        receiver.On<CursorUpdate>("cursor", c => cursorReceived.TrySetResult(c));
        await receiver.StartAsync();
        await receiver.InvokeAsync<List<PresenceUser>>("JoinBoard", board.Id);

        await sender.InvokeAsync("UpdateCursor", 42.5, 17.25);

        var completed = await Task.WhenAny(cursorReceived.Task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.True(completed == cursorReceived.Task, "Timed out waiting for the cursor broadcast.");

        var cursor = await cursorReceived.Task;
        Assert.Equal(42.5, cursor.X);
        Assert.Equal(17.25, cursor.Y);
        Assert.False(senderReceivedCursor, "The sender should not receive its own cursor broadcast.");
    }

    // The test above proves the *connection* that sent a cursor does not get it
    // back. That is not the same as the person who sent it: duplicate the tab
    // and the second connection is a different connection belonging to the same
    // user, so `OthersInGroup` happily delivered to it. What you saw was a
    // cursor carrying your own name drifting around while your real pointer sat
    // still somewhere else.
    [Fact]
    public async Task Cursor_updates_do_not_reach_the_senders_own_other_tabs()
    {
        const string uid = "cursor-two-tabs";
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Two Tab Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Two Tab Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        // Two connections, one person — exactly what duplicating a tab produces.
        await using var firstTab = BuildConnection(uid);
        await firstTab.StartAsync();
        await firstTab.InvokeAsync<List<PresenceUser>>("JoinBoard", board!.Id);

        await using var secondTab = BuildConnection(uid);
        var secondTabSawACursor = false;
        secondTab.On<object>("cursor", _ => secondTabSawACursor = true);
        await secondTab.StartAsync();
        await secondTab.InvokeAsync<List<PresenceUser>>("JoinBoard", board.Id);

        await firstTab.InvokeAsync("UpdateCursor", 11.0, 22.0);

        // No completion source to await: the assertion is that nothing arrives,
        // so the only honest wait is a real one.
        await Task.Delay(TimeSpan.FromSeconds(2));

        Assert.False(
            secondTabSawACursor,
            "A second tab belonging to the same user must not be sent that user's cursor."
        );
    }

    [Fact]
    public async Task Resync_replays_delta_within_threshold_and_signals_snapshot_when_lastSeenSeq_is_unset()
    {
        const string uid = "resync-uid";
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Resync Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Resync Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync($"/boards/{board!.Id}/columns", new CreateColumnRequest("To Do")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        // Board is now at seq 1 (column.create). Two more cards bring it to seq 3.
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{column!.Id}/cards", new CreateCardRequest("First", null));
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{column.Id}/cards", new CreateCardRequest("Second", null));

        await using var connection = BuildConnection(uid);
        await connection.StartAsync();
        await connection.InvokeAsync<List<PresenceUser>>("JoinBoard", board.Id);

        var delta = await connection.InvokeAsync<ResyncResult>("Resync", board.Id, 1L);
        Assert.False(delta.NeedsSnapshot);
        Assert.Equal(2, delta.Operations.Count);
        Assert.Equal(2, delta.Operations[0].Seq);
        Assert.Equal(3, delta.Operations[1].Seq);
        Assert.All(delta.Operations, op => Assert.Equal("card.create", op.OpType));

        var snapshot = await connection.InvokeAsync<ResyncResult>("Resync", board.Id, 0L);
        Assert.True(snapshot.NeedsSnapshot);
        Assert.Empty(snapshot.Operations);
    }
}
