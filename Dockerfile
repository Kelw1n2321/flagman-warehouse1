# ── Сборка интерфейса ──
FROM node:24-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
# npm install, а не npm ci: lock-файл создан на Windows, нативные бинарники Linux подтянутся здесь.
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build --outDir /out/wwwroot --emptyOutDir

# ── Сборка API ──
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY backend/Flagman.Api/Flagman.Api.csproj backend/Flagman.Api/
RUN dotnet restore backend/Flagman.Api/Flagman.Api.csproj
COPY backend/Flagman.Api/ backend/Flagman.Api/
RUN dotnet publish backend/Flagman.Api -c Release -o /out/app --no-restore

# ── Образ запуска ──
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /out/app ./
COPY --from=web /out/wwwroot ./wwwroot
ENV ASPNETCORE_ENVIRONMENT=Production
# Render передаёт порт в $PORT (по умолчанию 10000). URLS без префикса перекрывает "Urls" из appsettings.json.
CMD ["sh", "-c", "URLS=http://0.0.0.0:${PORT:-8080} exec dotnet Flagman.Api.dll"]
