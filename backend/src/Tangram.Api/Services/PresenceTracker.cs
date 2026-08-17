using System.Collections.Concurrent;
using System.Threading;

namespace Tangram.Api.Services;

public record PresenceUser(Guid UserId, string DisplayName);

// In-memory presence for a single instance (per D-decisions, Redis-backed
// presence for multi-instance scaling is Slice 5). Counts connections per
// user so a user with two tabs open doesn't flicker in and out of presence
// when only one of them disconnects.
public interface IPresenceTracker
{
    // Returns true if this was the user's first connection to the board (caller should broadcast a join).
    bool AddConnection(Guid boardId, Guid userId, string displayName, string connectionId);

    // Returns true if this was the user's last connection to the board (caller should broadcast a leave).
    bool RemoveConnection(Guid boardId, Guid userId, string connectionId);

    IReadOnlyList<PresenceUser> GetPresentUsers(Guid boardId);

    // Every connection this user has to this board — which is more than one as
    // soon as they duplicate the tab. Used to keep a broadcast away from its own
    // author across all their tabs, not just the one that sent it.
    IReadOnlyList<string> GetConnections(Guid boardId, Guid userId);
}

public class PresenceTracker : IPresenceTracker
{
    private class UserConnections
    {
        public required string DisplayName { get; init; }
        public HashSet<string> ConnectionIds { get; } = [];
    }

    private class BoardPresence
    {
        public readonly Lock Lock = new();
        public Dictionary<Guid, UserConnections> Users { get; } = [];
    }

    private readonly ConcurrentDictionary<Guid, BoardPresence> _boards = new();

    public bool AddConnection(Guid boardId, Guid userId, string displayName, string connectionId)
    {
        var board = _boards.GetOrAdd(boardId, _ => new BoardPresence());
        lock (board.Lock)
        {
            if (!board.Users.TryGetValue(userId, out var user))
            {
                user = new UserConnections { DisplayName = displayName };
                board.Users[userId] = user;
            }

            var isFirstConnection = user.ConnectionIds.Count == 0;
            user.ConnectionIds.Add(connectionId);
            return isFirstConnection;
        }
    }

    public bool RemoveConnection(Guid boardId, Guid userId, string connectionId)
    {
        if (!_boards.TryGetValue(boardId, out var board))
        {
            return false;
        }

        lock (board.Lock)
        {
            if (!board.Users.TryGetValue(userId, out var user))
            {
                return false;
            }

            user.ConnectionIds.Remove(connectionId);
            if (user.ConnectionIds.Count > 0)
            {
                return false;
            }

            board.Users.Remove(userId);
            return true;
        }
    }

    public IReadOnlyList<PresenceUser> GetPresentUsers(Guid boardId)
    {
        if (!_boards.TryGetValue(boardId, out var board))
        {
            return [];
        }

        lock (board.Lock)
        {
            return board.Users.Select(kv => new PresenceUser(kv.Key, kv.Value.DisplayName)).ToList();
        }
    }

    public IReadOnlyList<string> GetConnections(Guid boardId, Guid userId)
    {
        if (!_boards.TryGetValue(boardId, out var board))
        {
            return [];
        }

        lock (board.Lock)
        {
            // Copied inside the lock. Handing out the live set would let a
            // caller enumerate it while another connection joins or drops.
            return board.Users.TryGetValue(userId, out var user)
                ? user.ConnectionIds.ToList()
                : [];
        }
    }
}
