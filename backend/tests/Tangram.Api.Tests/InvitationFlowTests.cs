using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

// Accepting and declining an invitation by token.
//
// The behaviour these lock down is a deliberate reversal: membership used to be
// granted by matching the caller's email against pending invitations on every
// request. Nothing in this stack verifies an email address, so that made a known
// address sufficient to take someone else's invitation. The token replaces it,
// and the tests are written to fail loudly if the old shortcut ever returns.
public class InvitationFlowTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<(WorkspaceResponse Workspace, BoardResponse Board)> SeedAsync(HttpClient client)
    {
        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Team")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync($"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Roadmap")))
            .Content.ReadFromJsonAsync<BoardResponse>();

        return (workspace, board!);
    }

    private static async Task<PendingInvitationResponse> InviteAsync(
        HttpClient owner, Guid workspaceId, string email, string role = "Editor")
    {
        var response = await owner.PostAsJsonAsync($"/workspaces/{workspaceId}/members",
            new InviteMemberRequest(email, role));
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<InviteMemberResponse>();
        var invitation = result!.Invitation!;

        // The inviter is an owner, so the token is always present here. Asserting
        // it keeps the rest of the file free of null-forgiving noise, and would
        // catch the projection being tightened past the point of usefulness.
        Assert.NotNull(invitation.Token);
        return invitation;
    }

    private async Task ExpireAsync(Guid invitationId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var invitation = await db.Invitations.IgnoreQueryFilters().FirstAsync(i => i.Id == invitationId);
        invitation.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task The_offer_is_readable_without_signing_in()
    {
        // The invitee has to be able to see what they'd be joining before
        // deciding whether to create an account for it.
        var owner = factory.CreateClientAs("owner-uid", name: "Ada Lovelace");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "newcomer@example.com", "Viewer");

        var anonymous = factory.CreateClient();
        var response = await anonymous.GetAsync($"/invitations/{invitation.Token}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var offer = await response.Content.ReadFromJsonAsync<InvitationOfferResponse>();
        Assert.Equal("Team", offer!.WorkspaceName);
        Assert.Equal("Viewer", offer.Role);
        Assert.Equal("Ada Lovelace", offer.InvitedByName);
        Assert.Equal("pending", offer.Status);
    }

    [Fact]
    public async Task The_offer_carries_the_invited_address_for_the_sign_up_prefill()
    {
        // In the response, deliberately, and never in the link. A URL parameter
        // would put the address into browser history, Referer headers and every
        // access log the link passes through. Whoever holds the token could take
        // the membership outright, so reading the address costs nothing extra.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "Newcomer@Example.com");

        var offer = await (await factory.CreateClient().GetAsync($"/invitations/{invitation.Token}"))
            .Content.ReadFromJsonAsync<InvitationOfferResponse>();

        // Normalised, so the prefilled address matches what was actually invited.
        Assert.Equal("newcomer@example.com", offer!.Email);
    }

    [Fact]
    public async Task An_unknown_token_is_a_404()
    {
        var response = await factory.CreateClient().GetAsync("/invitations/not-a-real-token");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Accepting_requires_being_signed_in()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "newcomer@example.com");

        var response = await factory.CreateClient().PostAsync($"/invitations/{invitation.Token}/accept", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anyone_holding_the_link_can_accept_it()
    {
        // A deliberate choice. Binding acceptance to the invited address would
        // be security theatre -- the address is unverified, so it proves
        // nothing -- and it breaks the common case of someone whose work email
        // differs from the one their colleague guessed.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "guessed@example.com");

        var someoneElse = factory.CreateClientAs("other-uid", "actual.address@example.com");
        (await someoneElse.PostAsync($"/invitations/{invitation.Token}/accept", null))
            .EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await someoneElse.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Accepting_grants_exactly_the_role_that_was_offered()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "viewer@example.com", "Viewer");

        var viewer = factory.CreateClientAs("viewer-uid", "viewer@example.com");
        (await viewer.PostAsync($"/invitations/{invitation.Token}/accept", null)).EnsureSuccessStatusCode();

        var create = await viewer.PostAsJsonAsync($"/boards/{board.Id}/columns", new CreateColumnRequest("Nope"));
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task An_accepted_invitation_cannot_be_used_again()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "first@example.com");

        var first = factory.CreateClientAs("first-uid", "first@example.com");
        (await first.PostAsync($"/invitations/{invitation.Token}/accept", null)).EnsureSuccessStatusCode();

        // Otherwise a link forwarded on after use keeps letting people in, and
        // the owner has no way of knowing how many took it.
        var second = factory.CreateClientAs("second-uid", "second@example.com");
        var reuse = await second.PostAsync($"/invitations/{invitation.Token}/accept", null);

        Assert.Equal(HttpStatusCode.Conflict, reuse.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Accepting_twice_from_the_same_person_is_a_conflict_not_a_second_membership()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "newcomer@example.com");

        var newcomer = factory.CreateClientAs("newcomer-uid", "newcomer@example.com");
        (await newcomer.PostAsync($"/invitations/{invitation.Token}/accept", null)).EnsureSuccessStatusCode();
        var again = await newcomer.PostAsync($"/invitations/{invitation.Token}/accept", null);

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);

        // Still exactly one membership, and still able to see the board.
        var roster = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();
        Assert.Equal(2, roster!.Members.Count);
        Assert.Equal(HttpStatusCode.OK, (await newcomer.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task An_expired_invitation_is_refused_and_says_so()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "late@example.com");
        await ExpireAsync(invitation.Id);

        var late = factory.CreateClientAs("late-uid", "late@example.com");
        var response = await late.PostAsync($"/invitations/{invitation.Token}/accept", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await late.GetAsync($"/boards/{board.Id}")).StatusCode);

        var offer = await (await factory.CreateClient().GetAsync($"/invitations/{invitation.Token}"))
            .Content.ReadFromJsonAsync<InvitationOfferResponse>();
        Assert.Equal("expired", offer!.Status);
    }

    [Fact]
    public async Task Declining_leaves_the_person_out_and_the_link_spent()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "nothanks@example.com");

        var invitee = factory.CreateClientAs("nothanks-uid", "nothanks@example.com");
        (await invitee.PostAsync($"/invitations/{invitation.Token}/decline", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);

        var offer = await (await factory.CreateClient().GetAsync($"/invitations/{invitation.Token}"))
            .Content.ReadFromJsonAsync<InvitationOfferResponse>();
        Assert.Equal("declined", offer!.Status);

        // Declining is a decision, not a pause -- the same link must not then
        // work on a second look.
        Assert.Equal(HttpStatusCode.Conflict,
            (await invitee.PostAsync($"/invitations/{invitation.Token}/accept", null)).StatusCode);
    }

    [Fact]
    public async Task Declining_needs_no_account()
    {
        // Otherwise saying no means creating an account first, which is absurd.
        // The token already carries this authority -- anyone who could reach
        // here could have taken the membership instead of refusing it.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "nothanks@example.com");

        var anonymous = factory.CreateClient();
        (await anonymous.PostAsync($"/invitations/{invitation.Token}/decline", null))
            .EnsureSuccessStatusCode();

        var offer = await (await anonymous.GetAsync($"/invitations/{invitation.Token}"))
            .Content.ReadFromJsonAsync<InvitationOfferResponse>();
        Assert.Equal("declined", offer!.Status);
    }

    [Fact]
    public async Task Accepting_still_needs_an_account_even_though_declining_does_not()
    {
        // The asymmetry is the point: refusing costs the holder their own
        // opportunity, joining puts somebody into a tenant. Only one of those
        // needs to know who you are.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "newcomer@example.com");

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await factory.CreateClient().PostAsync($"/invitations/{invitation.Token}/accept", null)).StatusCode);
    }

    [Fact]
    public async Task Declining_is_idempotent()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "nothanks@example.com");

        var invitee = factory.CreateClientAs("nothanks-uid", "nothanks@example.com");
        (await invitee.PostAsync($"/invitations/{invitation.Token}/decline", null)).EnsureSuccessStatusCode();
        var again = await invitee.PostAsync($"/invitations/{invitation.Token}/decline", null);

        // A double-click must not be an error page.
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
    }

    [Fact]
    public async Task A_declined_invitation_still_shows_as_pending_to_the_owner()
    {
        // The owner's list is "who hasn't joined", and someone who said no is
        // exactly who they might want to revoke or ask about.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "nothanks@example.com");

        var invitee = factory.CreateClientAs("nothanks-uid", "nothanks@example.com");
        await invitee.PostAsync($"/invitations/{invitation.Token}/decline", null);

        var roster = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();

        Assert.Single(roster!.PendingInvitations);
    }

    [Fact]
    public async Task Re_inviting_mints_a_fresh_token_and_kills_the_old_link()
    {
        // The point of minting rather than reusing: the previous link may be
        // sitting in a channel the owner no longer wants it in, and re-inviting
        // is the only control they have over that.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var first = await InviteAsync(owner, workspace.Id, "newcomer@example.com", "Viewer");

        var second = await InviteAsync(owner, workspace.Id, "newcomer@example.com", "Editor");
        Assert.NotEqual(first.Token, second.Token);
        Assert.Equal("Editor", second.Role);

        Assert.Equal(HttpStatusCode.NotFound,
            (await factory.CreateClient().GetAsync($"/invitations/{first.Token}")).StatusCode);

        var invitee = factory.CreateClientAs("newcomer-uid", "newcomer@example.com");
        (await invitee.PostAsync($"/invitations/{second.Token}/accept", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Re_inviting_someone_who_declined_adds_them_without_asking_again()
    {
        // Documenting a hole rather than endorsing it.
        //
        // Declining requires signing in, which creates the account. From then on
        // the address is a registered user, and inviting a registered user is
        // the "already has an account, just add them" branch -- no token, no
        // second chance to say no. So a decline can be overridden by the owner
        // clicking Invite again, which is exactly the case decline exists for.
        //
        // Closing it means every invite goes through a link, including for
        // people who already have accounts. That is a product decision, not a
        // bug fix, and it is flagged for one.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var first = await InviteAsync(owner, workspace.Id, "nothanks@example.com");

        var invitee = factory.CreateClientAs("nothanks-uid", "nothanks@example.com");
        (await invitee.PostAsync($"/invitations/{first.Token}/decline", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);

        var again = await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest("nothanks@example.com", "Editor"));
        var result = await again.Content.ReadFromJsonAsync<InviteMemberResponse>();

        Assert.True(result!.Joined);
        Assert.Null(result.Invitation);
        Assert.Equal(HttpStatusCode.OK, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Revoking_makes_the_link_stop_working()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, board) = await SeedAsync(owner);
        var invitation = await InviteAsync(owner, workspace.Id, "newcomer@example.com");

        (await owner.DeleteAsync($"/workspaces/{workspace.Id}/members/invitations/{invitation.Id}"))
            .EnsureSuccessStatusCode();

        var invitee = factory.CreateClientAs("newcomer-uid", "newcomer@example.com");
        Assert.Equal(HttpStatusCode.NotFound,
            (await invitee.PostAsync($"/invitations/{invitation.Token}/accept", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await invitee.GetAsync($"/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Tokens_are_not_guessable_from_each_other()
    {
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);

        var a = await InviteAsync(owner, workspace.Id, "a@example.com");
        var b = await InviteAsync(owner, workspace.Id, "b@example.com");

        Assert.NotEqual(a.Token, b.Token);
        // 32 random bytes, base64url without padding.
        Assert.Equal(43, a.Token!.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", a.Token);
    }

    [Fact]
    public async Task The_token_is_only_ever_shown_to_owners()
    {
        // It is a credential. A viewer who could read it could hand out
        // membership, which is precisely the authority they don't have.
        var owner = factory.CreateClientAs("owner-uid");
        var (workspace, _) = await SeedAsync(owner);

        var viewer = factory.CreateClientAs("viewer-uid", "viewer@example.com");
        await viewer.GetAsync("/me");
        await owner.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
            new InviteMemberRequest("viewer@example.com", "Viewer"));

        var pending = await InviteAsync(owner, workspace.Id, "pending@example.com");

        var asViewer = await (await viewer.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadAsStringAsync();

        Assert.DoesNotContain(pending.Token!, asViewer);
    }
}
