using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Hubs;

namespace Tangram.Api.Services;

public class BoardOperationNotFoundException(string message) : Exception(message);
public class BoardOperationForbiddenException(string message) : Exception(message);

// The server-authoritative sync spine (Architecture D3): every mutation goes
// through the same pipeline -- authorize -> validate -> assign the next
// board seq (txn) -> persist -> append an operations row -> broadcast to the
// board's SignalR group. Shared by every column/card mutation so REST and
// (later) hub-invoked paths always produce the same broadcast shape.
public interface IBoardOperationService
{
    Task<ColumnResponse> CreateColumnAsync(Guid boardId, string name, CancellationToken ct);
    Task<List<ColumnResponse>> CreateColumnsAsync(Guid boardId, IReadOnlyList<string> names, CancellationToken ct);
    Task<ColumnResponse> RenameColumnAsync(Guid boardId, Guid columnId, string name, CancellationToken ct);
    Task<ColumnResponse> SetColumnLimitsAsync(Guid boardId, Guid columnId, SetColumnLimitsRequest request, CancellationToken ct);
    Task DeleteColumnAsync(Guid boardId, Guid columnId, CancellationToken ct);
    Task<ColumnResponse> MoveColumnAsync(Guid boardId, Guid columnId, Guid? beforeColumnId, CancellationToken ct);

    Task<CardResponse> CreateCardAsync(Guid boardId, Guid columnId, CreateCardRequest request, CancellationToken ct);
    Task<CardResponse> UpdateCardAsync(Guid boardId, Guid cardId, UpdateCardRequest request, CancellationToken ct);
    Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct);
    Task<CardResponse> MoveCardAsync(Guid boardId, Guid cardId, Guid targetColumnId, Guid? beforeCardId, CancellationToken ct);

    Task<LabelResponse> CreateLabelAsync(Guid boardId, string name, string? color, CancellationToken ct);
    Task<LabelResponse> UpdateLabelAsync(Guid boardId, Guid labelId, UpdateLabelRequest request, CancellationToken ct);
    Task DeleteLabelAsync(Guid boardId, Guid labelId, CancellationToken ct);

    Task<List<CommentResponse>> GetCommentsAsync(Guid boardId, Guid cardId, CancellationToken ct);
    Task<CommentResponse> AddCommentAsync(Guid boardId, Guid cardId, string body, CancellationToken ct);
    Task<CommentResponse> EditCommentAsync(Guid boardId, Guid commentId, string body, CancellationToken ct);
    Task DeleteCommentAsync(Guid boardId, Guid commentId, CancellationToken ct);
}

// Raised when what an undo would act on is no longer there -- someone else
// deleted the card, or removed the column it lived in. Surfaces as 409 rather
// than 404: the request was well-formed and the board simply moved on.
public class BoardOperationConflictException(string message) : Exception(message);

// The request is well-formed but asks for something the stored state makes
// contradictory -- a minimum above a maximum already set. Surfaces as 400,
// because the caller can fix it by sending different numbers.
public class BoardOperationInvalidException(string message) : Exception(message);

public class BoardOperationService(
    AppDbContext db,
    IHubContext<BoardHub> hubContext,
    ICurrentUserService currentUser,
    IMembershipService memberships) : IBoardOperationService
{
    public async Task<ColumnResponse> CreateColumnAsync(Guid boardId, string name, CancellationToken ct)
    {
        // The board's existence, its workspace and the rank to append after are
        // three facts about one row. They were three queries.
        var board = await db.Boards
            .Where(b => b.Id == boardId)
            .Select(b => new
            {
                b.WorkspaceId,
                LastRank = b.Columns.OrderByDescending(c => c.Rank).Select(c => c.Rank).FirstOrDefault()
            })
            .FirstOrDefaultAsync(ct);

        if (board is null)
        {
            throw new BoardOperationNotFoundException("Board not found.");
        }

        EnsureCanMutate(board.WorkspaceId);
        var lastRank = board.LastRank;

        var now = DateTimeOffset.UtcNow;
        var column = new Column
        {
            Id = Guid.NewGuid(),
            BoardId = boardId,
            Name = name,
            Rank = RankService.GenerateBetween(lastRank, null),
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Columns.Add(column);

        var response = ToResponse(column);
        await SaveAsync(boardId, new Pending("column.create", response), ct);
        return response;
    }

    public async Task<List<ColumnResponse>> CreateColumnsAsync(
        Guid boardId, IReadOnlyList<string> names, CancellationToken ct)
    {
        // Ranked after whatever is already there, so this appends rather than
        // rebuilding an order somebody chose. The workspace for the permission
        // check comes back on the same row.
        var board = await db.Boards
            .Where(b => b.Id == boardId)
            .Select(b => new
            {
                b.WorkspaceId,
                LastRank = b.Columns.OrderByDescending(c => c.Rank).Select(c => c.Rank).FirstOrDefault()
            })
            .FirstOrDefaultAsync(ct);

        if (board is null)
        {
            throw new BoardOperationNotFoundException("Board not found.");
        }

        EnsureCanMutate(board.WorkspaceId);
        var lastRank = board.LastRank;

        var now = DateTimeOffset.UtcNow;
        var created = new List<ColumnResponse>(names.Count);
        var pending = new List<Pending>(names.Count);

        foreach (var name in names)
        {
            lastRank = RankService.GenerateBetween(lastRank, null);
            var column = new Column
            {
                Id = Guid.NewGuid(),
                BoardId = boardId,
                Name = name,
                Rank = lastRank,
                CreatedAt = now,
                UpdatedAt = now
            };
            db.Columns.Add(column);

            var response = ToResponse(column);
            created.Add(response);
            pending.Add(new Pending("column.create", response));
        }

        // One SaveAsync, so the whole set shares a transaction: a caller with
        // several changes needs all or none, and the seq a client reconciles
        // against must not advance for work that then rolls back.
        await SaveAsync(boardId, pending, ct);
        return created;
    }

    public async Task<ColumnResponse> RenameColumnAsync(Guid boardId, Guid columnId, string name, CancellationToken ct)
    {
        var context = await LoadColumnContextAsync(boardId, columnId, ct);
        EnsureCanMutate(context.WorkspaceId);
        var column = context.Column;

        column.Name = name;
        column.UpdatedAt = DateTimeOffset.UtcNow;

        var response = ToResponse(column);
        await SaveAsync(boardId, new Pending("column.rename", response), ct);
        return response;
    }

    public async Task<ColumnResponse> SetColumnLimitsAsync(
        Guid boardId, Guid columnId, SetColumnLimitsRequest request, CancellationToken ct)
    {
        var context = await LoadColumnContextAsync(boardId, columnId, ct);
        EnsureCanMutate(context.WorkspaceId);
        var column = context.Column;

        var min = request.ClearMinCards ? null : request.MinCards ?? column.MinCards;
        var max = request.ClearMaxCards ? null : request.MaxCards ?? column.MaxCards;

        // Checked here rather than in the controller, against what the request
        // leaves behind rather than what it carries. The controller cannot see
        // the stored column, so raising only the minimum walked straight past a
        // maximum already set and left a column both over and under at once.
        if (min.HasValue && max.HasValue && min > max)
        {
            throw new BoardOperationInvalidException(
                "The minimum can't be more than the maximum.");
        }

        column.MinCards = min;
        column.MaxCards = max;

        column.UpdatedAt = DateTimeOffset.UtcNow;

        // Broadcast as column.rename rather than a new operation type. The
        // payload is a whole ColumnResponse and the reducer replaces the column
        // by id, so a second type would be the same code under another name --
        // and every client would need teaching about it before limits could
        // ship. Same reasoning as priority riding on card.update.
        var response = ToResponse(column);
        await SaveAsync(boardId, new Pending("column.rename", response), ct);
        return response;
    }

    public async Task DeleteColumnAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);

        db.Columns.Remove(column); // DB FK cascade removes contained cards.

        // The cards are gone with it and nothing records them. That was
        // survivable while undo existed and snapshotted them here; with undo
        // removed, deleting a column is final. The confirmation is what stands
        // between a person and that, so it has to keep naming the consequence.
        await SaveAsync(boardId, new Pending("column.delete", new ColumnDeletedPayload(columnId)), ct);
    }

    public async Task<ColumnResponse> MoveColumnAsync(Guid boardId, Guid columnId, Guid? beforeColumnId, CancellationToken ct)
    {
        // The column, its workspace, and every sibling to rank between — one row
        // and one collection hanging off it.
        var loaded = await db.Columns
            .Where(c => c.Id == columnId)
            .Select(c => new
            {
                Column = c,
                c.Board.WorkspaceId,
                Siblings = c.Board.Columns
                    .Where(x => x.Id != columnId)
                    .OrderBy(x => x.Rank)
                    .Select(x => new { x.Id, x.Rank })
                    .ToList()
            })
            .FirstOrDefaultAsync(ct);

        if (loaded is null || loaded.Column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Column not found on this board.");
        }

        EnsureCanMutate(loaded.WorkspaceId);

        var column = loaded.Column;
        var siblings = loaded.Siblings;

        var (lower, upper) = ResolveNeighborRanks(
            siblings.Select(s => (s.Id, s.Rank)).ToList(), beforeColumnId);

        column.Rank = RankService.GenerateBetween(lower, upper);
        column.UpdatedAt = DateTimeOffset.UtcNow;

        var response = ToResponse(column);
        await SaveAsync(boardId, new Pending("column.move", response), ct);
        return response;
    }

    public async Task<CardResponse> CreateCardAsync(
        Guid boardId, Guid columnId, CreateCardRequest request, CancellationToken ct)
    {
        // The column, its workspace and the rank to append after, together. All
        // three hang off the column row the operation had to read regardless.
        var loaded = await db.Columns
            .Where(c => c.Id == columnId)
            .Select(c => new
            {
                Column = c,
                c.Board.WorkspaceId,
                // Ordered in SQL under the column's "C" collation, so it agrees
                // with the ordinal comparison RankService generates against.
                LastRank = c.Cards.OrderByDescending(x => x.Rank).Select(x => x.Rank).FirstOrDefault()
            })
            .FirstOrDefaultAsync(ct);

        if (loaded is null || loaded.Column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Column not found on this board.");
        }

        EnsureCanMutate(loaded.WorkspaceId);

        var column = loaded.Column;
        var lastRank = loaded.LastRank;

        var now = DateTimeOffset.UtcNow;
        var card = new Card
        {
            Id = Guid.NewGuid(),
            ColumnId = column.Id,
            Title = request.Title,
            Description = request.Description,
            AssigneeId = request.AssigneeId,
            Priority = CardPriorityParser.ParseOrNull(request.Priority),
            DueAt = request.DueAt,
            Rank = RankService.GenerateBetween(lastRank, null),
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Cards.Add(card);

        // Labels are attached here rather than through the update path, but the
        // membership check is the same one: an id from another board would
        // otherwise borrow that board's vocabulary onto this card.
        if (request.LabelIds is { Count: > 0 })
        {
            var labels = await db.Labels
                .Where(l => l.BoardId == boardId && request.LabelIds.Contains(l.Id))
                .ToListAsync(ct);

            foreach (var label in labels)
            {
                card.CardLabels.Add(new CardLabel { CardId = card.Id, LabelId = label.Id, Label = label });
            }
        }

        var response = ToResponse(card, commentCount: 0);
        await SaveAsync(boardId, new Pending("card.create", response), ct);
        return response;
    }

    public async Task<CardResponse> UpdateCardAsync(
        Guid boardId, Guid cardId, UpdateCardRequest request, CancellationToken ct)
    {
        // One query for the guard, the card, its labels and its comment count.
        var context = await LoadCardContextAsync(boardId, cardId, ct);
        EnsureCanMutate(context.WorkspaceId);
        var card = context.Card;

        if (request.Title is not null)
        {
            card.Title = request.Title;
        }

        // Description has always been nullable and the panel always sends it,
        // so an omitted description keeps meaning "no description" here.
        card.Description = request.Description;

        if (request.ClearDueAt)
        {
            card.DueAt = null;
        }
        else if (request.DueAt is not null)
        {
            // Normalized to UTC midnight. A due date is a day, not a moment;
            // keeping the submitted time would let two people in different
            // zones disagree about whether the same card is overdue.
            card.DueAt = new DateTimeOffset(request.DueAt.Value.UtcDateTime.Date, TimeSpan.Zero);
        }

        if (request.ClearAssignee)
        {
            card.AssigneeId = null;
        }
        else if (request.AssigneeId is not null)
        {
            // Assigning someone outside the workspace would put a name on the
            // card that nobody there can resolve, so it is refused rather than
            // stored and rendered as a blank avatar.
            var workspaceId = await db.Boards
                .Where(b => b.Id == boardId)
                .Select(b => b.WorkspaceId)
                .FirstAsync(ct);

            var isMember = await memberships.GetRoleAsync(workspaceId, request.AssigneeId.Value, ct) is not null;
            if (!isMember)
            {
                throw new BoardOperationConflictException(
                    "That person isn't a member of this workspace any more.");
            }

            card.AssigneeId = request.AssigneeId;
        }

        if (request.ClearPriority)
        {
            card.Priority = null;
        }
        else if (request.Priority is not null)
        {
            // Already validated by the controller, which is where a malformed
            // request becomes a 400. Parsing again here rather than trusting it
            // keeps the service correct on its own terms -- it is the shared
            // spine, and a second caller would otherwise inherit the check by
            // accident.
            card.Priority = CardPriorityParser.Parse(request.Priority);
        }

        if (request.LabelIds is not null)
        {
            // Set semantics: the list given replaces whatever was there. No
            // Clear flag is needed because an empty list already says "none"
            // unambiguously, unlike a null due date.
            var wanted = request.LabelIds.Distinct().ToList();

            // Every id must be a label on *this* board. Without the check, a
            // caller could attach another board's label and put a name on the
            // card that nobody looking at it can resolve.
            // The entities, not just their ids: the response is built from this
            // card's navigation property, so a join row carrying only a LabelId
            // would leave `cl.Label` null and take the whole request with it.
            var labels = await db.Labels
                .Where(l => l.BoardId == boardId && wanted.Contains(l.Id))
                .ToListAsync(ct);

            if (labels.Count != wanted.Count)
            {
                throw new BoardOperationConflictException(
                    "One of those labels isn't on this board any more.");
            }

            card.CardLabels.Clear();
            foreach (var label in labels)
            {
                card.CardLabels.Add(new CardLabel { CardId = card.Id, LabelId = label.Id, Label = label });
            }
        }

        card.UpdatedAt = DateTimeOffset.UtcNow;

        var response = ToResponse(card, context.CommentCount);
        // Still emitted as "card.rename" rather than a new op type: the
        // operations log holds historical card.rename rows that resync replays,
        // so introducing card.update would mean every client had to understand
        // both forever. The payload is a whole card either way.
        await SaveAsync(boardId, new Pending("card.rename", response), ct);
        return response;
    }

    public async Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        // Loads the labels and comment count it does not need, in exchange for
        // not making a second round trip to learn the workspace. Extra columns on
        // a row the database was already reading are free; a second conversation
        // with Singapore was not, and a second conversation with Ohio still isn't.
        var context = await LoadCardContextAsync(boardId, cardId, ct);
        EnsureCanMutate(context.WorkspaceId);

        var card = context.Card;
        var columnId = card.ColumnId;
        db.Cards.Remove(card);

        await SaveAsync(boardId, new Pending("card.delete", new CardDeletedPayload(cardId, columnId)), ct);
    }

    public async Task<CardResponse> MoveCardAsync(Guid boardId, Guid cardId, Guid targetColumnId, Guid? beforeCardId, CancellationToken ct)
    {
        // Two queries, not five. The card carries its own workspace for the
        // permission check and its own comment count for the response; the target
        // column carries the siblings the new rank is computed between.
        var context = await LoadCardContextAsync(boardId, cardId, ct);
        EnsureCanMutate(context.WorkspaceId);
        var card = context.Card;

        var target = await db.Columns
            .Where(c => c.Id == targetColumnId)
            .Select(c => new
            {
                c.Id,
                c.BoardId,
                // Ordered in SQL, where the column's "C" collation makes the
                // comparison ordinal and therefore agrees with RankService.
                Siblings = c.Cards
                    .Where(x => x.Id != cardId)
                    .OrderBy(x => x.Rank)
                    .Select(x => new { x.Id, x.Rank })
                    .ToList()
            })
            .FirstOrDefaultAsync(ct);

        if (target is null || target.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Column not found on this board.");
        }

        var (lower, upper) = ResolveNeighborRanks(
            target.Siblings.Select(s => (s.Id, s.Rank)).ToList(), beforeCardId);

        card.ColumnId = target.Id;
        card.Rank = RankService.GenerateBetween(lower, upper);
        card.UpdatedAt = DateTimeOffset.UtcNow;

        var response = ToResponse(card, context.CommentCount);
        await SaveAsync(boardId, new Pending("card.move", response), ct);
        return response;
    }

    private static ColumnResponse ToResponse(Column column) =>
        new(column.Id, column.BoardId, column.Name, column.Rank, column.MinCards, column.MaxCards);

    private async Task<Card> LoadCardOrConflictAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        var card = await db.Cards
            .Include(c => c.Column)
            // Labels come back on every CardResponse, and this is the only
            // loader the card operations use.
            .Include(c => c.CardLabels).ThenInclude(cl => cl.Label)
            .FirstOrDefaultAsync(c => c.Id == cardId, ct);
        if (card is null || card.Column.BoardId != boardId)
        {
            throw Conflict("That card has since been deleted.");
        }
        return card;
    }

    private async Task<Column> LoadColumnOrConflictAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        var column = await db.Columns.FirstOrDefaultAsync(c => c.Id == columnId, ct);
        if (column is null || column.BoardId != boardId)
        {
            throw Conflict("That column has since been deleted.");
        }
        return column;
    }

    private static BoardOperationConflictException Conflict(string message) => new(message);

    private static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, JsonOptions)
        ?? throw new InvalidOperationException($"Stored payload could not be read as {typeof(T).Name}.");

    // Operations were serialized with the default (PascalCase) options, but the
    // API's own JSON pipeline is camelCase. Reading them back needs to accept
    // either, or every payload written before this became unreadable.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private async Task<Column> LoadColumnOnBoardAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        var column = await db.Columns.FirstOrDefaultAsync(c => c.Id == columnId, ct);
        if (column is null || column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Column not found on this board.");
        }
        return column;
    }

    /// <summary>
    /// A column and the workspace it belongs to, in one round trip.
    /// </summary>
    /// <remarks>
    /// The same trade as <see cref="LoadCardContextAsync"/>: a column reaches its
    /// workspace through <c>Board.WorkspaceId</c>, so the permission check rides
    /// along with the row the operation was going to load anyway instead of
    /// costing a query of its own.
    /// </remarks>
    private async Task<ColumnContext> LoadColumnContextAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        var loaded = await db.Columns
            .Where(c => c.Id == columnId)
            .Select(c => new { Column = c, c.Board.WorkspaceId })
            .FirstOrDefaultAsync(ct);

        if (loaded is null || loaded.Column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Column not found on this board.");
        }

        return new ColumnContext(loaded.Column, loaded.WorkspaceId);
    }

    private sealed record ColumnContext(Column Column, Guid WorkspaceId);

    /// <summary>
    /// The wire shape of a card, including its labels.
    /// </summary>
    /// <remarks>
    /// One place, because this record is both the REST response and the
    /// broadcast payload -- a field added to one and missed on the other is a
    /// client that disagrees with itself after a reconnect.
    ///
    /// Requires <c>CardLabels</c> to be loaded. An unloaded collection would
    /// serialise as an empty list, which reads as "this card has no labels"
    /// rather than as the bug it is, so the only loader that feeds this
    /// includes them.
    /// </remarks>
    private static CardResponse ToResponse(Card card, int commentCount) =>
        new(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt,
            card.AssigneeId, card.CreatedAt, card.UpdatedAt, card.Priority?.ToString(),
            card.CardLabels
                .Select(cl => new LabelResponse(cl.Label.Id, cl.Label.Name, cl.Label.Color))
                .OrderBy(l => l.Name, StringComparer.OrdinalIgnoreCase)
                .ToList(),
            commentCount);

    /// <remarks>
    /// A count rather than <c>Include(c =&gt; c.Comments)</c>. This record is the
    /// broadcast payload, so a wrong count here overwrites the number on
    /// everyone else's card — but loading every comment on a card to render a
    /// badge is the cost this field exists to avoid. One indexed COUNT, on the
    /// (card_id, created_at) index the thread already needs.
    /// </remarks>
    private Task<int> CountCommentsAsync(Guid cardId, CancellationToken ct) =>
        db.Comments.CountAsync(c => c.CardId == cardId, ct);

    public async Task<LabelResponse> CreateLabelAsync(
        Guid boardId, string name, string? color, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var trimmed = name.Trim();
        // Compared case-insensitively even though the unique index is not.
        // "Bug" and "bug" are the same label to a person, and two of them make
        // the picker useless.
        var clash = await db.Labels.AnyAsync(
            l => l.BoardId == boardId && l.Name.ToLower() == trimmed.ToLower(), ct);
        if (clash)
        {
            throw new BoardOperationConflictException($"This board already has a label called \"{trimmed}\".");
        }

        var label = new Label
        {
            Id = Guid.NewGuid(),
            BoardId = boardId,
            Name = trimmed,
            Color = LabelColors.Normalize(color ?? LabelColors.Default),
            CreatedAt = DateTimeOffset.UtcNow
        };
        db.Labels.Add(label);

        var response = new LabelResponse(label.Id, label.Name, label.Color);
        await SaveAsync(boardId, new Pending("label.create", response), ct);
        return response;
    }

    public async Task<LabelResponse> UpdateLabelAsync(
        Guid boardId, Guid labelId, UpdateLabelRequest request, CancellationToken ct)
    {
        var loadedLabel = await db.Labels
            .Where(l => l.Id == labelId)
            .Select(l => new { Label = l, l.Board.WorkspaceId })
            .FirstOrDefaultAsync(ct);

        if (loadedLabel is null || loadedLabel.Label.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Label not found on this board.");
        }

        EnsureCanMutate(loadedLabel.WorkspaceId);
        var label = loadedLabel.Label;

        if (request.Name is not null)
        {
            var trimmed = request.Name.Trim();
            var clash = await db.Labels.AnyAsync(
                l => l.BoardId == boardId && l.Id != labelId && l.Name.ToLower() == trimmed.ToLower(), ct);
            if (clash)
            {
                throw new BoardOperationConflictException($"This board already has a label called \"{trimmed}\".");
            }
            label.Name = trimmed;
        }

        if (request.Color is not null)
        {
            label.Color = LabelColors.Normalize(request.Color);
        }

        var response = new LabelResponse(label.Id, label.Name, label.Color);
        await SaveAsync(boardId, new Pending("label.update", response), ct);
        return response;
    }

    public async Task DeleteLabelAsync(Guid boardId, Guid labelId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var label = await LoadLabelOnBoardAsync(boardId, labelId, ct);

        // The join rows go with it by cascade. Deliberately not refused when the
        // label is in use: a label nobody can retire because it is on something
        // is a vocabulary that only ever grows.
        db.Labels.Remove(label);

        await SaveAsync(boardId, new Pending("label.delete", new LabelDeletedPayload(labelId)), ct);
    }

    /// <summary>The card's thread, oldest first — the order a conversation reads in.</summary>
    /// <remarks>
    /// Readable by any member, including viewers. Reading a discussion is not a
    /// mutation, and a viewer who can see the card but not why it is the shape
    /// it is has been given half the information.
    /// </remarks>
    public async Task<List<CommentResponse>> GetCommentsAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        // The query filter hides cards outside the caller's workspaces, so a
        // miss here is "not found or not yours" -- the same conflation used
        // everywhere else.
        await LoadCardOnBoardAsync(boardId, cardId, ct);

        return await db.Comments
            .Where(c => c.CardId == cardId)
            .OrderBy(c => c.CreatedAt)
            .Join(db.Users, c => c.AuthorId, u => u.Id, (c, u) => new { Comment = c, u.DisplayName })
            .Select(x => new CommentResponse(
                x.Comment.Id, x.Comment.CardId, x.Comment.AuthorId, x.DisplayName,
                x.Comment.Body, x.Comment.CreatedAt, x.Comment.EditedAt))
            .ToListAsync(ct);
    }

    public async Task<CommentResponse> AddCommentAsync(
        Guid boardId, Guid cardId, string body, CancellationToken ct)
    {
        // The card load doubles as the permission check: it carries the
        // workspace the card belongs to.
        EnsureCanMutate((await LoadCardContextAsync(boardId, cardId, ct)).WorkspaceId);

        var comment = new Comment
        {
            Id = Guid.NewGuid(),
            CardId = cardId,
            AuthorId = currentUser.UserId,
            Body = body,
            CreatedAt = DateTimeOffset.UtcNow
        };
        db.Comments.Add(comment);

        var response = await ToResponseAsync(comment, ct);
        await SaveAsync(boardId, new Pending("comment.create", response), ct);
        return response;
    }

    public async Task<CommentResponse> EditCommentAsync(
        Guid boardId, Guid commentId, string body, CancellationToken ct)
    {
        // A comment reaches its workspace through card -> column -> board, which
        // is three joins and still one round trip.
        var loadedComment = await db.Comments
            .Where(c => c.Id == commentId)
            .Select(c => new { Comment = c, c.Card.Column.BoardId, c.Card.Column.Board.WorkspaceId })
            .FirstOrDefaultAsync(ct);

        if (loadedComment is null || loadedComment.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Comment not found on this board.");
        }

        EnsureCanMutate(loadedComment.WorkspaceId);

        var comment = loadedComment.Comment;
        EnsureAuthor(comment);

        comment.Body = body;
        // Recorded rather than folded into CreatedAt: a comment somebody replied
        // to may no longer say what it said when they replied, and the reader
        // needs to be able to tell.
        comment.EditedAt = DateTimeOffset.UtcNow;

        var response = await ToResponseAsync(comment, ct);
        await SaveAsync(boardId, new Pending("comment.edit", response), ct);
        return response;
    }

    public async Task DeleteCommentAsync(Guid boardId, Guid commentId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var comment = await LoadCommentOnBoardAsync(boardId, commentId, ct);
        EnsureAuthor(comment);

        var cardId = comment.CardId;
        db.Comments.Remove(comment);

        await SaveAsync(boardId, new Pending("comment.delete", new CommentDeletedPayload(commentId, cardId)), ct);
    }

    /// <remarks>
    /// Author only, for both editing and deleting — including for owners.
    /// Putting words in somebody's mouth, or removing what they said, is a
    /// different power from managing a board, and giving it to a role that was
    /// granted for a different reason is not something to do by accident. If
    /// moderation is ever wanted it should be an explicit decision with its own
    /// conversation.
    /// </remarks>
    private void EnsureAuthor(Comment comment)
    {
        if (comment.AuthorId != currentUser.UserId)
        {
            throw new BoardOperationForbiddenException("You can only change your own comments.");
        }
    }

    private async Task<CommentResponse> ToResponseAsync(Comment comment, CancellationToken ct)
    {
        var authorName = await db.Users
            .Where(u => u.Id == comment.AuthorId)
            .Select(u => u.DisplayName)
            .FirstOrDefaultAsync(ct);

        return new CommentResponse(
            comment.Id, comment.CardId, comment.AuthorId, authorName ?? "Someone",
            comment.Body, comment.CreatedAt, comment.EditedAt);
    }

    private async Task<Comment> LoadCommentOnBoardAsync(Guid boardId, Guid commentId, CancellationToken ct)
    {
        var comment = await db.Comments
            .Include(c => c.Card).ThenInclude(card => card.Column)
            .FirstOrDefaultAsync(c => c.Id == commentId, ct);

        if (comment is null || comment.Card.Column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Comment not found on this board.");
        }
        return comment;
    }

    private async Task<Label> LoadLabelOnBoardAsync(Guid boardId, Guid labelId, CancellationToken ct)
    {
        var label = await db.Labels.FirstOrDefaultAsync(l => l.Id == labelId, ct);
        if (label is null || label.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Label not found on this board.");
        }
        return label;
    }

    private async Task<Card> LoadCardOnBoardAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        var card = await db.Cards
            .Include(c => c.Column)
            // Labels come back on every CardResponse, and this is the only
            // loader the card operations use.
            .Include(c => c.CardLabels).ThenInclude(cl => cl.Label)
            .FirstOrDefaultAsync(c => c.Id == cardId, ct);
        if (card is null || card.Column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Card not found on this board.");
        }
        return card;
    }

    // Given siblings ordered by rank and the id of the item the moved entity
    // should land before (null = end of the list), returns the ranks
    // immediately below and above the target gap for RankService to fill.
    private static (string? Lower, string? Upper) ResolveNeighborRanks(
        List<(Guid Id, string Rank)> orderedSiblings, Guid? beforeId)
    {
        if (beforeId is null)
        {
            return (orderedSiblings.Count > 0 ? orderedSiblings[^1].Rank : null, null);
        }

        var index = orderedSiblings.FindIndex(s => s.Id == beforeId);
        if (index < 0)
        {
            throw new BoardOperationNotFoundException("Reference item for the move was not found.");
        }

        var upper = orderedSiblings[index].Rank;
        var lower = index > 0 ? orderedSiblings[index - 1].Rank : null;
        return (lower, upper);
    }

    // One broadcastable change.
    private sealed record Pending(string OpType, object Payload);

    private Task SaveAsync(Guid boardId, Pending op, CancellationToken ct) =>
        SaveAsync(boardId, [op], ct);

    /// <summary>
    /// Appends operations, each with its own board <c>seq</c>, and broadcasts
    /// them. Still takes a list, and they still land in one transaction: a
    /// caller with several changes to make needs all or none of them, and the
    /// seq a client reconciles against must not advance for work that then
    /// rolls back.
    /// </summary>
    private async Task SaveAsync(
        Guid boardId,
        IReadOnlyList<Pending> ops,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var assigned = new List<(long Seq, Pending Op)>(ops.Count);
        foreach (var op in ops)
        {
            // UPDATE ... RETURNING isn't composable SQL, so materialize it
            // directly rather than letting EF try to layer a Single()-style
            // query on top.
            var newSeqRows = await db.Database
                .SqlQuery<long>($"UPDATE boards SET seq = seq + 1 WHERE id = {boardId} RETURNING seq")
                .ToListAsync(ct);
            var newSeq = newSeqRows.Single();

            db.Operations.Add(new Operation
            {
                Id = Guid.NewGuid(),
                BoardId = boardId,
                Seq = newSeq,
                OpType = op.OpType,
                Payload = JsonSerializer.Serialize(op.Payload),
                ActorId = currentUser.UserId,
                CreatedAt = DateTimeOffset.UtcNow
            });

            assigned.Add((newSeq, op));
        }

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        // Broadcast only after the commit. Sending inside the transaction would
        // publish a change that a rollback then erases, and clients have no way
        // to learn that it never happened.
        foreach (var (seq, op) in assigned)
        {
            await hubContext.Clients
                .Group(BoardHub.GroupName(boardId))
                .SendAsync("operation", new OperationBroadcast(seq, op.OpType, op.Payload), ct);
        }
    }

    // Only an owner/editor membership in the board's workspace may mutate it.
    // Role resolution is delegated to IMembershipService so this and the
    // workspace member endpoints share one RBAC definition.
    /// <summary>
    /// The role half of the guard, for callers that already know the workspace.
    /// </summary>
    /// <remarks>
    /// <see cref="EnsureCanMutateAsync"/> spends a round trip turning a board id
    /// into a workspace id. Any operation that loads a card or a column is one
    /// join away from that workspace already — <c>Card.Column.Board.WorkspaceId</c>
    /// — so it can carry the id out of a query it was making regardless and skip
    /// the lookup entirely.
    ///
    /// Note the reordering this implies: the entity is loaded before the role is
    /// checked, so a viewer naming a card that does not exist now gets 404 rather
    /// than 403. That is the direction this codebase already leans — the tenant
    /// filter deliberately conflates "not found" and "not permitted" — and the
    /// weaker leak is the right one.
    /// </remarks>
    private void EnsureCanMutate(Guid workspaceId)
    {
        if (currentUser.RoleIn(workspaceId) is null or MembershipRole.Viewer)
        {
            throw new BoardOperationForbiddenException("Viewers cannot modify the board.");
        }
    }

    /// <summary>
    /// A card, plus everything an operation on it needs, in one round trip.
    /// </summary>
    /// <remarks>
    /// Replaces four separate queries: the board's workspace for the permission
    /// check, the card with its labels, and the comment count for the response.
    /// All of it hangs off the card by a join, and the database was already
    /// visiting those rows.
    ///
    /// The label rows are projected as entities rather than as DTOs so EF's
    /// relationship fixup wires <c>card.CardLabels</c> and each <c>cl.Label</c>
    /// on the tracked card — which is what <c>ToResponse</c> reads. Projecting
    /// only the labels would leave the join collection empty and every response
    /// would silently lose its labels.
    /// </remarks>
    private async Task<CardContext> LoadCardContextAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        var loaded = await db.Cards
            .Where(c => c.Id == cardId)
            .Select(c => new
            {
                Card = c,
                Links = c.CardLabels.ToList(),
                Labels = c.CardLabels.Select(cl => cl.Label).ToList(),
                c.Column.BoardId,
                c.Column.Board.WorkspaceId,
                CommentCount = c.Comments.Count()
            })
            .FirstOrDefaultAsync(ct);

        if (loaded is null || loaded.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Card not found on this board.");
        }

        return new CardContext(loaded.Card, loaded.WorkspaceId, loaded.CommentCount);
    }

    private sealed record CardContext(Card Card, Guid WorkspaceId, int CommentCount);

    private async Task EnsureCanMutateAsync(Guid boardId, CancellationToken ct)
    {
        var workspaceId = await db.Boards
            .Where(b => b.Id == boardId)
            .Select(b => b.WorkspaceId)
            .FirstOrDefaultAsync(ct);

        if (workspaceId == Guid.Empty)
        {
            throw new BoardOperationNotFoundException("Board not found.");
        }

        // From memory. The loader read this user's memberships to build the tenant
        // filter at the start of the request; the role was on those same rows.
        // Asking the database again cost a round trip on every single mutation.
        var role = currentUser.RoleIn(workspaceId);

        if (role is null or MembershipRole.Viewer)
        {
            throw new BoardOperationForbiddenException("Viewers cannot modify the board.");
        }
    }
}
