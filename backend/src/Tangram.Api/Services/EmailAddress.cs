namespace Tangram.Api.Services;

// One definition of "the same email address" for the whole app. Invitations are
// matched against User.Email by exact index lookup, so both sides must be
// normalized identically -- otherwise inviting "Sam@Example.com" silently never
// resolves for a user who signed up as "sam@example.com".
public static class EmailAddress
{
    public static string Normalize(string email) => email.Trim().ToLowerInvariant();

    public static string? NormalizeOrNull(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : Normalize(email);
}
