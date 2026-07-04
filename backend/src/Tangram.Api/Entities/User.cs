namespace Tangram.Api.Entities;

public class User
{
    public Guid Id { get; set; }

    // Firebase's identifier for this user. Reference only — never a foreign key,
    // so the schema stays decoupled from the auth vendor.
    public required string FirebaseUid { get; set; }

    public required string DisplayName { get; set; }
    public string? AvatarUrl { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public ICollection<Membership> Memberships { get; set; } = new List<Membership>();
}
