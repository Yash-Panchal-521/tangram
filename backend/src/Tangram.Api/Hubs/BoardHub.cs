using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Services;

namespace Tangram.Api.Hubs;

[Authorize]
public class BoardHub(AppDbContext db, ICurrentUserLoader loader) : Hub
{
    public static string GroupName(Guid boardId) => $"board:{boardId}";

    public async Task JoinBoard(Guid boardId)
    {
        await loader.LoadAsync(Context.User!, Context.ConnectionAborted);

        var hasAccess = await db.Boards.AnyAsync(b => b.Id == boardId, Context.ConnectionAborted);
        if (!hasAccess)
        {
            throw new HubException("Board not found or access denied.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(boardId), Context.ConnectionAborted);
    }
}
