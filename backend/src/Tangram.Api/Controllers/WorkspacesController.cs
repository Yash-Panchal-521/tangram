using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

[ApiController]
[Authorize]
[Route("workspaces")]
public class WorkspacesController(AppDbContext db, ICurrentUserService currentUser) : ControllerBase
{
    // Everything the client needs to decide where to land after login: which
    // workspaces the caller belongs to, their role in each, and the boards
    // inside. The global query filter already restricts this to the caller's
    // memberships, so there's no manual scoping here.
    [HttpGet]
    public async Task<ActionResult<List<WorkspaceSummaryResponse>>> GetWorkspaces(CancellationToken ct)
    {
        var userId = currentUser.UserId;

        // Projected into a named type rather than an anonymous one: on .NET 10
        // the new System.Linq.AsyncEnumerable.ToListAsync overload makes the
        // call ambiguous when the element type has to be inferred.
        var workspaces = await db.Workspaces
            .OrderBy(w => w.CreatedAt)
            .Select(w => new WorkspaceProjection(
                w.Id,
                w.Name,
                w.Memberships.Where(m => m.UserId == userId).Select(m => m.Role).FirstOrDefault(),
                w.Boards.OrderBy(b => b.CreatedAt).Select(b => new WorkspaceBoardSummary(b.Id, b.Name)).ToList()))
            .ToListAsync(ct);

        // Role is stringified here rather than in the query -- Enum.ToString()
        // has no SQL translation.
        return Ok(workspaces
            .Select(w => new WorkspaceSummaryResponse(w.Id, w.Name, w.Role.ToString(), w.Boards))
            .ToList());
    }

    private record WorkspaceProjection(Guid Id, string Name, MembershipRole Role, List<WorkspaceBoardSummary> Boards);

    [HttpPost]
    public async Task<ActionResult<WorkspaceResponse>> CreateWorkspace(CreateWorkspaceRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Workspace name is required.");
        }

        var now = DateTimeOffset.UtcNow;
        var workspace = new Workspace
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            CreatedBy = currentUser.UserId,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Workspaces.Add(workspace);

        db.Memberships.Add(new Membership
        {
            Id = Guid.NewGuid(),
            WorkspaceId = workspace.Id,
            UserId = currentUser.UserId,
            Role = MembershipRole.Owner,
            CreatedAt = now
        });

        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(CreateWorkspace), new { id = workspace.Id },
            new WorkspaceResponse(workspace.Id, workspace.Name, workspace.CreatedAt));
    }
}
