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
        var client = await factory.CreateRegisteredClientAs(uid);
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor(uid), role));
        // Touching any endpoint claims the pending invitation.
        await client.GetAsync("/me");
        return client;
    }

    [Fact]
    public async Task A_seeded_board_arrives_with_the_three_default_columns()
    {
        var client = factory.CreateClientAs("seed-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Seeded")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();

        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("My Board", SeedDefaultColumns: true)))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        Assert.Equal(["To Do", "In Progress", "Done"], detail!.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task Seeded_columns_are_not_recorded_as_work_the_user_did()
    {
        // They used to be three ordinary API calls, so the feed opened by
        // claiming the user had added columns they never touched -- and undo
        // offered to reverse them. Since an undo carries no inverse, three
        // presses of Ctrl+Z stripped a new board with no way back.
        var client = factory.CreateClientAs("seed-noops-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Seeded")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("My Board", SeedDefaultColumns: true)))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board!.Id}/activity");

        Assert.Empty(activity!.Entries);
        Assert.Null(activity.UndoableSeq);
    }

    [Fact]
    public async Task A_new_user_cannot_undo_their_way_to_an_empty_board()
    {
        var client = factory.CreateClientAs("seed-undo-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Seeded")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("My Board", SeedDefaultColumns: true)))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var undo = await client.PostAsync($"/boards/{board!.Id}/undo", null);

        Assert.Equal(HttpStatusCode.Conflict, undo.StatusCode);
        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(3, detail!.Columns.Count);
    }

    [Fact]
    public async Task Seeding_leaves_the_board_seq_untouched()
    {
        // Scaffolding is not an operation, so it must not advance the sequence
        // clients reconcile against.
        var client = factory.CreateClientAs("seed-seq-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Seeded")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("My Board", SeedDefaultColumns: true)))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        Assert.Equal(0, detail!.Seq);
    }

    [Fact]
    public async Task A_board_created_deliberately_stays_empty()
    {
        // Someone who chose to make a board may want a different shape of work,
        // and its empty state already names the next action.
        var (client, workspaceId, _) = await SeedAsync("no-seed-uid");

        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Deliberate")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        Assert.Empty(detail!.Columns);
    }

    [Fact]
    public async Task Seeded_columns_are_ordered_and_independently_rankable()
    {
        // Written directly rather than through the rank service's usual caller,
        // so this guards that they got distinct, ordered ranks rather than three
        // identical ones.
        var client = factory.CreateClientAs("seed-rank-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Seeded")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("My Board", SeedDefaultColumns: true)))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        var ranks = detail!.Columns.Select(c => c.Rank).ToList();

        Assert.Equal(3, ranks.Distinct().Count());
        Assert.Equal(ranks.OrderBy(r => r, StringComparer.Ordinal), ranks);
    }

    [Fact]
    public async Task A_template_can_name_the_starting_columns()
    {
        // What the welcome flow's picker sends.
        var client = factory.CreateClientAs("template-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Templated")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();

        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards",
            new CreateBoardRequest("Sprint board", Columns: ["Backlog", "In Progress", "Review", "Done"])))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        Assert.Equal(["Backlog", "In Progress", "Review", "Done"], detail!.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task Template_columns_are_scaffolding_too_and_leave_no_history()
    {
        var client = factory.CreateClientAs("template-noops-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Templated")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards",
            new CreateBoardRequest("Sprint board", Columns: ["Backlog", "Done"])))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var activity = await client.GetFromJsonAsync<ActivityResponse>($"/boards/{board!.Id}/activity");
        Assert.Empty(activity!.Entries);
    }

    [Fact]
    public async Task Blank_and_whitespace_column_names_are_dropped_rather_than_created()
    {
        var client = factory.CreateClientAs("template-blank-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Templated")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();

        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards",
            new CreateBoardRequest("Board", Columns: ["  Real  ", "   ", ""])))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        Assert.Equal(["Real"], detail!.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task An_unreasonable_number_of_starting_columns_is_refused()
    {
        // Not a product rule -- columns can be added freely afterwards -- just a
        // bound so one request cannot write an arbitrary number of rows.
        var client = factory.CreateClientAs("template-many-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Templated")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();

        var response = await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards",
            new CreateBoardRequest("Board", Columns: Enumerable.Range(1, 20).Select(i => $"C{i}").ToList()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_explicit_column_list_wins_over_the_default_flag()
    {
        var client = factory.CreateClientAs("template-wins-uid");
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Templated")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();

        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards",
            new CreateBoardRequest("Board", SeedDefaultColumns: true, Columns: ["Only this"])))
            .Content.ReadFromJsonAsync<BoardResponse>();

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board!.Id}");
        Assert.Equal(["Only this"], detail!.Columns.Select(c => c.Name));
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
