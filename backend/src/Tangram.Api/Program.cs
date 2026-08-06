using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Tangram.Api.Data;
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

builder.Services.AddDbContext<AppDbContext>(options =>
    options
        .UseNpgsql(builder.Configuration.GetConnectionString("Postgres"))
        .UseSnakeCaseNamingConvention());

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

app.UseCors("Frontend");

app.UseAuthentication();
app.UseMiddleware<CurrentUserMiddleware>();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.MapControllers();
app.MapHub<BoardHub>("/hubs/board");

app.Run();

public partial class Program;
