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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(u => u.FirebaseUid).IsUnique();
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

        modelBuilder.Entity<Operation>(e =>
        {
            e.HasQueryFilter(o => _currentUser.WorkspaceIds.Contains(o.Board.WorkspaceId));
            e.HasIndex(o => new { o.BoardId, o.Seq }).IsUnique();
            e.Property(o => o.Payload).HasColumnType("jsonb");
            e.HasOne(o => o.Board).WithMany(b => b.Operations).HasForeignKey(o => o.BoardId);
        });
    }
}
