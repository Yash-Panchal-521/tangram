using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

public class CardDepthTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid WorkspaceId, BoardResponse Board, CardResponse Card)>
        SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Depth")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Depth board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync(
            $"/boards/{board!.Id}/columns", new CreateColumnRequest("Doing")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{column!.Id}/cards", new CreateCardRequest("Task", "Details")))
            .Content.ReadFromJsonAsync<CardResponse>();
        return (client, workspace.Id, board, card!);
    }

    private static async Task<CardResponse> ReadCardAsync(HttpClient client, Guid boardId, Guid cardId)
    {
        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{boardId}");
        return detail!.Columns.SelectMany(c => c.Cards).Single(c => c.Id == cardId);
    }

    private async Task<Guid> AddMemberAsync(HttpClient owner, Guid workspaceId, string uid, string role)
    {
        var client = await factory.CreateRegisteredClientAs(uid);
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor(uid), role));
        var me = await (await client.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();
        return me!.Id;
    }

    [Fact]
    public async Task A_due_date_is_stored_as_the_day_not_the_moment()
    {
        // Otherwise two people in different zones can disagree about whether the
        // same card is overdue.
        var (client, _, board, card) = await SeedAsync("due-date-uid");
        var submitted = new DateTimeOffset(2026, 8, 20, 17, 45, 0, TimeSpan.FromHours(5.5));

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", submitted, null));

        var updated = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Equal(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero), updated.DueAt);
    }

    [Fact]
    public async Task Omitting_a_field_leaves_it_alone_but_clearing_it_is_explicit()
    {
        // JSON cannot distinguish "absent" from "null" on a plain property, so
        // clearing needs its own flag -- without it, every partial edit would
        // wipe the fields it didn't mention.
        var (client, _, board, card) = await SeedAsync("clear-flag-uid");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", DateTimeOffset.UtcNow, null));

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("Renamed only", "Details", null, null));
        var afterRename = await ReadCardAsync(client, board.Id, card.Id);

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", null, null, ClearDueAt: true));
        var afterClear = await ReadCardAsync(client, board.Id, card.Id);

        Assert.NotNull(afterRename.DueAt);
        Assert.Equal("Renamed only", afterRename.Title);
        Assert.Null(afterClear.DueAt);
    }

    [Fact]
    public async Task A_new_card_has_no_priority_until_somebody_sets_one()
    {
        // Not defaulted to Medium, which is what Jira does. A priority on every
        // card is a priority on nothing -- the field only carries information
        // when some cards go without.
        var (client, _, board, card) = await SeedAsync("priority-default-uid");

        var fresh = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Null(fresh.Priority);
    }

    [Fact]
    public async Task Priority_can_be_set_changed_and_cleared()
    {
        var (client, _, board, card) = await SeedAsync("priority-uid");

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, Priority: "High"));
        Assert.Equal("High", (await ReadCardAsync(client, board.Id, card.Id)).Priority);

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, Priority: "Lowest"));
        Assert.Equal("Lowest", (await ReadCardAsync(client, board.Id, card.Id)).Priority);

        // Clearing and leaving alone are different requests, for the same reason
        // ClearDueAt exists: JSON cannot express the difference on its own.
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, ClearPriority: true));
        Assert.Null((await ReadCardAsync(client, board.Id, card.Id)).Priority);
    }

    [Fact]
    public async Task An_edit_that_says_nothing_about_priority_leaves_it_alone()
    {
        var (client, _, board, card) = await SeedAsync("priority-untouched-uid");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, Priority: "Highest"));

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("Renamed", null, null, null));

        var after = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Equal("Renamed", after.Title);
        Assert.Equal("Highest", after.Priority);
    }

    [Fact]
    public async Task Case_does_not_matter_when_setting_a_priority()
    {
        var (client, _, board, card) = await SeedAsync("priority-case-uid");

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, Priority: "mEdIuM"));

        Assert.Equal("Medium", (await ReadCardAsync(client, board.Id, card.Id)).Priority);
    }

    [Theory]
    [InlineData("Urgent")]
    [InlineData("7")]
    [InlineData("")]
    public async Task An_unrecognised_priority_is_refused_rather_than_coerced(string value)
    {
        // Enum.TryParse accepts any number, so "7" would otherwise be stored as
        // a priority nothing can render and no filter matches. And an
        // unrecognised name would silently become the first member -- Highest,
        // the loudest possible wrong answer.
        var (client, _, board, card) = await SeedAsync($"priority-bad-{value.Length}-uid");

        var response = await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, Priority: value));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null((await ReadCardAsync(client, board.Id, card.Id)).Priority);
    }

    [Fact]
    public async Task A_card_reports_when_it_was_created_and_last_changed()
    {
        // Both live on the entity and were simply never exposed. The detail view
        // shows them, and an edit has to move UpdatedAt without disturbing
        // CreatedAt -- otherwise "created" silently tracks the last edit.
        var (client, _, board, card) = await SeedAsync("timestamps-uid");

        var fresh = await ReadCardAsync(client, board.Id, card.Id);
        Assert.NotEqual(default, fresh.CreatedAt);
        Assert.Equal(fresh.CreatedAt, fresh.UpdatedAt);

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("Renamed", null, null, null));

        var edited = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Equal(fresh.CreatedAt, edited.CreatedAt);
        Assert.True(edited.UpdatedAt >= fresh.UpdatedAt);
    }

    [Fact]
    public async Task A_card_can_be_assigned_to_a_workspace_member()
    {
        var (owner, workspaceId, board, card) = await SeedAsync("assign-uid");
        var editorId = await AddMemberAsync(owner, workspaceId, "assign-editor", "Editor");

        var response = await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", null, editorId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await ReadCardAsync(owner, board.Id, card.Id);
        Assert.Equal(editorId, updated.AssigneeId);
    }

    [Fact]
    public async Task Assigning_someone_outside_the_workspace_is_refused()
    {
        // Storing it would put a name on the card that nobody in the workspace
        // can resolve, and it would render as a blank avatar forever.
        var (owner, _, board, card) = await SeedAsync("assign-outsider-uid");
        var outsiderClient = factory.CreateClientAs("assign-outsider-other");
        await outsiderClient.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Elsewhere"));
        var outsider = await (await outsiderClient.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>();

        var response = await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", null, outsider!.Id));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Null((await ReadCardAsync(owner, board.Id, card.Id)).AssigneeId);
    }

    [Fact]
    public async Task An_assignment_can_be_cleared()
    {
        var (owner, workspaceId, board, card) = await SeedAsync("unassign-uid");
        var editorId = await AddMemberAsync(owner, workspaceId, "unassign-editor", "Editor");
        await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", null, editorId));

        await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", null, null, ClearAssignee: true));

        Assert.Null((await ReadCardAsync(owner, board.Id, card.Id)).AssigneeId);
    }

    [Fact]
    public async Task One_edit_applies_every_field_it_names()
    {
        // The panel is one form and a save is one request, so all four fields
        // have to land together -- splitting them would be several operations
        // for what a person did once.
        var (owner, workspaceId, board, card) = await SeedAsync("edit-depth-uid");
        var editorId = await AddMemberAsync(owner, workspaceId, "edit-depth-editor", "Editor");
        var due = new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero);

        await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("With depth", "Details", due, editorId));

        var edited = await ReadCardAsync(owner, board.Id, card.Id);
        Assert.Equal("With depth", edited.Title);
        Assert.Equal("Details", edited.Description);
        Assert.Equal(due, edited.DueAt);
        Assert.Equal(editorId, edited.AssigneeId);
    }

    [Fact]
    public async Task Deleting_a_card_is_final()
    {
        // It was recoverable while undo existed -- the delete stored the whole
        // card as its inverse. It no longer does, so the confirmation naming the
        // card is the only thing between a person and losing it.
        var (owner, workspaceId, board, card) = await SeedAsync("restore-depth-uid");
        var editorId = await AddMemberAsync(owner, workspaceId, "restore-depth-editor", "Editor");
        await owner.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", new DateTimeOffset(2026, 10, 5, 0, 0, 0, TimeSpan.Zero), editorId));

        await owner.DeleteAsync($"/boards/{board.Id}/cards/{card.Id}");

        var detail = await owner.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.DoesNotContain(detail!.Columns.SelectMany(c => c.Cards), c => c.Id == card.Id);
    }

    [Fact]
    public async Task A_present_but_blank_title_is_rejected()
    {
        var (client, _, board, card) = await SeedAsync("blank-title-uid");

        var response = await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("   ", "Details", null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_viewer_cannot_set_a_due_date()
    {
        var (owner, workspaceId, board, card) = await SeedAsync("viewer-depth-owner");
        var viewerClient = await factory.CreateRegisteredClientAs("viewer-depth-viewer");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("viewer-depth-viewer"), "Viewer"));
        await viewerClient.GetAsync("/me");

        var response = await viewerClient.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, "Details", DateTimeOffset.UtcNow, null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
