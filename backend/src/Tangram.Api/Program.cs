using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Tangram.Api.Data;
using Tangram.Api.Diagnostics;
using Tangram.Api.Hubs;
using Tangram.Api.Middleware;
using Tangram.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// A gitignored local-override file, so a developer can keep a real connection
// string / Firebase project id in a file without risking a commit --
// appsettings.Development.json is tracked. Slotted in after user-secrets but
// before environment variables (re-added here to restore their precedence),
// so a deploy environment's env vars still win over anyone's leftover file.
builder.Configuration
    .AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables();

var firebaseProjectId = builder.Configuration["Firebase:ProjectId"]
    ?? throw new InvalidOperationException("Firebase:ProjectId is not configured. Set it via appsettings, an environment variable, or user-secrets.");

var frontendOrigin = builder.Configuration["Cors:FrontendOrigin"] ?? "http://localhost:3000";

builder.Services.AddControllers();
builder.Services.AddOpenApi(options =>
{
    // Lets Swagger UI's "Authorize" button attach a Firebase ID token as a
    // Bearer header, since almost every endpoint requires one.
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Description = "Firebase ID token."
        };
        return Task.CompletedTask;
    });
    options.AddOperationTransformer((operation, _, _) =>
    {
        operation.Security ??= [];
        operation.Security.Add(new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference("Bearer")] = []
        });
        return Task.CompletedTask;
    });
});

// Scoped, so one per request: the interceptors below and the Server-Timing
// header both resolve the same instance.
builder.Services.AddScoped<RequestMetrics>();
builder.Services.AddScoped<DbCommandMetricsInterceptor>();
builder.Services.AddScoped<DbTransactionMetricsInterceptor>();
builder.Services.AddScoped<DbConnectionMetricsInterceptor>();

// The service-provider overload rather than the plain one, because the
// interceptors need this request's RequestMetrics and the plain overload has no
// scope to resolve it from.
builder.Services.AddDbContext<AppDbContext>((serviceProvider, options) =>
    options
        .UseNpgsql(builder.Configuration.GetConnectionString("Postgres"))
        .UseSnakeCaseNamingConvention()
        .AddInterceptors(
            serviceProvider.GetRequiredService<DbCommandMetricsInterceptor>(),
            serviceProvider.GetRequiredService<DbTransactionMetricsInterceptor>(),
            serviceProvider.GetRequiredService<DbConnectionMetricsInterceptor>()));

builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();
builder.Services.AddScoped<ICurrentUserLoader, CurrentUserLoader>();
builder.Services.AddScoped<IMembershipService, MembershipService>();
builder.Services.AddScoped<IBoardOperationService, BoardOperationService>();
builder.Services.AddSingleton<IPresenceTracker, PresenceTracker>();

builder.Services.AddSignalR();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy => policy
        .WithOrigins(frontendOrigin)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = $"https://securetoken.google.com/{firebaseProjectId}";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"https://securetoken.google.com/{firebaseProjectId}",
            ValidateAudience = true,
            ValidAudience = firebaseProjectId,
            ValidateLifetime = true
        };

        // Browsers can't set an Authorization header on the WebSocket upgrade
        // request, so the SignalR client sends the token as a query param on
        // the hub connection instead; accept it there only.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

// Deployed environments have no shell to run `dotnet ef database update` from,
// so the app can bring its own schema up to date on boot.
//
// Opt-in rather than automatic: it's off for local runs and for the test suite
// (which manages its own schema in TangramWebApplicationFactory), and only the
// hosted deployment sets Database__MigrateOnStartup=true.
//
// This is safe *because the free-tier deployment is a single instance*. Several
// instances booting together would race on the migration history table, and at
// that point this needs to move to a job that runs once before the rollout.
if (app.Configuration.GetValue("Database:MigrateOnStartup", false))
{
    using var migrationScope = app.Services.CreateScope();
    await migrationScope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(options => options.SwaggerEndpoint("/openapi/v1.json", "Tangram API v1"));
}

// First, so it measures the whole request rather than the handler. "The endpoint
// is fast but the request is slow" is a real answer, and only a measurement taken
// outside the handler can give it.
app.UseMiddleware<ServerTimingMiddleware>();

app.UseCors("Frontend");

app.UseAuthentication();
app.UseMiddleware<CurrentUserMiddleware>();
app.UseAuthorization();

// The commit is here so a deploy can be *observed* rather than waited out.
// Nothing else in the pipeline can answer "is the code I just promoted actually
// serving traffic?" — and without that answer the frontend release is gated on a
// human remembering to run `git ship`, which is a step that gets forgotten. It
// was forgotten during v4: the frontend sat three commits behind for hours.
//
// Render injects RENDER_GIT_COMMIT at runtime, so this needs no build argument
// and no Dockerfile change. Locally there is no such variable and "local" is the
// honest answer.
var deployedCommit = builder.Configuration["RENDER_GIT_COMMIT"] ?? "local";

app.MapGet("/health", () => Results.Ok(new { status = "ok", commit = deployedCommit }))
    .AllowAnonymous();

// The other half of the measurement. /health costs one request and no database;
// this costs one request and exactly one trivial statement, so the difference
// between the two Server-Timing headers is the price of a single round trip to
// the database — on the deployment, where that price is the whole question.
//
// It exists because two explanations fit the same evidence. A move reported
// twelve statements averaging 207ms with the slowest only 11% above the mean,
// and a flat distribution like that means either a far-away database (every
// statement pays the same wire cost) or a starved CPU (every statement pays the
// same scheduling delay). They need opposite fixes — one is a different region,
// the other is a bigger instance — and nothing already deployed could tell them
// apart, because every measurement so far mixed twelve statements with the
// application work between them.
//
// SELECT 1 does no work worth scheduling. If this reports ~200ms the link is
// slow; if it reports ~3ms the link is fine and the move's problem is the
// twelve, not the distance.
//
// Anonymous on purpose: an authenticated probe could only be run by someone
// holding a token, which excludes every tool that would otherwise watch this.
// It reads nothing and returns nothing, so there is no data behind the door.
app.MapGet("/health/db", async (AppDbContext db, CancellationToken ct) =>
{
    await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
    return Results.Ok(new { status = "ok" });
}).AllowAnonymous();

app.MapControllers();
app.MapHub<BoardHub>("/hubs/board");

app.Run();

public partial class Program;
