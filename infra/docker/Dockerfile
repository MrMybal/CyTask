FROM node:22.17.1-alpine AS web-build
WORKDIR /source/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY apps/web/ ./
RUN npm run build

FROM node:22.17.1-alpine AS cyannota-build
WORKDIR /source/plugins/cyannota/web
COPY plugins/cyannota/web/package.json plugins/cyannota/web/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY plugins/cyannota/web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS server-build
WORKDIR /source
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY apps/server/src/CyTask.Api/CyTask.Api.csproj apps/server/src/CyTask.Api/packages.lock.json apps/server/src/CyTask.Api/
RUN dotnet restore apps/server/src/CyTask.Api/CyTask.Api.csproj --locked-mode
COPY apps/server/src/CyTask.Api/ apps/server/src/CyTask.Api/
RUN dotnet publish apps/server/src/CyTask.Api/CyTask.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /out/server

FROM mcr.microsoft.com/dotnet/aspnet:10.0.10-noble-chiseled AS runtime
WORKDIR /app
COPY --from=server-build /out/server/ ./
COPY --from=web-build /source/apps/web/dist/ ./wwwroot/
COPY --from=cyannota-build /source/plugins/cyannota/web/dist/ ./wwwroot/plugins/cyannota/
COPY --chown=$APP_UID:$APP_UID infra/media/ /var/lib/cytask/media/

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "CyTask.Api.dll"]
