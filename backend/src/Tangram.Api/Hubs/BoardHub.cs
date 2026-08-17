using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Services;

namespace Tangram.Api.Hubs;

[Authorize]
public class BoardHub(AppDbContext db, ICurrentUserLoader loader, IPresenceTracker presence) : Hub
{
    private const int MaxResyncGap = 200;

    public static string GroupName(Guid boardId) => $"board:{boardId}";

    public async Task<List<PresenceUser>> JoinBoard(Guid boardId)
    {
        var user = await loader.LoadAsync(Context.User!, Context.ConnectionAborted);

        var hasAccess = await db.Boards.AnyAsync(b => b.Id == boardId, Context.ConnectionAborted);
        if (!hasAccess)
        {
            throw new HubException("Board not found or access denied.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(boardId), Context.ConnectionAborted);

        Context.Items["boardId"] = boardId;
        Context.Items["userId"] = user.Id;
        Context.Items["displayName"] = user.DisplayName;

        var isFirstConnection = presence.AddConnection(boardId, user.Id, user.DisplayName, Context.ConnectionId);
        if (isFirstConnection)
        {
            await Clients.OthersInGroup(GroupName(boardId))
                .SendAsync("presence.join", new PresenceUser(user.Id, user.DisplayName), Context.ConnectionAborted);
        }

        return presence.GetPresentUsers(boardId).Where(p => p.UserId != user.Id).ToList();
    }

    public async Task UpdateCursor(double x, double y)
    {
        if (!TryGetConnectionContext(out var boardId, out var userId, out var displayName))
        {
            return;
        }

        // Excluded by *user*, not by connection.
        //
        // `OthersInGroup` leaves out the connection that called, which is not
        // the same thing as leaving out the person who called. Duplicate the
        // tab and the second connection receives the first one's frames, so you
        // watch a cursor with your own name on it drift around the board while
        // your real pointer sits somewhere else.
        //
        // Presence next door already reasons in users rather than connections —
        // it announces on the first and withdraws on the last — and this is the
        // one broadcast that never caught up. Dropped at the source rather than
        // hidden in the client because cursor frames are the highest-frequency
        // message here, twenty a second per mover, and none of them were worth
        // sending.
        await Clients
            .GroupExcept(GroupName(boardId), presence.GetConnections(boardId, userId))
            .SendAsync("cursor", new CursorUpdate(userId, displayName, x, y), Context.ConnectionAborted);
    }

    // Called after a client (re)joins following a dropped connection. Delta-
    // replays operations since the client's last-seen seq, or signals a full
    // snapshot is needed if the gap is too large to replay cheaply.
    public async Task<ResyncResult> Resync(Guid boardId, long lastSeenSeq)
    {
        await loader.LoadAsync(Context.User!, Context.ConnectionAborted);

        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == boardId, Context.ConnectionAborted);
        if (board is null)
        {
            throw new HubException("Board not found or access denied.");
        }

        if (lastSeenSeq <= 0 || lastSeenSeq > board.Seq || board.Seq - lastSeenSeq > MaxResyncGap)
        {
            return new ResyncResult(true, []);
        }

        // JsonDocument.Parse can't be translated to SQL, so materialize the
        // raw rows first and parse the payload back into JSON client-side.
        var rows = await db.Operations
            .Where(o => o.BoardId == boardId && o.Seq > lastSeenSeq)
            .OrderBy(o => o.Seq)
            .Select(o => new { o.Seq, o.OpType, o.Payload })
            .ToListAsync(Context.ConnectionAborted);

        var operations = rows
            .Select(o => new OperationBroadcast(o.Seq, o.OpType, JsonDocument.Parse(o.Payload).RootElement))
            .ToList();

        return new ResyncResult(false, operations);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (TryGetConnectionContext(out var boardId, out var userId, out var displayName))
        {
            var wasLastConnection = presence.RemoveConnection(boardId, userId, Context.ConnectionId);
            if (wasLastConnection)
            {
                await Clients.Group(GroupName(boardId))
                    .SendAsync("presence.leave", new PresenceUser(userId, displayName));
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    private bool TryGetConnectionContext(out Guid boardId, out Guid userId, out string displayName)
    {
        boardId = Context.Items.TryGetValue("boardId", out var b) && b is Guid bid ? bid : Guid.Empty;
        userId = Context.Items.TryGetValue("userId", out var u) && u is Guid uid ? uid : Guid.Empty;
        displayName = Context.Items.TryGetValue("displayName", out var n) && n is string name ? name : "";
        return boardId != Guid.Empty && userId != Guid.Empty;
    }
}
