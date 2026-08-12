using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// Creating a card complete, in one operation.
/// </summary>
/// <remarks>
/// The alternative — create, then PATCH the rest — costs two operations, two
/// sequence numbers and two broadcasts, and everyone else watches the card
/// appear bare and then visibly acquire its assignee and labels. These tests
/// exist mostly to keep that from being "simplified" back.
/// </remarks>
public class CardCreateFieldsTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, BoardResponse Board, ColumnResponse Column)> SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Create")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync(
            $"/boards/{board!.Id}/columns", new CreateColumnRequest("To Do")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        return (client, board, column!);
    }

    private static Task<HttpResponseMessage> CreateAsync(
        HttpClient client, Guid boardId, Guid columnId, CreateCardRequest request) =>
        client.PostAsJsonAsync($"/boards/{boardId}/columns/{columnId}/cards", request);

    [Fact]
    public async Task Creates_a_card_with_every_field_at_once()
    {
        var (client, board, column) = await SeedAsync("create-full");
        var label = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/labels", new CreateLabelRequest("Bug", "red")))
            .Content.ReadFromJsonAsync<LabelResponse>();
        var me = await client.GetFromJsonAsync<MeResponse>("/me");
        var due = new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero);

        var response = await CreateAsync(client, board.Id, column.Id, new CreateCardRequest(
            "Complete", "With everything", me!.Id, "High", due, [label!.Id]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var card = await response.Content.ReadFromJsonAsync<CardResponse>();
        Assert.Equal("Complete", card!.Title);
        Assert.Equal("With everything", card.Description);
        Assert.Equal(me.Id, card.AssigneeId);
        Assert.Equal("High", card.Priority);
        Assert.Equal(due, card.DueAt);
        Assert.Equal("Bug", Assert.Single(card.Labels).Name);
    }

    [Fact]
    public async Task Costs_one_operation_not_two()
    {
        // The reason the fields are on the create request at all.
        var (client, board, column) = await SeedAsync("create-one-op");
        var before = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");

        await CreateAsync(client, board.Id, column.Id, new CreateCardRequest(
            "One shot", null, null, "Highest", null, null));

        var after = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(before!.Seq + 1, after!.Seq);
    }

    [Fact]
    public async Task Still_creates_a_bare_card_when_nothing_optional_is_sent()
    {
        var (client, board, column) = await SeedAsync("create-bare");

        var response = await CreateAsync(client, board.Id, column.Id, new CreateCardRequest("Bare", null));

        var card = await response.Content.ReadFromJsonAsync<CardResponse>();
        Assert.Null(card!.AssigneeId);
        Assert.Null(card.Priority);
        Assert.Null(card.DueAt);
        Assert.Empty(card.Labels);
    }

    [Fact]
    public async Task Refuses_a_priority_it_does_not_recognise()
    {
        // Rejected rather than dropped: an unknown level means the client and
        // the server disagree about what a priority is, and quietly creating
        // the card without one hides that.
        var (client, board, column) = await SeedAsync("create-bad-priority");

        var response = await CreateAsync(client, board.Id, column.Id, new CreateCardRequest(
            "Wrong", null, null, "Sideways"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Ignores_a_label_belonging_to_another_board()
    {
        // The same check the update path makes: an id from elsewhere would
        // borrow another board's vocabulary onto this card.
        var (client, board, column) = await SeedAsync("create-foreign-label");
        var workspaces = await client.GetFromJsonAsync<List<WorkspaceResponse>>("/workspaces");
        var other = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspaces!.Single().Id}/boards", new CreateBoardRequest("Elsewhere")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var foreign = await (await client.PostAsJsonAsync(
            $"/boards/{other!.Id}/labels", new CreateLabelRequest("Theirs", "blue")))
            .Content.ReadFromJsonAsync<LabelResponse>();

        var response = await CreateAsync(client, board.Id, column.Id, new CreateCardRequest(
            "Mine", null, null, null, null, [foreign!.Id]));

        var card = await response.Content.ReadFromJsonAsync<CardResponse>();
        Assert.Empty(card!.Labels);
    }

    [Fact]
    public async Task Lands_at_the_bottom_of_its_column()
    {
        // Matches where Jira's inline create puts one, and it is what the rank
        // generator already does — worth pinning so it stays true.
        var (client, board, column) = await SeedAsync("create-order");

        await CreateAsync(client, board.Id, column.Id, new CreateCardRequest("First", null));
        await CreateAsync(client, board.Id, column.Id, new CreateCardRequest("Second", null));

        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}");
        Assert.Equal(["First", "Second"], detail!.Columns.Single().Cards.Select(c => c.Title));
    }

    [Fact]
    public async Task A_viewer_cannot_create_one()
    {
        var (owner, board, column) = await SeedAsync("create-owner");
        var workspaces = await owner.GetFromJsonAsync<List<WorkspaceResponse>>("/workspaces");
        var viewer = await factory.CreateRegisteredClientAs("create-viewer");
        await owner.PostAsJsonAsync(
            $"/workspaces/{workspaces!.Single().Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("create-viewer"), "Viewer"));

        var response = await CreateAsync(viewer, board.Id, column.Id, new CreateCardRequest("Nope", null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
