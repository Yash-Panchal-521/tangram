using System.Net;
using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

// Covers the invite path that makes Tangram genuinely multi-user: getting a
// second person into a workspace, and the RBAC that constrains them once
// they're there.
public class MembershipTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<(WorkspaceResponse Workspace, BoardResponse Board, ColumnResponse Column)>
        SeedWorkspaceAsync(HttpClient client)
    {
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Team")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Roadmap")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var column = await (await client.PostAsJsonAsync($"/boards/{board!.Id}/columns", new CreateColumnRequest("To Do")))
            .Content.ReadFromJsonAsync<ColumnResponse>();

        return (workspace, board, column!);
    }

    [Fact]
    public async Task Inviting_an_existing_user_grants_access_immediately()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, _) = await SeedWorkspaceAsync(owner);

        // The invitee already exists: any authenticated call upserts their row.
        var invitee = factory.CreateClientAs("editor-uid");
        await invitee.GetAsync("/me");

        Assert.Equal(HttpStatusCode.NotFound, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);

        var invite = await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("editor-uid"), "Editor"));
        invite.EnsureSuccessStatusCode();

        var result = await invite.Content.ReadFromJsonAsync<InviteMemberResponse>();
        Assert.True(result!.Joined);
        Assert.Equal("Editor", result.Member!.Role);

        Assert.Equal(HttpStatusCode.OK, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Inviting_an_unregistered_email_is_claimed_on_that_users_first_request()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, _) = await SeedWorkspaceAsync(owner);

        const string newcomerEmail = "newcomer@example.com";
        var invite = await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest(newcomerEmail, "Editor"));
        invite.EnsureSuccessStatusCode();

        var result = await invite.Content.ReadFromJsonAsync<InviteMemberResponse>();
        Assert.False(result!.Joined);
        Assert.Equal(newcomerEmail, result.Invitation!.Email);

        // First authenticated request from that address claims the invitation
        // and must see the workspace on this very call, not the next one.
        var newcomer = factory.CreateClientAs("newcomer-uid", newcomerEmail);
        var boardRead = await newcomer.GetAsync($"/boards/{board.Id}");

        Assert.Equal(HttpStatusCode.OK, boardRead.StatusCode);

        var pendingAfter = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();
        Assert.Empty(pendingAfter!.PendingInvitations);
        Assert.Contains(pendingAfter.Members, m => m.Email == newcomerEmail && m.Role == "Editor");
    }

    [Fact]
    public async Task Case_differences_in_the_invited_address_still_resolve()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, _) = await SeedWorkspaceAsync(owner);

        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest("  MixedCase@Example.COM ", "Viewer"));

        var invitee = factory.CreateClientAs("mixed-uid", "mixedcase@example.com");

        Assert.Equal(HttpStatusCode.OK, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Viewer_can_read_the_board_but_cannot_mutate_it()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, column) = await SeedWorkspaceAsync(owner);

        var viewer = factory.CreateClientAs("viewer-uid");
        await viewer.GetAsync("/me");

        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("viewer-uid"), "Viewer"));

        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync($"/boards/{board.Id}")).StatusCode);

        var attempt = await viewer.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{column.Id}/cards", new CreateCardRequest("Nope", null));

        Assert.Equal(HttpStatusCode.Forbidden, attempt.StatusCode);
    }

    [Fact]
    public async Task Promoting_a_viewer_to_editor_lets_them_mutate()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, column) = await SeedWorkspaceAsync(owner);

        var member = factory.CreateClientAs("member-uid");
        await member.GetAsync("/me");

        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("member-uid"), "Viewer"));

        var roster = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();
        var memberId = roster!.Members.Single(m => m.Role == "Viewer").UserId;

        var promote = await owner.PatchAsJsonAsync(
            $"/workspaces/{workspace.Id}/members/{memberId}", new UpdateMemberRoleRequest("Editor"));
        promote.EnsureSuccessStatusCode();

        var attempt = await member.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{column.Id}/cards", new CreateCardRequest("Now allowed", null));

        Assert.Equal(HttpStatusCode.OK, attempt.StatusCode);
    }

    [Fact]
    public async Task Non_owners_cannot_manage_members()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _, _) = await SeedWorkspaceAsync(owner);

        var editor = factory.CreateClientAs("editor-uid");
        await editor.GetAsync("/me");
        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest(TestAuthHandler.DefaultEmailFor("editor-uid"), "Editor"));

        var attempt = await editor.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest("someone@example.com", "Editor"));

        Assert.Equal(HttpStatusCode.Forbidden, attempt.StatusCode);
    }

    [Fact]
    public async Task A_stranger_gets_404_rather_than_403_for_a_workspace_they_cannot_see()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _, _) = await SeedWorkspaceAsync(owner);

        var stranger = factory.CreateClientAs("stranger-uid");

        Assert.Equal(HttpStatusCode.NotFound,
            (await stranger.GetAsync($"/workspaces/{workspace.Id}/members")).StatusCode);
    }

    [Fact]
    public async Task The_last_owner_cannot_be_demoted_or_removed()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _, _) = await SeedWorkspaceAsync(owner);

        var roster = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();
        var ownerId = roster!.Members.Single().UserId;

        var demote = await owner.PatchAsJsonAsync(
            $"/workspaces/{workspace.Id}/members/{ownerId}", new UpdateMemberRoleRequest("Viewer"));
        Assert.Equal(HttpStatusCode.BadRequest, demote.StatusCode);

        var remove = await owner.DeleteAsync($"/workspaces/{workspace.Id}/members/{ownerId}");
        Assert.Equal(HttpStatusCode.BadRequest, remove.StatusCode);
    }

    [Fact]
    public async Task Re_inviting_the_same_address_updates_the_role_instead_of_duplicating()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _, _) = await SeedWorkspaceAsync(owner);

        const string email = "pending@example.com";
        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members", new InviteMemberRequest(email, "Viewer"));
        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members", new InviteMemberRequest(email, "Editor"));

        var roster = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();

        var invitation = Assert.Single(roster!.PendingInvitations);
        Assert.Equal("Editor", invitation.Role);
    }

    [Fact]
    public async Task Revoking_a_pending_invitation_stops_it_being_claimed()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, _) = await SeedWorkspaceAsync(owner);

        const string email = "revoked@example.com";
        var invite = await (await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest(email, "Editor"))).Content.ReadFromJsonAsync<InviteMemberResponse>();

        var revoke = await owner.DeleteAsync(
            $"/workspaces/{workspace.Id}/members/invitations/{invite!.Invitation!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        var invitee = factory.CreateClientAs("revoked-uid", email);
        Assert.Equal(HttpStatusCode.NotFound, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Workspace_list_returns_only_the_callers_workspaces_with_their_role()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board, _) = await SeedWorkspaceAsync(owner);

        var stranger = factory.CreateClientAs("stranger-uid");
        await stranger.GetAsync("/me");

        var ownerList = await (await owner.GetAsync("/workspaces"))
            .Content.ReadFromJsonAsync<List<WorkspaceSummaryResponse>>();
        var mine = Assert.Single(ownerList!);
        Assert.Equal(workspace.Id, mine.Id);
        Assert.Equal("Owner", mine.Role);
        Assert.Equal(board.Id, Assert.Single(mine.Boards).Id);

        var strangerList = await (await stranger.GetAsync("/workspaces"))
            .Content.ReadFromJsonAsync<List<WorkspaceSummaryResponse>>();
        Assert.Empty(strangerList!);
    }
}
