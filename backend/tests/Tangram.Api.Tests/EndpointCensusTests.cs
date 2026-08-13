using System.Net.Http.Json;
using System.Text;
using System.Text.RegularExpressions;
using Tangram.Api.Dtos;
using Tangram.Api.Tests.Infrastructure;
using Xunit;
using Xunit.Abstractions;

namespace Tangram.Api.Tests;

/// <summary>
/// Every endpoint, and how many database round trips it makes.
/// </summary>
/// <remarks>
/// The budget suite pins four endpoints because those were the ones anybody had
/// looked at. Optimising against four is optimising against a hunch — the whole
/// point of the instrumentation was to stop doing that, and a census is what
/// replaces it.
///
/// One test rather than thirty-one, because the interesting artefact is the
/// *table*: which endpoints are expensive relative to each other, and whether a
/// change to shared machinery moved all of them or only the one being worked on.
/// Thirty-one separate results cannot be read that way.
///
/// The whole table prints on failure, so updating the budgets after a real
/// improvement is a copy rather than an archaeology exercise.
/// </remarks>
public class EndpointCensusTests(TangramWebApplicationFactory factory, ITestOutputHelper output)
    : IClassFixture<TangramWebApplicationFactory>, IAsyncLifetime
{
    public Task InitializeAsync() => factory.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly Regex RoundTripPattern = new(@"desc=""(\d+) round trips", RegexOptions.Compiled);

    private readonly Dictionary<string, int> _measured = [];

    /// <summary>
    /// Ceilings on today's behaviour. Every entry is what the endpoint actually
    /// costs right now, so any addition fails on the machine that made it.
    /// </summary>
    private static readonly Dictionary<string, int> Budgets = new()
    {
        ["GET /health"] = 0,
        ["GET /health/db"] = 1,
        ["GET /me"] = 2,
        ["GET /workspaces"] = 2,
        ["POST /workspaces"] = 4,
        ["POST /workspaces/{id}/boards"] = 3,
        ["GET /boards/{id}"] = 3,
        ["PATCH /boards/{id}"] = 3,
        ["POST /boards/{id}/archive"] = 4,
        ["POST /boards/{id}/columns"] = 8,
        ["POST /boards/{id}/columns/bulk"] = 8,
        ["PATCH /columns/{id}"] = 7,
        ["PATCH /columns/{id}/limits"] = 7,
        ["POST /columns/{id}/move"] = 8,
        ["POST /columns/{id}/cards"] = 8,
        ["PATCH /cards/{id}"] = 9,
        ["POST /cards/{id}/move"] = 10,
        ["DELETE /cards/{id}"] = 7,
        ["POST /boards/{id}/labels"] = 7,
        ["PATCH /labels/{id}"] = 8,
        ["GET /cards/{id}/comments"] = 3,
        ["POST /cards/{id}/comments"] = 8,
        ["PATCH /comments/{id}"] = 8,
        ["GET /workspaces/{id}/members"] = 4,
        ["POST /workspaces/{id}/members"] = 5,
    };

    private async Task<HttpResponseMessage> Measure(string name, Func<Task<HttpResponseMessage>> call)
    {
        var response = await call();

        // A census built from failing calls would measure the error path and
        // report it as the endpoint's cost, which is worse than not measuring:
        // it looks like data.
        Assert.True(
            response.IsSuccessStatusCode,
            $"{name} returned {(int)response.StatusCode}; the census only measures successful calls.");

        Assert.True(response.Headers.TryGetValues("Server-Timing", out var values), $"{name}: no Server-Timing");
        var match = RoundTripPattern.Match(string.Join(", ", values!));
        Assert.True(match.Success, $"{name}: no round-trip count in Server-Timing");

        _measured[name] = int.Parse(match.Groups[1].Value);
        return response;
    }

    private static async Task<T> Read<T>(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<T>())!;

    [Fact]
    public async Task Every_endpoint_stays_within_its_round_trip_budget()
    {
        var client = factory.CreateClientAs("census");
        var anon = factory.CreateClient();

        // Warm first: the very first authenticated request creates the user row,
        // which is a write the steady state never repeats. Measuring it would
        // record a cost no real request pays.
        await client.GetAsync("/me");

        await Measure("GET /health", () => anon.GetAsync("/health"));
        await Measure("GET /health/db", () => anon.GetAsync("/health/db"));
        await Measure("GET /me", () => client.GetAsync("/me"));

        var workspace = await Read<WorkspaceResponse>(await Measure(
            "POST /workspaces", () => client.PostAsJsonAsync("/workspaces", new CreateWorkspaceRequest("Census"))));

        await Measure("GET /workspaces", () => client.GetAsync("/workspaces"));

        var board = await Read<BoardResponse>(await Measure(
            "POST /workspaces/{id}/boards",
            () => client.PostAsJsonAsync($"/workspaces/{workspace.Id}/boards", new CreateBoardRequest("Board"))));

        var column = await Read<ColumnResponse>(await Measure(
            "POST /boards/{id}/columns",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/columns", new CreateColumnRequest("To Do"))));

        var second = await Read<ColumnResponse>(await client.PostAsJsonAsync(
            $"/boards/{board.Id}/columns", new CreateColumnRequest("Done")));

        await Measure("POST /boards/{id}/columns/bulk",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/columns/bulk",
                new CreateColumnsRequest(["Review", "Blocked"])));

        var card = await Read<CardResponse>(await Measure(
            "POST /columns/{id}/cards",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/columns/{column.Id}/cards",
                new CreateCardRequest("Card", null))));

        var label = await Read<LabelResponse>(await Measure(
            "POST /boards/{id}/labels",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/labels", new CreateLabelRequest("bug", null))));

        await Measure("GET /boards/{id}", () => client.GetAsync($"/boards/{board.Id}"));
        await Measure("PATCH /boards/{id}",
            () => client.PatchAsJsonAsync($"/boards/{board.Id}", new RenameBoardRequest("Renamed")));

        await Measure("PATCH /columns/{id}",
            () => client.PatchAsJsonAsync($"/boards/{board.Id}/columns/{column.Id}", new RenameColumnRequest("Doing")));
        await Measure("PATCH /columns/{id}/limits",
            () => client.PatchAsJsonAsync($"/boards/{board.Id}/columns/{column.Id}/limits",
                new SetColumnLimitsRequest(null, 5)));
        await Measure("POST /columns/{id}/move",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/columns/{second.Id}/move",
                new MoveColumnRequest(column.Id)));

        await Measure("PATCH /cards/{id}",
            () => client.PatchAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}",
                new UpdateCardRequest("Renamed", null, null, null, false, false, null, false, [label.Id])));
        await Measure("POST /cards/{id}/move",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}/move",
                new MoveCardRequest(second.Id, null)));

        await Measure("PATCH /labels/{id}",
            () => client.PatchAsJsonAsync($"/boards/{board.Id}/labels/{label.Id}",
                new UpdateLabelRequest("defect", null)));

        var comment = await Read<CommentResponse>(await Measure(
            "POST /cards/{id}/comments",
            () => client.PostAsJsonAsync($"/boards/{board.Id}/cards/{card.Id}/comments",
                new CreateCommentRequest("A comment"))));
        await Measure("GET /cards/{id}/comments",
            () => client.GetAsync($"/boards/{board.Id}/cards/{card.Id}/comments"));
        await Measure("PATCH /comments/{id}",
            () => client.PatchAsJsonAsync($"/boards/{board.Id}/comments/{comment.Id}",
                new UpdateCommentRequest("Edited")));

        await Measure("GET /workspaces/{id}/members",
            () => client.GetAsync($"/workspaces/{workspace.Id}/members"));
        await Measure("POST /workspaces/{id}/members",
            () => client.PostAsJsonAsync($"/workspaces/{workspace.Id}/members",
                new InviteMemberRequest("someone@example.com", "Editor")));

        // Destructive last, so nothing above depends on what they remove.
        await Measure("DELETE /cards/{id}",
            () => client.DeleteAsync($"/boards/{board.Id}/cards/{card.Id}"));

        // A workspace must keep one active board, so archiving needs a second to
        // exist first — the rule is enforced, and a census that measured the 400
        // would be recording the cost of the refusal.
        await client.PostAsJsonAsync($"/workspaces/{workspace.Id}/boards", new CreateBoardRequest("Spare"));
        await Measure("POST /boards/{id}/archive",
            () => client.PostAsync($"/boards/{board.Id}/archive", null));

        Report();
    }

    private void Report()
    {
        var over = new List<string>();
        var table = new StringBuilder();
        table.AppendLine();
        table.AppendLine($"{"endpoint",-38} {"trips",5}  {"budget",6}");

        foreach (var (name, trips) in _measured.OrderByDescending(m => m.Value).ThenBy(m => m.Key))
        {
            var budget = Budgets.TryGetValue(name, out var b) ? b : -1;
            var flag = budget < 0 ? "  NO BUDGET" : trips > budget ? "  OVER" : "";
            table.AppendLine($"{name,-38} {trips,5}  {budget,6}{flag}");
            if (budget < 0 || trips > budget) over.Add($"{name}: {trips} trips, budget {budget}");
        }

        output.WriteLine(table.ToString());

        Assert.True(
            over.Count == 0,
            $"Round-trip budgets exceeded:\n  {string.Join("\n  ", over)}\n{table}");
    }
}
