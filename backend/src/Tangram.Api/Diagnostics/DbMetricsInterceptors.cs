using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Tangram.Api.Diagnostics;

/// <summary>
/// Counts every statement EF sends, and how long each took.
/// </summary>
/// <remarks>
/// At the interceptor rather than in the services: a service-level stopwatch
/// would only measure the calls somebody remembered to wrap, and the queries
/// that hurt are usually the ones nobody knew were being issued — a lazy
/// <c>Include</c>, a filter that materialises early, an <c>Any()</c> inside a
/// loop. This sees all of them, including the ones EF generates on its own
/// behalf, because it sits below the point where intent stops being visible.
/// </remarks>
public sealed class DbCommandMetricsInterceptor(RequestMetrics metrics) : DbCommandInterceptor
{
    public override DbDataReader ReaderExecuted(
        DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    {
        metrics.Record(eventData.Duration);
        return base.ReaderExecuted(command, eventData, result);
    }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override object? ScalarExecuted(
        DbCommand command, CommandExecutedEventData eventData, object? result)
    {
        metrics.Record(eventData.Duration);
        return base.ScalarExecuted(command, eventData, result);
    }

    public override ValueTask<object?> ScalarExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, object? result,
        CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.ScalarExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override int NonQueryExecuted(
        DbCommand command, CommandExecutedEventData eventData, int result)
    {
        metrics.Record(eventData.Duration);
        return base.NonQueryExecuted(command, eventData, result);
    }

    public override ValueTask<int> NonQueryExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.NonQueryExecutedAsync(command, eventData, result, cancellationToken);
    }

    // A statement that threw still crossed the network, and an endpoint that is
    // slow because something retries is exactly what this is for.
    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData)
    {
        metrics.Record(eventData.Duration);
        base.CommandFailed(command, eventData);
    }

    public override Task CommandFailedAsync(
        DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        metrics.Record(eventData.Duration);
        return base.CommandFailedAsync(command, eventData, cancellationToken);
    }
}
