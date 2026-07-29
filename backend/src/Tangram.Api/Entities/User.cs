namespace Tangram.Api.Entities;

public class User
{
    public Guid Id { get; set; }

    // Firebase's identifier for this user. Reference only — never a foreign key,
    // so the schema stays decoupled from the auth vendor.
    public required string FirebaseUid { get; set; }

    // Normalized to lowercase (see EmailAddress.Normalize) because invitations
    // are matched on it. Nullable: not every auth provider supplies an email,
    // and rows created before invitations existed have none until the owner
    // signs in again.
    public string? Email { get; set; }

    public required string DisplayName { get; set; }
    public string? AvatarUrl { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public ICollection<Membership> Memberships { get; set; } = new List<Membership>();
}
