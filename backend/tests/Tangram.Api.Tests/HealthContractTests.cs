using System.Net.Http.Json;
using System.Text.Json;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// <c>/health</c> is consumed by the deploy pipeline, not just by humans.
/// </summary>
/// <remarks>
/// CI advances the <c>release</c> branch — which is what Vercel builds — only
/// once it has seen the backend serving the commit it just promoted. It learns
/// that by polling this endpoint and comparing <c>commit</c> against the SHA.
///
/// So the shape here is a contract with the workflow. Drop the field and nothing
/// fails loudly: the poll simply never matches, CI waits ten minutes and then
/// reports a deploy that did not happen. These tests make that a fast, local,
/// obvious failure instead.
/// </remarks>
public class HealthContractTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>
{
    [Fact]
    public async Task Health_reports_the_commit_it_is_running()
    {
        var response = await factory.CreateClient().GetAsync("/health");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("ok", body.GetProperty("status").GetString());

        // "local" off a developer's machine and in CI, because Render is what
        // injects RENDER_GIT_COMMIT. The value is not the point — the field
        // being there, and being a non-empty string, is.
        var commit = body.GetProperty("commit").GetString();
        Assert.False(string.IsNullOrWhiteSpace(commit), "/health must report a commit.");
    }

    [Fact]
    public async Task Health_needs_no_authentication()
    {
        // The workflow polls without credentials, and so does Render's own
        // health checking. An [Authorize] slipped onto this would strand every
        // release.
        var response = await factory.CreateClient().GetAsync("/health");

        Assert.True(response.IsSuccessStatusCode);
    }
}
