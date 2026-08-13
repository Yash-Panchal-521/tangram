using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Tangram.Api.Diagnostics;

/// <summary>
/// How long this request spent opening database connections.
/// </summary>
/// <remarks>
/// Added because a deployed move reported 2.5s of statements and a further 1.7s
/// of "everything else", and opening a connection is invisible to both figures:
/// it is not a <c>DbCommand</c>, so the command interceptor cannot see it, and
/// it happens inside the handler, so it lands in the leftover time with no label
/// on it.
///
/// It is not a small thing to leave unlabelled. A connection to a managed
/// Postgres is TCP, then TLS, then SASL authentication, then — on Neon — a proxy
/// that routes by SNI before any of that reaches a database. Several round trips
/// before a single statement runs. If the pool is empty, which it is on a fresh
/// instance and again whenever connections idle out, every request pays it.
///
/// Reported as its own metric rather than folded into the database total,
/// because the two have different fixes: statements are reduced by asking for
/// less, connections by keeping the pool warm.
/// </remarks>
public sealed class DbConnectionMetricsInterceptor(RequestMetrics metrics) : DbConnectionInterceptor
{
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        metrics.RecordConnectionOpen(eventData.Duration);
        base.ConnectionOpened(connection, eventData);
    }

    public override Task ConnectionOpenedAsync(
        DbConnection connection, ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        metrics.RecordConnectionOpen(eventData.Duration);
        return base.ConnectionOpenedAsync(connection, eventData, cancellationToken);
    }
}
