using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Tangram.Api.Diagnostics;

/// <summary>
/// Counts <c>BEGIN</c> and <c>COMMIT</c> as the round trips they are.
/// </summary>
/// <remarks>
/// Separate from the command interceptor because EF routes them through a
/// different interface, and easy to leave out for the same reason — they are not
/// statements anyone wrote. But every mutation here opens a transaction in
/// <c>BoardOperationService.SaveAsync</c>, so leaving them uncounted understates
/// every write path by two, and two out of twelve is the difference between
/// "this endpoint is fine" and "this endpoint is not".
/// </remarks>
public sealed class DbTransactionMetricsInterceptor(RequestMetrics metrics) : DbTransactionInterceptor
{
    public override DbTransaction TransactionStarted(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result)
    {
        metrics.Record(eventData.Duration);
        return base.TransactionStarted(connection, eventData, result);
    }

    public override ValueTask<DbTransaction> TransactionStartedAsync(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result,
        CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.TransactionStartedAsync(connection, eventData, result, cancellationToken);
    }

    public override void TransactionCommitted(DbTransaction transaction, TransactionEndEventData eventData)
    {
        metrics.Record(eventData.Duration);
        base.TransactionCommitted(transaction, eventData);
    }

    public override Task TransactionCommittedAsync(
        DbTransaction transaction, TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.TransactionCommittedAsync(transaction, eventData, cancellationToken);
    }

    public override void TransactionRolledBack(DbTransaction transaction, TransactionEndEventData eventData)
    {
        metrics.Record(eventData.Duration);
        base.TransactionRolledBack(transaction, eventData);
    }

    public override Task TransactionRolledBackAsync(
        DbTransaction transaction, TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.TransactionRolledBackAsync(transaction, eventData, cancellationToken);
    }
}
