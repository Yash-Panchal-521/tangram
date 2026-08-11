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
            e.HasOne(c => c.Board).WithMany(b => b.Columns).HasForeignKey(c => c.BoardId);
        });

        modelBuilder.Entity<Card>(e =>
        {
            e.HasQueryFilter(c => _currentUser.WorkspaceIds.Contains(c.Column.Board.WorkspaceId));
            e.HasOne(c => c.Column).WithMany(col => col.Cards).HasForeignKey(c => c.ColumnId);
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
