using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;

namespace Tangram.Api.Tests;

/// <summary>
/// How many database round trips each endpoint is allowed to make.
/// </summary>
/// <remarks>
/// A deployed <c>POST /move</c> took 3.1 seconds. Locally the same request is
/// a few milliseconds, because the database is a container on the same machine
/// — which is exactly why no test caught it and why timing assertions would be
/// worthless here: they would measure this laptop, not the deployment.
///
/// So these assert the thing that *is* portable. Round trips are a property of
/// the code, identical on every machine; the price of one is a property of the
/// deployment. Multiply them and you get the latency. Pinning the count means a
/// change that quietly adds four queries fails here, on a developer's machine,
/// in the second it takes to run — rather than in production, where the only
/// symptom is that everything feels slow and nobody can say why.
///
/// The numbers below are today's measured counts, not targets — each is set to
/// exactly what the endpoint does now, so any addition fails immediately. Lower
/// them as the work lands; never raise one without saying what bought the extra
/// trip.
///
/// Where they stand at the start of this phase:
///
/// <code>
/// GET  /boards/{id}      5    the board snapshot, already batched
/// POST /cards           10
/// PATCH /cards/{id}     10    every inline field save
/// POST /move            12    the one that takes 3.1s deployed
/// </code>
///
/// The board load being the *cheapest* of these is the surprise, and it says the
/// problem is not "reads are expensive". It is that every write re-establishes
/// who the caller is and what they may do — twice, through two different code
/// paths — before it touches the row it came to change.
/// </remarks>
public class PerformanceBudgetTests(TangramWebApplicationFactory factory)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly Regex RoundTripPattern =
        new(@"desc=""(\d+) round trips", RegexOptions.Compiled);

    /// <summary>
    /// Reads the count back out of the same header the browser shows, so the
    /// test and the network panel can never disagree about what was measured.
    /// </summary>
    private static int RoundTrips(HttpResponseMessage response)
    {
        Assert.True(
            response.Headers.TryGetValues("Server-Timing", out var values),
            "No Server-Timing header — the instrumentation is not in the pipeline.");

        var header = string.Join(", ", values!);
        var match = RoundTripPattern.Match(header);
        Assert.True(match.Success, $"Server-Timing did not carry a round-trip count: {header}");
        return int.Parse(match.Groups[1].Value);
    }

    private static void WithinBudget(HttpResponseMessage response, int budget, string endpoint)
    {
        var actual = RoundTrips(response);
        Assert.True(
            actual <= budget,
            $"{endpoint} made {actual} database round trips, budget is {budget}. "
                + "Each one is a separate wait on the network — on the deployment that is "
                + "~175ms apiece, so this is not a rounding error. Either fold the extra "
                + "queries into an existing one, or raise the budget here and say what bought it.");
    }

    private async Task<(HttpClient Client, BoardResponse Board, ColumnResponse From, ColumnResponse To, CardResponse Card)>
        SeedAsync(string uid)
    {
        var client = factory.CreateClientAs(uid);

        var workspace = await (await client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Perf")))
            .Content.ReadFromJsonAsync<WorkspaceResponse>();
        var board = await (await client.PostAsJsonAsync(
            $"/workspaces/{workspace!.Id}/boards", new CreateBoardRequest("Board")))
            .Content.ReadFromJsonAsync<BoardResponse>();
        var from = await (await client.PostAsJsonAsync(
            $"/boards/{board!.Id}/columns", new CreateColumnRequest("To Do")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var to = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns", new CreateColumnRequest("Done")))
            .Content.ReadFromJsonAsync<ColumnResponse>();
        var card = await (await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{from!.Id}/cards", new CreateCardRequest("Card", null)))
            .Content.ReadFromJsonAsync<CardResponse>();

        return (client, board, from, to!, card!);
    }

    [Fact]
    public async Task Health_touches_the_database_not_at_all()
    {
        // The control. It proves the header is real rather than a constant, and
        // it is the floor every other number is measured against: whatever this
        // costs on the deployment is overhead no endpoint can avoid.
        var response = await factory.CreateClient().GetAsync("/health");

        Assert.Equal(0, RoundTrips(response));
    }

    [Fact]
    public async Task The_database_probe_costs_exactly_one_round_trip()
    {
        // The other half of the control. /health measures a request with no
        // database at all; this measures one with a single trivial statement, so
        // subtracting one header from the other prices a single round trip on
        // whatever deployment you point it at.
        //
        // The count has to be exactly one for that subtraction to mean anything.
        // If something later makes this endpoint touch the database twice, the
        // arithmetic silently stops working and every conclusion drawn from it
        // is off by a round trip.
        var response = await factory.CreateClient().GetAsync("/health/db");

        Assert.Equal(1, RoundTrips(response));
    }

    [Fact]
    public async Task Moving_a_card_stays_within_budget()
    {
        var (client, board, _, to, card) = await SeedAsync("perf-move");

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/cards/{card.Id}/move", new MoveCardRequest(to.Id, null));

        // The endpoint this phase started from.
        WithinBudget(response, 12, "POST /move");
    }

    [Fact]
    public async Task Loading_a_board_stays_within_budget()
    {
        var (client, board, _, _, _) = await SeedAsync("perf-board");

        var response = await client.GetAsync($"/boards/{board.Id}");

        // The first request of every session, and the one a cold start is
        // measured by.
        WithinBudget(response, 5, "GET /boards/{id}");
    }

    [Fact]
    public async Task Editing_a_card_stays_within_budget()
    {
        var (client, board, _, _, card) = await SeedAsync("perf-edit");

        var response = await client.PatchAsJsonAsync(
            $"/boards/{board.Id}/cards/{card.Id}",
            new UpdateCardRequest("Renamed", null, null, null, false, false, null, false, null));

        // Every inline field in the card detail saves itself, so this is the
        // most frequently hit write path in the app.
        WithinBudget(response, 10, "PATCH /cards/{id}");
    }

    [Fact]
    public async Task Creating_a_card_stays_within_budget()
    {
        var (client, board, from, _, _) = await SeedAsync("perf-create");

        var response = await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns/{from.Id}/cards", new CreateCardRequest("Another", null));

        WithinBudget(response, 10, "POST /cards");
    }
}
