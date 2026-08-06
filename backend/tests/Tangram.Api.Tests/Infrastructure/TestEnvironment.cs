using System.Runtime.CompilerServices;

namespace Tangram.Api.Tests.Infrastructure;

internal static class TestEnvironment
{
    // Program.cs reads Firebase:ProjectId straight off the configuration before
    // builder.Build(), which is earlier than WebApplicationFactory's
    // ConfigureAppConfiguration can contribute anything -- and the test
    // project's content root isn't the API project's, so its appsettings.json
    // isn't found either. Net effect: the suite used to need a developer's
    // user-secrets or an explicit env var, and failed outright on a fresh clone
    // or a CI runner.
    //
    // Environment variables *are* in the configuration by the time that line
    // runs, so seeding one before any host is created fixes it at the source. A
    // module initializer runs before the first test class is even constructed,
    // which is the earliest hook available.
    //
    // Only set when absent, so a real value can still be supplied to override
    // it. The value itself is irrelevant to the tests: TestAuthHandler replaces
    // Firebase JWT validation entirely, and this only has to be non-null.
    [ModuleInitializer]
    internal static void SeedConfiguration()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("Firebase__ProjectId")))
        {
            Environment.SetEnvironmentVariable("Firebase__ProjectId", "tangram-tests");
        }
    }
}
