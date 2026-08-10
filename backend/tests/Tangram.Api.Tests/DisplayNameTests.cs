using System.Net.Http.Json;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

// Display names come from the Firebase token, and the row used to be written
// once and never revisited. Signing up races the profile update against the
// first API call, so the row was routinely created from the email local part
// and kept that name permanently.
public class DisplayNameTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<string> DisplayNameOf(HttpClient client) =>
        (await (await client.GetAsync("/me")).Content.ReadFromJsonAsync<MeResponse>())!.DisplayName;

    [Fact]
    public async Task A_token_without_a_name_falls_back_to_the_email_local_part()
    {
        var client = factory.CreateClientAs("harsh-uid", "harsh1806@gmail.com", name: "-");

        Assert.Equal("harsh1806", await DisplayNameOf(client));
    }

    // The reported bug, end to end: invited, first seen via a token with no
    // name, then signs up as "Harsh Panchal".
    [Fact]
    public async Task A_later_token_carrying_a_real_name_replaces_the_email_fallback()
    {
        const string email = "harsh1806@gmail.com";

        var beforeProfile = factory.CreateClientAs("harsh-uid", email, name: "-");
        Assert.Equal("harsh1806", await DisplayNameOf(beforeProfile));

        var afterProfile = factory.CreateClientAs("harsh-uid", email, name: "Harsh Panchal");

        Assert.Equal("Harsh Panchal", await DisplayNameOf(afterProfile));
    }

    [Fact]
    public async Task A_token_without_a_name_never_downgrades_a_real_name()
    {
        // The dangerous inverse: if any request arrives without the claim, it
        // must not overwrite a good name with the email fallback.
        const string email = "harsh1806@gmail.com";

        var named = factory.CreateClientAs("harsh-uid", email, name: "Harsh Panchal");
        Assert.Equal("Harsh Panchal", await DisplayNameOf(named));

        var unnamed = factory.CreateClientAs("harsh-uid", email, name: "-");

        Assert.Equal("Harsh Panchal", await DisplayNameOf(unnamed));
    }

    [Fact]
    public async Task A_renamed_user_is_tracked_on_the_next_request()
    {
        var before = factory.CreateClientAs("uid-1", "a@b.com", name: "Old Name");
        Assert.Equal("Old Name", await DisplayNameOf(before));

        var after = factory.CreateClientAs("uid-1", "a@b.com", name: "New Name");

        Assert.Equal("New Name", await DisplayNameOf(after));
    }

    [Fact]
    public async Task The_corrected_name_shows_up_in_the_member_roster()
    {
        // What the bug actually looked like: the roster kept showing the
        // email-derived name after the invitee had signed up properly.
        const string inviteeEmail = "harsh1806@gmail.com";

        var owner = factory.CreateClientAs("owner-uid");
        var workspace = await (await owner.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Team")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();

        var invited = await (await owner.PostAsJsonAsync($"/workspaces/{workspace!.Id}/members",
            new InviteMemberRequest(inviteeEmail, "Editor")))
            .Content.ReadFromJsonAsync<InviteMemberResponse>();

        // Accepts on a token that has no name claim yet, which is exactly the
        // window the bug lived in: the user row is created from the email
        // local-part, and the roster then has to notice when the real name
        // arrives on a later request.
        var invitee = factory.CreateClientAs("harsh-uid", inviteeEmail, name: "-");
        (await invitee.PostAsync($"/invitations/{invited!.Invitation!.Token}/accept", null))
            .EnsureSuccessStatusCode();

        var beforeSignup = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();
        Assert.Contains(beforeSignup!.Members, m => m.DisplayName == "harsh1806");

        // They set a display name; the next request carries it.
        var named = factory.CreateClientAs("harsh-uid", inviteeEmail, name: "Harsh Panchal");
        await named.GetAsync("/me");

        var afterSignup = await (await owner.GetAsync($"/workspaces/{workspace.Id}/members"))
            .Content.ReadFromJsonAsync<WorkspaceMembersResponse>();

        Assert.Contains(afterSignup!.Members, m => m.DisplayName == "Harsh Panchal");
        Assert.DoesNotContain(afterSignup.Members, m => m.DisplayName == "harsh1806");
    }

    [Fact]
    public async Task Whitespace_only_names_are_treated_as_absent()
    {
        var client = factory.CreateClientAs("uid-2", "spacey@example.com", name: "   ");

        Assert.Equal("spacey", await DisplayNameOf(client));
    }
}
