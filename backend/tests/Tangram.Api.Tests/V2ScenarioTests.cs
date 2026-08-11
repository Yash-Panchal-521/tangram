using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// Scenarios that fall between the per-feature suites — mostly the places where
/// one v2 feature meets another, which is where nobody was looking.
/// </summary>
public class V2ScenarioTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid WorkspaceId, BoardResponse Board, ColumnResponse Column)>
        SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("V2")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("V2 board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync(
            $"/boards/{board!.Id}/columns", new CreateColumnRequest("Doing")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        return (client, workspace.Id, board, column!);
    }

    private static async Task<CardResponse> AddCardAsync(
        HttpClient client, Guid boardId, Guid columnId, string title) =>
        (await (await client.PostAsJsonAsync(
            $"/boards/{boardId}/columns/{columnId}/cards", new CreateCardRequest(title, null)))
            .Content.ReadFromJsonAsync<CardResponse>())!;

    // ---------- board management ----------

    [Fact]
    public async Task Unarchiving_works_even_though_it_is_the_only_board()
    {
        // The last-board rule guards archiving, not restoring -- getting that
        // backwards would strand an archived board forever.
        var (client, workspaceId, first, _) = await SeedAsync("unarchive-only-uid");
        var second = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        await client.PostAsync($"/boards/{first.Id}/archive", null);
        await client.PostAsync($"/boards/{second!.Id}/archive", null);

        var response = await client.PostAsync($"/boards/{first.Id}/unarchive", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Archiving_the_second_to_last_board_is_allowed()
    {
        var (client, workspaceId, first, _) = await SeedAsync("archive-second-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second"));

        var response = await client.PostAsync($"/boards/{first.Id}/archive", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Archiving_an_already_archived_board_is_idempotent()
    {
        var (client, workspaceId, first, _) = await SeedAsync("archive-twice-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second"));
        await client.PostAsync($"/boards/{first.Id}/archive", null);

        var again = await client.PostAsync($"/boards/{first.Id}/archive", null);

        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
    }

    [Fact]
    public async Task An_archived_board_is_still_fully_usable_by_its_url()
    {
        // Archiving is a listing decision, not a freeze. If that ever changes,
        // this test is the thing that should fail first.
        var (client, workspaceId, first, column) = await SeedAsync("archive-usable-uid");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Second"));
        await client.PostAsync($"/boards/{first.Id}/archive", null);

        var card = await AddCardAsync(client, first.Id, column.Id, "Added after archiving");

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{first.Id}");
        Assert.Contains(detail!.Columns.SelectMany(c => c.Cards), c => c.Id == card.Id);
    }

    [Fact]
    public async Task A_new_board_starts_empty_and_unarchived()
    {
        var (client, workspaceId, _, _) = await SeedAsync("new-board-uid");

        var created = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Brand new")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{created!.Id}");
        Assert.Empty(detail!.Columns);

        var workspaces = await client.GetFromJsonAsync<List<WorkspaceSummaryResponse>>("/workspaces");
        var summary = workspaces!.Single(w => w.Id == workspaceId).Boards.Single(b => b.Id == created.Id);
        Assert.False(summary.Archived);
    }

    // ---------- card depth meeting the sync spine ----------

    [Fact]
    public async Task A_due_date_only_edit_still_appends_an_operation()
    {
        // An edit that changes no text is still an edit. If it skipped the log,
        // a client that reconnects afterwards would replay everything except
        // the due date and quietly disagree with the server about the card.
        var (client, _, board, column) = await SeedAsync("depth-inverse-uid");
        var card = await AddCardAsync(client, board.Id, column.Id, "Dated");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero), null));

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var newest = await db.Operations.IgnoreQueryFilters()
            .Where(o => o.BoardId == board.Id)
            .OrderByDescending(o => o.Seq)
            .FirstAsync();

        // Still "card.rename": the log holds historical rows of that type which
        // resync replays, so a new op type would mean every client had to
        // understand both forever.
        Assert.Equal("card.rename", newest.OpType);
        Assert.Contains("2026-12-01", newest.Payload);
    }

    [Fact]
    public async Task Depth_survives_a_card_move()
    {
        // Moving is a different code path from updating, and it rebuilds the
        // CardResponse -- a dropped field there would silently clear due dates
        // whenever anyone dragged a card.
        var (client, _, board, column) = await SeedAsync("depth-move-uid");
        var other = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns", new CreateColumnRequest("Done")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var card = await AddCardAsync(client, board.Id, column.Id, "Travelling");

        var due = new DateTimeOffset(2026, 11, 3, 0, 0, 0, TimeSpan.Zero);
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, due, null));

        var moved = await (await client.PostAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}/move",
            new MoveCardRequest(other!.Id, null))).Content.ReadFromJsonAsync<CardResponse>();

        Assert.Equal(due, moved!.DueAt);
    }

    [Fact]
    public async Task Deleting_a_column_takes_its_cards_and_is_final()
    {
        // This used to be recoverable: the delete snapshotted its cards so undo
        // could restore them. With undo gone the cascade is the whole story, and
        // that makes the confirmation dialog the only thing standing between a
        // person and losing the work a column held.
        var (client, workspaceId, board, column) = await SeedAsync("depth-column-uid");
        var editorClient = await factory.CreateRegisteredClientAs("depth-column-editor");
        await client.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("depth-column-editor"), "Editor"));
        var editor = await (await editorClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();

        var card = await AddCardAsync(client, board.Id, column.Id, "Deep");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, new DateTimeOffset(2026, 11, 20, 0, 0, 0, TimeSpan.Zero), editor!.Id));

        await client.DeleteAsync($"/boards/{board.Id}/columns/{column.Id}");

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.DoesNotContain(detail!.Columns, c => c.Id == column.Id);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Cards.IgnoreQueryFilters().AnyAsync(c => c.Id == card.Id));
    }

    [Fact]
    public async Task Depth_reaches_a_resyncing_client_through_the_operation_payload()
    {
        // Resync replays stored payloads rather than refetching, so a field
        // missing from the payload would be invisible to anyone reconnecting.
        var (client, _, board, column) = await SeedAsync("depth-resync-uid");
        var card = await AddCardAsync(client, board.Id, column.Id, "Replayed");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, new DateTimeOffset(2026, 12, 25, 0, 0, 0, TimeSpan.Zero), null));

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var newest = await db.Operations.IgnoreQueryFilters()
            .Where(o => o.BoardId == board.Id)
            .OrderByDescending(o => o.Seq)
            .FirstAsync();

        Assert.Contains("dueAt", newest.Payload, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("2026-12-25", newest.Payload);
    }

    [Fact]
    public async Task Clearing_a_due_date_and_never_setting_one_are_both_fine()
    {
        var (client, _, board, column) = await SeedAsync("depth-clear-uid");
        var card = await AddCardAsync(client, board.Id, column.Id, "Never dated");

        var response = await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, ClearDueAt: true, ClearAssignee: true));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<CardResponse>();
        Assert.Null(updated!.DueAt);
        Assert.Null(updated.AssigneeId);
    }

    [Fact]
    public async Task An_assignee_who_leaves_the_workspace_is_left_on_the_card()
    {
        // No FK, on purpose: removing a member must not cascade-delete or block.
        // The card keeps the id and the UI stops resolving it.
        var (owner, workspaceId, board, column) = await SeedAsync("depth-leaver-uid");
        var leaverClient = await factory.CreateRegisteredClientAs("depth-leaver-member");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("depth-leaver-member"), "Editor"));
        var leaver = await (await leaverClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();

        var card = await AddCardAsync(owner, board.Id, column.Id, "Theirs");
        await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, leaver!.Id));

        var removal = await owner.DeleteAsync($"/workspaces/{workspaceId}/members/{leaver.Id}");
        Assert.Equal(HttpStatusCode.NoContent, removal.StatusCode);

        var detail = await owner.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(leaver.Id, detail!.Columns.SelectMany(c => c.Cards).Single().AssigneeId);
    }

    [Fact]
    public async Task Reassigning_to_a_departed_member_is_refused()
    {
        var (owner, workspaceId, board, column) = await SeedAsync("depth-rejoin-uid");
        var leaverClient = await factory.CreateRegisteredClientAs("depth-rejoin-member");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("depth-rejoin-member"), "Editor"));
        var leaver = await (await leaverClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();
        await owner.DeleteAsync($"/workspaces/{workspaceId}/members/{leaver!.Id}");

        var card = await AddCardAsync(owner, board.Id, column.Id, "Unassignable");
        var response = await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, leaver.Id));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}
