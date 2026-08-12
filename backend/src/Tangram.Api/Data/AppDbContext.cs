using Microsoft.EntityFrameworkCore;
using Tangram.Api.Entities;
using Tangram.Api.Services;

namespace Tangram.Api.Data;

public class AppDbContext : DbContext
{
    private readonly ICurrentUserService _currentUser;

    public AppDbContext(DbContextOptions<AppDbContext> options, ICurrentUserService currentUser)
        : base(options)
    {
        _currentUser = currentUser;
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Board> Boards => Set<Board>();
    public DbSet<Column> Columns => Set<Column>();
    public DbSet<Card> Cards => Set<Card>();
    public DbSet<Operation> Operations => Set<Operation>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<Label> Labels => Set<Label>();
    public DbSet<CardLabel> CardLabels => Set<CardLabel>();
    public DbSet<Comment> Comments => Set<Comment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(u => u.FirebaseUid).IsUnique();

            // Unique so an invitation can never resolve to two users. Postgres
            // permits any number of NULLs under a unique index, which is what
            // keeps email optional.
            e.HasIndex(u => u.Email).IsUnique();
        });

        modelBuilder.Entity<Workspace>(e =>
        {
            e.HasQueryFilter(w => _currentUser.WorkspaceIds.Contains(w.Id));
        });

        modelBuilder.Entity<Membership>(e =>
        {
            e.HasIndex(m => new { m.WorkspaceId, m.UserId }).IsUnique();
            e.Property(m => m.Role).HasConversion<string>();
            e.HasOne(m => m.Workspace).WithMany(w => w.Memberships).HasForeignKey(m => m.WorkspaceId);
            e.HasOne(m => m.User).WithMany(u => u.Memberships).HasForeignKey(m => m.UserId);
        });

        modelBuilder.Entity<Board>(e =>
        {
            e.HasQueryFilter(b => _currentUser.WorkspaceIds.Contains(b.WorkspaceId));
            e.HasOne(b => b.Workspace).WithMany(w => w.Boards).HasForeignKey(b => b.WorkspaceId);
        });

        modelBuilder.Entity<Column>(e =>
        {
            e.HasQueryFilter(c => _currentUser.WorkspaceIds.Contains(c.Board.WorkspaceId));
            // Ordinal collation, because a rank is not text in any language.
            //
            // RankService builds keys from "0-9A-Za-z" and compares them with
            // string.CompareOrdinal, where every uppercase letter sorts before
            // every lowercase one. Postgres was ordering them under the
            // database's en_US collation, which sorts case-insensitively and
            // therefore disagreed — so ORDER BY rank returned a different
            // sequence than the code that generated those ranks assumed.
            //
            // That was not cosmetic. The neighbours picked for a move came from
            // one order while the board was drawn in another, so GenerateBetween
            // was handed a lower that did not sort before its upper and threw;
            // and "the last rank" queries returned the wrong maximum, so two
            // appends could produce the same rank. Setting it here means no
            // query can get it wrong later.
            e.Property(c => c.Rank).UseCollation("C");
            e.HasOne(c => c.Board).WithMany(b => b.Columns).HasForeignKey(c => c.BoardId);
        });

        modelBuilder.Entity<Card>(e =>
        {
            e.HasQueryFilter(c => _currentUser.WorkspaceIds.Contains(c.Column.Board.WorkspaceId));
            // Stored as a string, like MembershipRole, so the column reads as
            // "High" rather than "2" for anyone looking at the database.
            e.Property(c => c.Priority).HasConversion<string>();
            // Same reasoning as Column.Rank above — cards rank identically.
            e.Property(c => c.Rank).UseCollation("C");
            e.HasOne(c => c.Column).WithMany(col => col.Cards).HasForeignKey(c => c.ColumnId);
        });

        modelBuilder.Entity<Label>(e =>
        {
            e.HasQueryFilter(l => _currentUser.WorkspaceIds.Contains(l.Board.WorkspaceId));

            // Two labels called "Bug" on one board are indistinguishable to a
            // person and make the picker useless. Case-insensitive would be
            // better still, but that needs a citext column or a computed index;
            // the API trims and compares case-insensitively before writing.
            e.HasIndex(l => new { l.BoardId, l.Name }).IsUnique();

            e.HasOne(l => l.Board).WithMany(b => b.Labels).HasForeignKey(l => l.BoardId);
        });

        modelBuilder.Entity<CardLabel>(e =>
        {
            // The pair is the identity -- a label is either on a card or not,
            // and applying it twice is the same state, not a second row.
            e.HasKey(cl => new { cl.CardId, cl.LabelId });

            e.HasQueryFilter(cl => _currentUser.WorkspaceIds.Contains(cl.Label.Board.WorkspaceId));

            e.HasOne(cl => cl.Card).WithMany(c => c.CardLabels).HasForeignKey(cl => cl.CardId);
            e.HasOne(cl => cl.Label).WithMany(l => l.CardLabels).HasForeignKey(cl => cl.LabelId);
        });

        modelBuilder.Entity<Comment>(e =>
        {
            e.HasQueryFilter(c => _currentUser.WorkspaceIds.Contains(c.Card.Column.Board.WorkspaceId));

            // The thread is always read whole, oldest first, for one card.
            e.HasIndex(c => new { c.CardId, c.CreatedAt });

            e.HasOne(c => c.Card).WithMany(card => card.Comments).HasForeignKey(c => c.CardId);
        });

        modelBuilder.Entity<Invitation>(e =>
        {
            // Same tenant scoping as everything else, so the owner-facing list
            // and revoke endpoints are isolated for free. The claim path in
            // CurrentUserLoader is the one caller that must bypass this (the
            // invitee has no membership yet) and uses IgnoreQueryFilters().
            e.HasQueryFilter(i => _currentUser.WorkspaceIds.Contains(i.WorkspaceId));

            // Re-inviting the same address updates the existing row's role
            // rather than stacking duplicates.
            e.HasIndex(i => new { i.WorkspaceId, i.Email }).IsUnique();

            // The token is the credential, so lookups go through it and it must
            // be unique. Nothing looks invitations up by email any more.
            e.HasIndex(i => i.Token).IsUnique();

            e.Property(i => i.Role).HasConversion<string>();
            e.HasOne(i => i.Workspace).WithMany(w => w.Invitations).HasForeignKey(i => i.WorkspaceId);
        });

        modelBuilder.Entity<Operation>(e =>
        {
            e.HasQueryFilter(o => _currentUser.WorkspaceIds.Contains(o.Board.WorkspaceId));
            // The only query against this table is resync: everything on a board
            // after the seq a reconnecting client last saw, in order.
            e.HasIndex(o => new { o.BoardId, o.Seq }).IsUnique();

            e.Property(o => o.Payload).HasColumnType("jsonb");
            e.HasOne(o => o.Board).WithMany(b => b.Operations).HasForeignKey(o => o.BoardId);
        });
    }
}
