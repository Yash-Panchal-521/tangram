using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Tangram.Api.Data;

namespace Tangram.Api.Tests.Infrastructure;

public class TangramWebApplicationFactory : WebApplicationFactory<Program>
{
    // Throwaway local test database -- port 5433 is the Dockerised PostgreSQL
    // ('tangram-pg'), since 5432 is taken by the native PostgreSQL service.
    // Overridable so CI can point at its own instance without a code change.
    public static readonly string TestConnectionString =
        Environment.GetEnvironmentVariable("TANGRAM_TEST_POSTGRES")
        ?? "Host=127.0.0.1;Port=5433;Database=tangram_test;Username=postgres;Password=postgres";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] = TestConnectionString,
                ["Firebase:ProjectId"] = "test-project",
            });
        });

        builder.ConfigureTestServices(services =>
        {
            services
                .AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });

            services.Configure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
                options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
            });
        });
    }

    public async Task ResetDatabaseAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE operations, cards, columns, boards, memberships, workspaces, users RESTART IDENTITY CASCADE;");
    }

    // Pass an email to simulate a user whose Firebase address the test chose
    // (so an invitation can be addressed to it); omit it for the deterministic
    // "{uid}@test.tangram" default.
    public HttpClient CreateClientAs(string testUserId, string? email = null)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, testUserId);
        if (email is not null)
        {
            client.DefaultRequestHeaders.Add(TestAuthHandler.EmailHeader, email);
        }
        return client;
    }
}
