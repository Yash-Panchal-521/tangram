using System.Diagnostics;
using Tangram.Api.Diagnostics;

namespace Tangram.Api.Middleware;

/// <summary>
/// Puts each request's own timing on the response, split into database and
/// everything else.
/// </summary>
/// <remarks>
/// On in production, deliberately. Production is the only place the interesting
/// latency exists — the local database answers in under a millisecond, so a
/// profiler run here would show a request path that looks perfectly healthy and
/// is 3 seconds slower once deployed. The cost is a few interlocked increments
/// per query and one header per response.
///
/// It wraps everything, including authentication, because "the endpoint is fast
/// but the request is slow" is a real answer and one that only a measurement
/// taken outside the handler can give.
///
/// <c>Timing-Allow-Origin</c> is what lets the deployed frontend read these
/// numbers from <c>PerformanceResourceTiming</c>; without it the browser hides
/// them from a cross-origin page's scripts, and the frontend and API are on
/// different hosts by design. Scoped to the configured origin rather than
/// <c>*</c> — nothing else needs them.
/// </remarks>
public sealed class ServerTimingMiddleware(
    RequestDelegate next,
    ILogger<ServerTimingMiddleware> logger,
    IConfiguration configuration)
{
    /// <summary>
    /// Anything past this gets a log line with its own breakdown, so the numbers
    /// survive in the deployment's log even when nobody had the network panel
    /// open at the time.
    /// </summary>
    private const int SlowRequestMs = 1000;

    private readonly string _timingAllowOrigin =
        configuration["Cors:FrontendOrigin"] ?? "http://localhost:3000";

    public async Task InvokeAsync(HttpContext context)
    {
        var metrics = context.RequestServices.GetRequiredService<RequestMetrics>();
        var started = Stopwatch.GetTimestamp();

        // Headers have to be written before the response starts, and by the time
        // the pipeline unwinds the body may already be on the wire.
        context.Response.OnStarting(() =>
        {
            var elapsed = Stopwatch.GetElapsedTime(started);
            context.Response.Headers["Server-Timing"] = metrics.ToServerTiming(elapsed);
            context.Response.Headers["Timing-Allow-Origin"] = _timingAllowOrigin;
            return Task.CompletedTask;
        });

        await next(context);

        var total = Stopwatch.GetElapsedTime(started);
        if (total.TotalMilliseconds >= SlowRequestMs)
        {
            logger.LogWarning(
                "Slow request: {Method} {Path} took {TotalMs:F0}ms — {RoundTrips} database round trips totalling {DbMs:F0}ms, slowest {SlowestMs:F0}ms.",
                context.Request.Method,
                context.Request.Path.Value,
                total.TotalMilliseconds,
                metrics.RoundTrips,
                metrics.DatabaseTime.TotalMilliseconds,
                metrics.SlowestRoundTrip.TotalMilliseconds);
        }
    }
}
