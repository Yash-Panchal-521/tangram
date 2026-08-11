using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// The conversation on a card.
/// </summary>
/// <remarks>
/// Worth stating what this is not: the activity feed removed a few commits ago
/// was *derived history*, written by the machine from the operations log. A
/// comment is authored. The tests below lean on that distinction — an edit is
/// marked as edited, and only the author can change what they said.
/// </remarks>
public class CommentTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid WorkspaceId, BoardResponse Board, CardResponse Card)>
        SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Talkative")))
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

    private static async Task<CommentResponse> AddAsync(
        HttpClient client, Guid boardId, Guid cardId, string body)
    {
        var response = await client.PostAsJsonAsync(
            $"/boards/{boardId}/cards/{cardId}/comments", new CreateCommentRequest(body));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CommentResponse>())!;
    }

    private static async Task<List<CommentResponse>> ReadThreadAsync(
        HttpClient client, Guid boardId, Guid cardId) =>
        (await client.GetFromJsonAsync<List<CommentResponse>>(
            $"/boards/{boardId}/cards/{cardId}/comments"))!;

    private static async Task<CardResponse> ReadCardAsync(HttpClient client, Guid boardId, Guid cardId)
    {
        var detail = await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{boardId}");
        return detail!.Columns.SelectMany(c => c.Cards).Single(c => c.Id == cardId);
    }

    [Fact]
    public async Task A_card_starts_with_an_empty_thread()
    {
        var (client, _, board, card) = await SeedAsync("comments-empty-uid");

        Assert.Empty(await ReadThreadAsync(client, board.Id, card.Id));
        Assert.Equal(0, (await ReadCardAsync(client, board.Id, card.Id)).CommentCount);
    }

    [Fact]
    public async Task A_comment_records_who_wrote_it_and_when()
    {
        var (client, _, board, card) = await SeedAsync("comments-add-uid");

        var comment = await AddAsync(client, board.Id, card.Id, "  Looks right to me  ");

        // Trimmed, so trailing whitespace doesn't change the height of a row.
        Assert.Equal("Looks right to me", comment.Body);
        Assert.NotEqual(default, comment.CreatedAt);
        Assert.Null(comment.EditedAt);
        Assert.False(string.IsNullOrWhiteSpace(comment.AuthorName));
    }

    [Fact]
    public async Task The_thread_reads_oldest_first()
    {
        // The order a conversation happened in. Newest-first is for a feed you
        // are scanning, not a discussion you are following.
        var (client, _, board, card) = await SeedAsync("comments-order-uid");

        await AddAsync(client, board.Id, card.Id, "First");
        await AddAsync(client, board.Id, card.Id, "Second");
        await AddAsync(client, board.Id, card.Id, "Third");

        var thread = await ReadThreadAsync(client, board.Id, card.Id);
        Assert.Equal(["First", "Second", "Third"], thread.Select(c => c.Body));
    }

    [Fact]
    public async Task The_card_carries_a_count_rather_than_the_thread()
    {
        // A count, so the board can render a badge without loading every
        // conversation on it.
        var (client, _, board, card) = await SeedAsync("comments-count-uid");
        await AddAsync(client, board.Id, card.Id, "One");
        await AddAsync(client, board.Id, card.Id, "Two");

        Assert.Equal(2, (await ReadCardAsync(client, board.Id, card.Id)).CommentCount);
    }

    [Fact]
    public async Task The_count_survives_an_unrelated_edit_to_the_card()
    {
        // CardResponse is also the broadcast payload, so a count of 0 here would
        // wipe the badge on everyone else's copy of the card.
        var (client, _, board, card) = await SeedAsync("comments-count-edit-uid");
        await AddAsync(client, board.Id, card.Id, "One");

        var edited = await (await client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("Renamed", null, null, null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        Assert.Equal(1, edited!.CommentCount);
    }

    [Fact]
    public async Task An_empty_comment_is_refused()
    {
        var (client, _, board, card) = await SeedAsync("comments-blank-uid");

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/cards/{card.Id}/comments", new CreateCommentRequest("   "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await ReadThreadAsync(client, board.Id, card.Id));
    }

    [Fact]
    public async Task An_absurdly_long_comment_is_refused()
    {
        var (client, _, board, card) = await SeedAsync("comments-long-uid");

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/cards/{card.Id}/comments",
            new CreateCommentRequest(new string('x', 5001)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Editing_marks_the_comment_as_edited()
    {
        // Kept rather than folded into CreatedAt: a comment somebody replied to
        // may no longer say what it said when they replied.
        var (client, _, board, card) = await SeedAsync("comments-edit-uid");
        var comment = await AddAsync(client, board.Id, card.Id, "Frist");

        var edited = await (await client.PatchAsJsonAsync($"/boards/{board.Id}/comments/{comment.Id}",
            new UpdateCommentRequest("First"))).Content.ReadFromJsonAsync<CommentResponse>();

        Assert.Equal("First", edited!.Body);
        Assert.NotNull(edited.EditedAt);

        // To the millisecond, not the tick. The create response carries the
        // in-memory value at .NET's 100ns resolution; the edit response has been
        // round-tripped through a Postgres `timestamptz`, which keeps
        // microseconds. Comparing exactly fails on the last digit and says
        // nothing about the thing being tested -- that an edit leaves CreatedAt
        // where it was.
        Assert.Equal(
            comment.CreatedAt.ToUnixTimeMilliseconds(),
            edited.CreatedAt.ToUnixTimeMilliseconds());
        Assert.True(edited.EditedAt >= edited.CreatedAt);
    }

    [Fact]
    public async Task Deleting_removes_it_from_the_thread_and_the_count()
    {
        var (client, _, board, card) = await SeedAsync("comments-delete-uid");
        var comment = await AddAsync(client, board.Id, card.Id, "Never mind");

        (await client.DeleteAsync($"/boards/{board.Id}/comments/{comment.Id}"))
            .EnsureSuccessStatusCode();

        Assert.Empty(await ReadThreadAsync(client, board.Id, card.Id));
        Assert.Equal(0, (await ReadCardAsync(client, board.Id, card.Id)).CommentCount);
    }

    [Fact]
    public async Task Only_the_author_can_edit_or_delete_what_they_wrote()
    {
        // Author only, and deliberately not the owner either. Putting words in
        // somebody's mouth is a different power from managing a board, and
        // granting it to a role given for another reason would be an accident.
        var (owner, workspaceId, board, card) = await SeedAsync("comments-author-owner");
        var editor = await factory.CreateRegisteredClientAs("comments-author-editor");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("comments-author-editor"), "Editor"));

        var theirs = await AddAsync(editor, board.Id, card.Id, "My comment");

        Assert.Equal(HttpStatusCode.Forbidden,
            (await owner.PatchAsJsonAsync($"/boards/{board.Id}/comments/{theirs.Id}",
                new UpdateCommentRequest("Rewritten by the owner"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await owner.DeleteAsync($"/boards/{board.Id}/comments/{theirs.Id}")).StatusCode);

        // Untouched by either attempt.
        Assert.Equal("My comment", (await ReadThreadAsync(owner, board.Id, card.Id)).Single().Body);
    }

    [Fact]
    public async Task Everyone_on_the_board_sees_everyone_elses_comments()
    {
        var (owner, workspaceId, board, card) = await SeedAsync("comments-shared-owner");
        var editor = await factory.CreateRegisteredClientAs("comments-shared-editor");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("comments-shared-editor"), "Editor"));

        await AddAsync(owner, board.Id, card.Id, "From the owner");
        await AddAsync(editor, board.Id, card.Id, "From the editor");

        var thread = await ReadThreadAsync(editor, board.Id, card.Id);
        Assert.Equal(["From the owner", "From the editor"], thread.Select(c => c.Body));
        Assert.Equal(2, thread.Select(c => c.AuthorId).Distinct().Count());
    }

    [Fact]
    public async Task A_viewer_can_read_the_thread_but_not_add_to_it()
    {
        // Reading a discussion is not a mutation, and a viewer who can see the
        // card but not why it is the shape it is has half the information.
        // Writing is a mutation, so it follows the same rule as everything else.
        var (owner, workspaceId, board, card) = await SeedAsync("comments-viewer-owner");
        await AddAsync(owner, board.Id, card.Id, "Context for the change");

        var viewer = await factory.CreateRegisteredClientAs("comments-viewer");
        await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("comments-viewer"), "Viewer"));

        Assert.Single(await ReadThreadAsync(viewer, board.Id, card.Id));
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.PostAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}/comments",
                new CreateCommentRequest("Can I?"))).StatusCode);
    }

    [Fact]
    public async Task A_non_member_sees_nothing()
    {
        var (owner, _, board, card) = await SeedAsync("comments-outsider-owner");
        await AddAsync(owner, board.Id, card.Id, "Private");

        var outsider = await factory.CreateRegisteredClientAs("comments-outsider");

        // The tenant filter hides the card before any role check, so this is a
        // 404 rather than a 403 -- "not found" and "not permitted" conflated.
        Assert.Equal(HttpStatusCode.NotFound,
            (await outsider.GetAsync($"/boards/{board.Id}/cards/{card.Id}/comments")).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_card_takes_its_thread_with_it()
    {
        var (client, _, board, card) = await SeedAsync("comments-cascade-uid");
        await AddAsync(client, board.Id, card.Id, "Goes with the card");

        (await client.DeleteAsync($"/boards/{board.Id}/cards/{card.Id}")).EnsureSuccessStatusCode();

        // The card is gone, so its thread is unreachable rather than orphaned.
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.GetAsync($"/boards/{board.Id}/cards/{card.Id}/comments")).StatusCode);
    }

    [Fact]
    public async Task A_comment_advances_the_board_seq_so_other_clients_hear_about_it()
    {
        // The whole point of routing this through SaveAsync: a thread has to
        // update live, which means the comment is an operation like any other.
        var (client, _, board, card) = await SeedAsync("comments-seq-uid");
        var before = (await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}"))!.Seq;

        await AddAsync(client, board.Id, card.Id, "Broadcast me");

        var after = (await client.GetFromJsonAsync<BoardDetailResponse>($"/boards/{board.Id}"))!.Seq;
        Assert.True(after > before);
    }

    [Fact]
    public async Task A_comment_on_another_boards_card_is_not_found()
    {
        var (client, workspaceId, board, _) = await SeedAsync("comments-cross-uid");
        var other = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspaceId}/boards", new CreateBoardRequest("Other")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var otherColumn = await (await client.PostAsJsonAsync(
            $"/boards/{other!.Id}/columns", new CreateColumnRequest("Elsewhere")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var otherCard = await (await client.PostAsJsonAsync(
            $"/boards/{other.Id}/columns/{otherColumn!.Id}/cards", new CreateCardRequest("Theirs", null)))
            .Content.ReadFromJsonAsync<CardResponse>();
        var comment = await AddAsync(client, other.Id, otherCard!.Id, "Over here");

        // Addressed through the wrong board, so the route is a lie even though
        // the caller can see both.
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PatchAsJsonAsync($"/boards/{board.Id}/comments/{comment.Id}",
                new UpdateCommentRequest("Moved?"))).StatusCode);
    }
}
