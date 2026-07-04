using Tangram.Api.Services;

namespace Tangram.Api.Middleware;

// Runs after JWT bearer auth. For authenticated requests, upserts the user
// row and loads their workspace ids into the request-scoped ICurrentUserService
// so EF Core's global query filters can enforce tenant isolation.
public class CurrentUserMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ICurrentUserLoader loader)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            await loader.LoadAsync(context.User, context.RequestAborted);
        }

        await next(context);
    }
}
