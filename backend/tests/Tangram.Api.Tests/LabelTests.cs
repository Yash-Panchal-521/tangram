using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// Labels: the board's vocabulary, and putting them on cards.
/// </summary>
/// <remarks>
/// Two shapes here on purpose. The vocabulary is board-level and goes through
/// its own operations, so it broadcasts. Which labels a *card* carries is a
/// field of the card and rides the ordinary card update, which is why there are
/// no card.label.add/remove operations to test.
/// </remarks>
public class LabelTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid WorkspaceId, BoardResponse Board, CardResponse Card)>
        SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Labelled")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync(
            $"/boards/{board!.Id}/columns", new CreateColumnRequest("Doing")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{column!.Id}/cards", new CreateCardRequest("Task", null)))
            .Content.ReadFromJsonAsync<CardResponse>();
        return (client, workspace.Id, board, card!);
    }

    private static async Task<LabelResponse> CreateLabelAsync(
        HttpClient client, Guid boardId, string name, string? color = null)
    {
        var response = await client.PostAsJsonAsync(
            $"/boards/{boardId}/labels", new CreateLabelRequest(name, color));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LabelResponse>())!;
    }

    private static async Task<BoardDetailResponse> ReadBoardAsync(HttpClient client, Guid boardId) =>
        (await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{boardId}"))!;

    private static async Task<CardResponse> ReadCardAsync(HttpClient client, Guid boardId, Guid cardId)
    {
        var detail = await ReadBoardAsync(client, boardId);
        return detail.Columns.SelectMany(c => c.Cards).Single(c => c.Id == cardId);
    }

    [Fact]
    public async Task A_board_starts_with_no_labels()
    {
        var (client, _, board, _) = await SeedAsync("labels-empty-uid");

        var detail = await ReadBoardAsync(client, board.Id);

        Assert.Empty(detail.Labels!);
    }

    [Fact]
    public async Task A_label_is_created_on_the_board_and_listed_with_it()
    {
        // Listed even when no card carries it: the picker has to offer labels
        // that are not yet in use, or the vocabulary can never grow.
        var (client, _, board, _) = await SeedAsync("labels-create-uid");

        var label = await CreateLabelAsync(client, board.Id, "Bug", "red");

        Assert.Equal("Bug", label.Name);
        Assert.Equal("red", label.Color);

        var detail = await ReadBoardAsync(client, board.Id);
        Assert.Single(detail.Labels!);
    }

    [Fact]
    public async Task A_label_without_a_colour_gets_the_default_rather_than_none()
    {
        var (client, _, board, _) = await SeedAsync("labels-default-uid");

        var label = await CreateLabelAsync(client, board.Id, "Chore");

        Assert.Equal("grey", label.Color);
    }

    [Fact]
    public async Task A_colour_outside_the_palette_is_refused()
    {
        // The palette is closed so the frontend can map each name onto theme
        // tokens. An arbitrary hex would be picked against one background and
        // then rendered against another when the theme flips.
        var (client, _, board, _) = await SeedAsync("labels-badcolour-uid");

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/labels", new CreateLabelRequest("Bug", "#ff0000"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Two_labels_with_the_same_name_are_refused_whatever_the_case()
    {
        // "Bug" and "bug" are one label to a person, and two of them make the
        // picker useless.
        var (client, _, board, _) = await SeedAsync("labels-dupe-uid");
        await CreateLabelAsync(client, board.Id, "Bug");

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/labels", new CreateLabelRequest("  bUg  ", null));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task A_label_can_be_renamed_and_recoloured_independently()
    {
        var (client, _, board, _) = await SeedAsync("labels-update-uid");
        var label = await CreateLabelAsync(client, board.Id, "Bug", "red");

        await client.PatchAsJsonAsync($"/boards/{board.Id}/labels/{label.Id}",
            new UpdateLabelRequest("Defect", null));
        var renamed = (await ReadBoardAsync(client, board.Id)).Labels!.Single();
        Assert.Equal("Defect", renamed.Name);
        Assert.Equal("red", renamed.Color); // recolouring was not asked for

        await client.PatchAsJsonAsync($"/boards/{board.Id}/labels/{label.Id}",
            new UpdateLabelRequest(null, "blue"));
        var recoloured = (await ReadBoardAsync(client, board.Id)).Labels!.Single();
        Assert.Equal("Defect", recoloured.Name);
        Assert.Equal("blue", recoloured.Color);
    }

    [Fact]
    public async Task Deleting_a_label_takes_it_off_the_cards_carrying_it()
    {
        // Not refused while in use: a label nobody can retire because something
        // still has it is a vocabulary that only ever grows.
        var (client, _, board, card) = await SeedAsync("labels-delete-uid");
        var label = await CreateLabelAsync(client, board.Id, "Bug");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [label.Id]));

        var response = await client.DeleteAsync($"/boards/{board.Id}/labels/{label.Id}");
        response.EnsureSuccessStatusCode();

        var detail = await ReadBoardAsync(client, board.Id);
        Assert.Empty(detail.Labels!);
        Assert.Empty(detail.Columns.SelectMany(c => c.Cards).Single(c => c.Id == card.Id).Labels!);
    }

    [Fact]
    public async Task A_card_carries_the_whole_set_it_is_given()
    {
        var (client, _, board, card) = await SeedAsync("labels-set-uid");
        var bug = await CreateLabelAsync(client, board.Id, "Bug", "red");
        var chore = await CreateLabelAsync(client, board.Id, "Chore", "blue");

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [bug.Id, chore.Id]));

        var labelled = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Equal(["Bug", "Chore"], labelled.Labels!.Select(l => l.Name));
    }

    [Fact]
    public async Task Sending_a_shorter_set_removes_the_rest()
    {
        // Set semantics, which is why there is no ClearLabels flag: an empty
        // list already says "none" unambiguously, unlike a null due date.
        var (client, _, board, card) = await SeedAsync("labels-replace-uid");
        var bug = await CreateLabelAsync(client, board.Id, "Bug");
        var chore = await CreateLabelAsync(client, board.Id, "Chore");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [bug.Id, chore.Id]));

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [chore.Id]));

        var after = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Equal(["Chore"], after.Labels!.Select(l => l.Name));
    }

    [Fact]
    public async Task An_empty_set_takes_them_all_off()
    {
        var (client, _, board, card) = await SeedAsync("labels-none-uid");
        var bug = await CreateLabelAsync(client, board.Id, "Bug");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [bug.Id]));

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: []));

        Assert.Empty((await ReadCardAsync(client, board.Id, card.Id)).Labels!);
    }

    [Fact]
    public async Task An_edit_that_says_nothing_about_labels_leaves_them_alone()
    {
        var (client, _, board, card) = await SeedAsync("labels-untouched-uid");
        var bug = await CreateLabelAsync(client, board.Id, "Bug");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [bug.Id]));

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("Renamed", null, null, null));

        var after = await ReadCardAsync(client, board.Id, card.Id);
        Assert.Equal("Renamed", after.Title);
        Assert.Equal(["Bug"], after.Labels!.Select(l => l.Name));
    }

    [Fact]
    public async Task Applying_the_same_label_twice_is_one_row_not_two()
    {
        var (client, _, board, card) = await SeedAsync("labels-dupe-apply-uid");
        var bug = await CreateLabelAsync(client, board.Id, "Bug");

        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [bug.Id, bug.Id]));

        Assert.Single((await ReadCardAsync(client, board.Id, card.Id)).Labels!);
    }

    [Fact]
    public async Task A_label_from_another_board_is_refused()
    {
        // Otherwise a card would carry a name nobody looking at that board can
        // resolve, and the picker could never offer it back.
        var (client, workspaceId, board, card) = await SeedAsync("labels-cross-uid");
        var other = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Other board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var foreign = await CreateLabelAsync(client, other!.Id, "Elsewhere");

        var response = await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [foreign.Id]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty((await ReadCardAsync(client, board.Id, card.Id)).Labels!);
    }

    [Fact]
    public async Task Labels_come_back_on_the_card_that_a_move_returns()
    {
        // Every CardResponse is also a broadcast payload. A move that dropped
        // the labels would make everyone else's copy of the card lose them
        // until the next full load.
        var (client, _, board, card) = await SeedAsync("labels-move-uid");
        var bug = await CreateLabelAsync(client, board.Id, "Bug");
        await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest(null, null, null, null, LabelIds: [bug.Id]));

        var column = (await ReadBoardAsync(client, board.Id)).Columns.Single();
        var moved = await (await client.PostAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}/move",
            new MoveCardRequest(column.Id, null))).Content.ReadFromJsonAsync<CardResponse>();

        Assert.Equal(["Bug"], moved!.Labels!.Select(l => l.Name));
    }

    [Fact]
    public async Task A_viewer_cannot_create_or_delete_labels()
    {
        var (owner, workspaceId, board, _) = await SeedAsync("labels-viewer-owner");
        var label = await CreateLabelAsync(owner, board.Id, "Bug");

        var viewer = await factory.CreateRegisteredClientAs("labels-viewer");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("labels-viewer"), "Viewer"));

        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.PostAsJsonAsync($"/boards/{board.Id}/labels", new CreateLabelRequest("Nope", null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.DeleteAsync($"/boards/{board.Id}/labels/{label.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_non_member_cannot_see_or_touch_a_boards_labels()
    {
        var (owner, _, board, _) = await SeedAsync("labels-outsider-owner");
        await CreateLabelAsync(owner, board.Id, "Bug");

        var outsider = await factory.CreateRegisteredClientAs("labels-outsider");

        // The tenant filter hides the board before any role check runs, so this
        // is a 404 rather than a 403 -- "not found" and "not permitted" are
        // deliberately conflated.
        Assert.Equal(HttpStatusCode.NotFound,
            (await outsider.PostAsJsonAsync($"/boards/{board.Id}/labels", new CreateLabelRequest("Nope", null))).StatusCode);
    }
}
