# Build context is backend/ (see .dockerignore).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore before copying the rest of the sources, so a change to a .cs file
# doesn't invalidate the (slow) restore layer.
COPY src/Tangram.Api/Tangram.Api.csproj src/Tangram.Api/
RUN dotnet restore src/Tangram.Api/Tangram.Api.csproj

COPY src/ src/
RUN dotnet publish src/Tangram.Api/Tangram.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .

# APP_UID is defined by the base image; running as a non-root user is the
# default posture for the .NET images from 8.0 onward.
USER $APP_UID

EXPOSE 8000

# Hosts assign a port via $PORT (Koyeb defaults to 8000). ASP.NET Core doesn't
# read that variable itself, so bind explicitly. `exec` keeps dotnet as PID 1 so
# SIGTERM reaches it and shutdown stays graceful -- which matters on a platform
# that stops the instance whenever it goes idle.
ENTRYPOINT ["/bin/sh", "-c", "exec dotnet Tangram.Api.dll --urls http://0.0.0.0:${PORT:-8000}"]
