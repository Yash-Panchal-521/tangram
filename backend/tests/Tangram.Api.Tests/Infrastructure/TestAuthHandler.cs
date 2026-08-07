using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Tangram.Api.Tests.Infrastructure;

// Stands in for real Firebase JWT validation in tests: the caller picks
// which simulated user they are via the X-Test-User header, instead of
// presenting a real signed token.
public class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";
    public const string UserHeader = "X-Test-User";
    public const string EmailHeader = "X-Test-Email";
    public const string NameHeader = "X-Test-Name";

    // Real Firebase tokens carry an email claim, and invitations are matched on
    // it, so simulated users need one too. Defaults to a deterministic address
    // derived from the uid; X-Test-Email overrides it when a test needs to
    // invite one specific address.
    public static string DefaultEmailFor(string firebaseUid) => $"{firebaseUid}@test.tangram";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserHeader, out var firebaseUid) || string.IsNullOrEmpty(firebaseUid))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var email = Request.Headers.TryGetValue(EmailHeader, out var overrideEmail) && !string.IsNullOrEmpty(overrideEmail)
            ? overrideEmail.ToString()
            : DefaultEmailFor(firebaseUid!);

        var claims = new List<Claim>
        {
            new("user_id", firebaseUid!),
            new(ClaimTypes.Email, email),
        };

        // A real Firebase token omits `name` until the user has a display name
        // set, so tests need to reproduce both a named and an unnamed token.
        // X-Test-Name supplies one; the literal "-" means "send no name claim".
        var name = Request.Headers.TryGetValue(NameHeader, out var overrideName) && !string.IsNullOrEmpty(overrideName)
            ? overrideName.ToString()
            : $"Test User {firebaseUid}";

        if (name != "-")
        {
            claims.Add(new Claim("name", name));
        }

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
