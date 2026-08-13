using System.Globalization;

namespace Tangram.Api.Diagnostics;

/// <summary>
/// What one request spent talking to the database. Scoped, so there is exactly
/// one per request, and the EF interceptors write to the same instance the
/// response header is built from.
/// </summary>
/// <remarks>
/// Written because a deployed <c>POST /move</c> took 3.1 seconds and nothing in
/// the system could say which part. Arithmetic offered two explanations that fit
/// the same number equally well — twelve round trips over a slow link, or one
/// slow query — and they need opposite fixes. Guessing between them is how you
/// spend a week optimising the wrong half.
///
/// So the header carries the slowest single round trip alongside the count.
/// Twelve trips totalling 2.1s with a slowest of ~175ms is a *flat* distribution:
/// every statement costs the same regardless of what it asks for, which is the
/// signature of network latency, and the fix is fewer trips or a closer database.
/// Twelve totalling 2.1s with a slowest of 2.0s is one bad query, and the fix is
/// an index. Same total, nothing else in common.
///
/// The counters are Interlocked because a request may run queries concurrently;
/// today none do, but a future <c>Task.WhenAll</c> over two reads would silently
/// corrupt a plain <c>++</c> and the resulting number would look plausible.
/// </remarks>
public sealed class RequestMetrics
{
    private int _roundTrips;
    private long _databaseTicks;
    private long _slowestTicks;
    private int _connectionOpens;
    private long _connectionTicks;
    private long _broadcastTicks;

    /// <summary>Every statement, including the ones that threw.</summary>
    /// <remarks>
    /// A failed statement still costs a round trip, and an endpoint that is slow
    /// because it retries is exactly the kind of thing this is meant to expose.
    /// </remarks>
    public void Record(TimeSpan duration)
    {
        Interlocked.Increment(ref _roundTrips);
        Interlocked.Add(ref _databaseTicks, duration.Ticks);

        // Compare-and-swap rather than a lock: contention is near zero, and a
        // lock here would sit on the hot path of every query in the process.
        var ticks = duration.Ticks;
        var observed = Volatile.Read(ref _slowestTicks);
        while (ticks > observed)
        {
            var previous = Interlocked.CompareExchange(ref _slowestTicks, ticks, observed);
            if (previous == observed) break;
            observed = previous;
        }
    }

    /// <summary>
    /// Opening a connection, which is not a statement and is not free: TCP, TLS,
    /// SASL, and on Neon an SNI proxy hop before any of it reaches a database.
    /// </summary>
    public void RecordConnectionOpen(TimeSpan duration)
    {
        Interlocked.Increment(ref _connectionOpens);
        Interlocked.Add(ref _connectionTicks, duration.Ticks);
    }

    /// <summary>
    /// Time spent pushing this operation to the board's SignalR group.
    /// </summary>
    /// <remarks>
    /// Measured because the broadcast is awaited on the request path, which means
    /// a client that is slow to accept the message delays the response to the
    /// person who caused it. A deployed move showed 7 round trips costing 180ms
    /// and 1771ms of application time on a warm instance — not JIT, not the
    /// database, and this is the only thing left in the write path that waits on
    /// something outside the process.
    ///
    /// Its own metric rather than part of "app", because the two lead to
    /// different places: application time is work, and this is waiting.
    /// </remarks>
    public void RecordBroadcast(TimeSpan duration) =>
        Interlocked.Add(ref _broadcastTicks, duration.Ticks);

    public int RoundTrips => Volatile.Read(ref _roundTrips);

    public TimeSpan BroadcastTime => TimeSpan.FromTicks(Volatile.Read(ref _broadcastTicks));

    public int ConnectionOpens => Volatile.Read(ref _connectionOpens);

    public TimeSpan ConnectionTime => TimeSpan.FromTicks(Volatile.Read(ref _connectionTicks));

    public TimeSpan DatabaseTime => TimeSpan.FromTicks(Volatile.Read(ref _databaseTicks));

    public TimeSpan SlowestRoundTrip => TimeSpan.FromTicks(Volatile.Read(ref _slowestTicks));

    /// <summary>
    /// The W3C Server-Timing value for this request. Chrome, Firefox and Safari
    /// all render it in the network panel's timing tab without a plugin, which
    /// is the point: the numbers show up where the slowness was noticed, in the
    /// deployment where it actually happens, rather than in a profiler nobody
    /// runs against production.
    /// </summary>
    public string ToServerTiming(TimeSpan total)
    {
        var database = DatabaseTime;
        var connections = ConnectionTime;
        var broadcast = BroadcastTime;

        // Clamp: these are measured by different clocks — EF reports each
        // command's own duration, the middleware wraps the whole pipeline — and
        // concurrent queries would let the sum exceed the wall time. A negative
        // "app" figure would read as a bug in the app rather than in the metric.
        var application = total - database - connections - broadcast;
        if (application < TimeSpan.Zero) application = TimeSpan.Zero;

        return string.Create(
            CultureInfo.InvariantCulture,
            $"db;dur={database.TotalMilliseconds:F1};desc=\"{RoundTrips} round trips, slowest {SlowestRoundTrip.TotalMilliseconds:F0}ms\", "
                + $"conn;dur={connections.TotalMilliseconds:F1};desc=\"{ConnectionOpens} opened\", "
                + $"push;dur={broadcast.TotalMilliseconds:F1}, "
                + $"app;dur={application.TotalMilliseconds:F1}, total;dur={total.TotalMilliseconds:F1}");
    }
}
