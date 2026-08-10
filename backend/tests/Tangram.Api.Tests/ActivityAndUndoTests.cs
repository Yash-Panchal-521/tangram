using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public class ActivityAndUndoTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid WorkspaceId, BoardResponse Board, ColumnResponse ColumnA, ColumnResponse ColumnB)>
        SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Undo Workspace")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Undo Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var a = await (await client.PostAsJsonAsync($"/boards/{board!.Id}/columns", new CreateColumnRequest("A")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var b = await (await client.PostAsJsonAsync($"/boards/{board.Id}/columns", new CreateColumnRequest("B")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        return (client, workspace.Id, board, a!, b!);
    }

    private static async Task<BoardDetailResponse> GetBoardAsync(HttpClient client, Guid boardId) =>
        (await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{boardId}"))!;

    [Fact]
    public async Task Undoing_a_card_creation_removes_the_card()
    {
        var (client, _, board, columnA, _) = await SeedAsync("undo-create-uid");
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Temporary", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        var undo = await client.PostAsync($"/boards/{board.Id}/undo", null);

        Assert.Equal(HttpStatusCode.NoContent, undo.StatusCode);
        var detail = await GetBoardAsync(client, board.Id);
        Assert.DoesNotContain(detail.Columns.SelectMany(c => c.Cards), c => c.Id == card!.Id);
    }

    [Fact]
    public async Task Undoing_a_rename_restores_the_previous_title()
    {
        // The operation payload records only the *new* title, which is why the
        // inverse has to be captured at write time.
        var (client, _, board, columnA, _) = await SeedAsync("undo-rename-uid");
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Original", "First description")))
            .Content.ReadFromJsonAsync<CardResponse>();

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card!.Id}",
            new UpdateCardRequest("Changed", "Second description", null, null));

        await client.PostAsync($"/boards/{board.Id}/undo", null);

        var detail = await GetBoardAsync(client, board.Id);
        var restored = detail.Columns.SelectMany(c => c.Cards).Single(c => c.Id == card.Id);
        Assert.Equal("Original", restored.Title);
        Assert.Equal("First description", restored.Description);
    }

    [Fact]
    public async Task Undoing_a_move_returns_the_card_to_its_original_column_and_rank()
    {
        var (client, _, board, columnA, columnB) = await SeedAsync("undo-move-uid");
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Travels", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        await client.PostAsJsonAsync($"/boards/{board.Id}/cards/{card!.Id}/move",
            new MoveCardRequest(columnB.Id, null));

        await client.PostAsync($"/boards/{board.Id}/undo", null);

        var detail = await GetBoardAsync(client, board.Id);
        var restored = detail.Columns.Single(c => c.Id == columnA.Id).Cards.Single(c => c.Id == card.Id);
        Assert.Equal(card.Rank, restored.Rank);
    }

    [Fact]
    public async Task Undoing_a_column_deletion_brings_back_its_cards()
    {
        // The deletion cascades the cards away and the operation payload holds
        // only the column id. Without the snapshot taken before the delete, this
        // would restore an empty column and silently lose the work.
        var (client, _, board, columnA, _) = await SeedAsync("undo-column-delete-uid");
        var first = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Keep me", "please")))
            .Content.ReadFromJsonAsync<CardResponse>();
        var second = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Me too", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        await client.DeleteAsync($"/boards/{board.Id}/columns/{columnA.Id}");
        var undo = await client.PostAsync($"/boards/{board.Id}/undo", null);

        Assert.Equal(HttpStatusCode.NoContent, undo.StatusCode);
        var detail = await GetBoardAsync(client, board.Id);
        var restored = detail.Columns.Single(c => c.Id == columnA.Id);
        Assert.Equal("A", restored.Name);
        Assert.Equal(2, restored.Cards.Count);
        Assert.Contains(restored.Cards, c => c.Id == first!.Id && c.Title == "Keep me" && c.Description == "please");
        Assert.Contains(restored.Cards, c => c.Id == second!.Id && c.Title == "Me too");
    }

    [Fact]
    public async Task Restoring_a_column_broadcasts_the_column_before_its_cards()
    {
        // A client that received a card for a column it doesn't know about yet
        // would drop it, so the order of the appended operations is load-bearing.
        var (client, _, board, columnA, _) = await SeedAsync("undo-order-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Ordered", null));

        await client.DeleteAsync($"/boards/{board.Id}/columns/{columnA.Id}");
        await client.PostAsync($"/boards/{board.Id}/undo", null);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tail = await db.Operations
            .IgnoreQueryFilters()
            .Where(o => o.BoardId == board.Id)
            .OrderByDescending(o => o.Seq)
            .Take(2)
            .ToListAsync();

        Assert.Equal("card.create", tail[0].OpType);
        Assert.Equal("column.create", tail[1].OpType);
        Assert.True(tail[1].Seq < tail[0].Seq);
    }

    [Fact]
    public async Task The_same_operation_cannot_be_undone_twice()
    {
        var (client, _, board, columnA, columnB) = await SeedAsync("undo-twice-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Once", null));

        await client.PostAsync($"/boards/{board.Id}/undo", null);
        // The second undo walks back past the card -- which is already undone --
        // to the newest operation still standing: the creation of column B.
        var second = await client.PostAsync($"/boards/{board.Id}/undo", null);

        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
        var detail = await GetBoardAsync(client, board.Id);
        Assert.DoesNotContain(detail.Columns, c => c.Id == columnB.Id);
        Assert.Contains(detail.Columns, c => c.Id == columnA.Id);
        Assert.Empty(detail.Columns.SelectMany(c => c.Cards));
    }

    [Fact]
    public async Task An_undo_is_not_itself_undoable()
    {
        // Undos are recorded without an inverse, which is what stops undo from
        // becoming redo and then a loop.
        var (client, _, board, columnA, _) = await SeedAsync("undo-of-undo-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Solo", null));
        await client.PostAsync($"/boards/{board.Id}/undo", null);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var newest = await db.Operations
            .IgnoreQueryFilters()
            .Where(o => o.BoardId == board.Id)
            .OrderByDescending(o => o.Seq)
            .FirstAsync();

        Assert.Null(newest.InverseOpType);
    }

    [Fact]
    public async Task Undo_only_reaches_your_own_operations()
    {
        var (owner, workspaceId, board, columnA, _) = await SeedAsync("undo-owner-uid");
        var editorClient = factory.CreateClientAs("undo-editor-uid");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("undo-editor-uid"), "Editor"));
        // Touching any endpoint claims the pending invitation.
        await editorClient.GetAsync("/me");

        var editorCard = await (await editorClient.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Editor's card", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        // The owner's undo must skip the editor's newer card and reach back to
        // the owner's own last action -- reversing someone else's edit out from
        // under them is a different feature with a different conversation.
        await owner.PostAsync($"/boards/{board.Id}/undo", null);

        var detail = await GetBoardAsync(owner, board.Id);
        Assert.Contains(detail.Columns.SelectMany(c => c.Cards), c => c.Id == editorCard!.Id);
    }

    [Fact]
    public async Task Undo_conflicts_rather_than_failing_silently_when_the_target_is_gone()
    {
        var (owner, workspaceId, board, columnA, _) = await SeedAsync("undo-conflict-owner");
        var editorClient = factory.CreateClientAs("undo-conflict-editor");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("undo-conflict-editor"), "Editor"));
        await editorClient.GetAsync("/me");

        var card = await (await owner.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Doomed", null)))
            .Content.ReadFromJsonAsync<CardResponse>();
        await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card!.Id}",
            new UpdateCardRequest("Renamed", null, null, null));

        // Someone else removes the card the owner's undo would have edited.
        await editorClient.DeleteAsync($"/boards/{board.Id}/cards/{card.Id}");

        var undo = await owner.PostAsync($"/boards/{board.Id}/undo", null);

        Assert.Equal(HttpStatusCode.Conflict, undo.StatusCode);
    }

    [Fact]
    public async Task Undo_with_nothing_of_your_own_conflicts()
    {
        var (owner, workspaceId, board, _, _) = await SeedAsync("undo-empty-owner");
        var editorClient = factory.CreateClientAs("undo-empty-editor");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("undo-empty-editor"), "Editor"));
        await editorClient.GetAsync("/me");

        var undo = await editorClient.PostAsync($"/boards/{board.Id}/undo", null);

        Assert.Equal(HttpStatusCode.Conflict, undo.StatusCode);
    }

    [Fact]
    public async Task Viewers_cannot_undo()
    {
        var (owner, workspaceId, board, columnA, _) = await SeedAsync("undo-viewer-owner");
        await owner.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Untouchable", null));

        var viewerClient = factory.CreateClientAs("undo-viewer-uid");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("undo-viewer-uid"), "Viewer"));
        await viewerClient.GetAsync("/me");

        var undo = await viewerClient.PostAsync($"/boards/{board.Id}/undo", null);

        Assert.Equal(HttpStatusCode.Forbidden, undo.StatusCode);
    }

    [Fact]
    public async Task Activity_lists_what_happened_newest_first_with_readable_summaries()
    {
        var (client, _, board, columnA, _) = await SeedAsync("activity-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Write the docs", null));

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");

        Assert.NotNull(activity);
        Assert.Equal("card.create", activity!.Entries[0].OpType);
        Assert.Contains("Write the docs", activity.Entries[0].Summary);
        Assert.True(activity.Entries[0].Seq > activity.Entries[1].Seq);
    }

    [Fact]
    public async Task Activity_names_a_deleted_card_by_reading_the_inverse()
    {
        // The delete payload carries only ids. The title worth showing survives
        // only because the inverse was recorded alongside it.
        var (client, _, board, columnA, _) = await SeedAsync("activity-delete-uid");
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Short lived", null)))
            .Content.ReadFromJsonAsync<CardResponse>();
        await client.DeleteAsync($"/boards/{board.Id}/cards/{card!.Id}");

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");

        Assert.Contains("Short lived", activity!.Entries[0].Summary);
    }

    [Fact]
    public async Task Activity_marks_an_undone_operation_and_stops_offering_it()
    {
        var (client, _, board, columnA, _) = await SeedAsync("activity-undone-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Reversed", null));
        await client.PostAsync($"/boards/{board.Id}/undo", null);

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");

        var creation = activity!.Entries.Single(e => e.OpType == "card.create");
        Assert.True(creation.Undone);
        Assert.False(creation.CanUndo);
    }

    [Fact]
    public async Task An_undo_reads_as_an_undo_and_names_what_it_reversed()
    {
        // It used to append a bare card.delete, which the feed rendered as
        // "deleted a card": not identifiable as an undo, and missing the title
        // because a delete takes its name from an inverse -- and undos
        // deliberately record none.
        var (client, _, board, columnA, _) = await SeedAsync("undo-summary-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Live sync probe", null));

        await client.PostAsync($"/boards/{board.Id}/undo", null);

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");
        Assert.Equal("undid adding “Live sync probe”", activity!.Entries[0].Summary);
    }

    [Fact]
    public async Task Undoing_a_deletion_names_the_card_it_brought_back()
    {
        var (client, _, board, columnA, _) = await SeedAsync("undo-summary-delete-uid");
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{columnA.Id}/cards", new CreateCardRequest("Rescued", null)))
            .Content.ReadFromJsonAsync<CardResponse>();
        await client.DeleteAsync($"/boards/{board.Id}/cards/{card!.Id}");

        await client.PostAsync($"/boards/{board.Id}/undo", null);

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");
        Assert.Contains("undid deleting", activity!.Entries[0].Summary);
        Assert.Contains("Rescued", activity.Entries[0].Summary);
    }

    [Fact]
    public async Task Restoring_a_column_is_one_line_in_the_feed_not_one_per_card()
    {
        // The restore appends the column plus every card it held. That is one
        // action to a person, so a single undo must not fill the feed.
        var (client, _, board, columnA, _) = await SeedAsync("undo-summary-column-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("One", null));
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Two", null));
        await client.DeleteAsync($"/boards/{board.Id}/columns/{columnA.Id}");

        await client.PostAsync($"/boards/{board.Id}/undo", null);

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");
        Assert.Equal("undid deleting the “A” column", activity!.Entries[0].Summary);
        Assert.Single(activity.Entries, e => e.Summary.StartsWith("undid"));
    }

    [Fact]
    public async Task An_ordinary_operation_is_still_described_normally()
    {
        // Guards the collapse: only undo-produced rows group together.
        var (client, _, board, columnA, _) = await SeedAsync("undo-summary-plain-uid");
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Alpha", null));
        await client.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Beta", null));

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");

        Assert.Equal("added “Beta”", activity!.Entries[0].Summary);
        Assert.Equal("added “Alpha”", activity.Entries[1].Summary);
    }

    [Fact]
    public async Task Activity_never_offers_someone_elses_operation_for_undo()
    {
        var (owner, workspaceId, board, columnA, _) = await SeedAsync("activity-others-owner");
        var editorClient = factory.CreateClientAs("activity-others-editor");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("activity-others-editor"), "Editor"));
        await editorClient.GetAsync("/me");
        await editorClient.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Not yours", null));

        var activity = await owner.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");

        var theirs = activity!.Entries.Single(e => e.OpType == "card.create");
        Assert.False(theirs.CanUndo);
        Assert.NotEqual(theirs.Seq, activity.UndoableSeq);
    }

    [Fact]
    public async Task Viewers_can_read_the_activity_feed()
    {
        // Watching the board is what a viewer is for, and the history is part of
        // watching it. Only undoing is gated.
        var (owner, workspaceId, board, columnA, _) = await SeedAsync("activity-viewer-owner");
        await owner.PostAsJsonAsync($"/boards/{board.Id}/columns/{columnA.Id}/cards",
            new CreateCardRequest("Visible", null));

        var viewerClient = factory.CreateClientAs("activity-viewer-uid");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("activity-viewer-uid"), "Viewer"));
        await viewerClient.GetAsync("/me");

        var activity = await viewerClient.GetFromJsonAsync<ActivityResponse>($"/boards/{board.Id}/activity");

        Assert.NotEmpty(activity!.Entries);
        Assert.Null(activity.UndoableSeq);
    }

    [Fact]
    public async Task A_non_member_gets_404_from_activity()
    {
        var (_, _, board, _, _) = await SeedAsync("activity-tenant-owner");
        var outsider = factory.CreateClientAs("activity-outsider-uid");

        var response = await outsider.GetAsync($"/boards/{board.Id}/activity");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
