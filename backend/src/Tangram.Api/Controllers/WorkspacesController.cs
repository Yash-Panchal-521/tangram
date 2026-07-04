using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
