# Serveur CyTask

API ASP.NET Core 10 de la première tranche verticale.

## Exécution temporaire

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
./.tools/dotnet/dotnet run --project apps/server/src/CyTask.Api
```

Le profil Development utilise un stockage mémoire explicite. La configuration
Production refuse de démarrer sans `CyTask:DatabaseConnection` et utilise
PostgreSQL. Les migrations ne sont appliquées automatiquement que lorsque
`CyTask:ApplyMigrations` vaut `true`.

## Routes principales

- `GET /health/live` et `GET /health/ready` ;
- `POST /api/v1/bootstrap`, utilisable une seule fois ;
- `POST /api/v1/sessions` et `DELETE /api/v1/session` ;
- projets, tâches, checklists et commentaires sous `/api/v1` ;
- flux SSE authentifié sur `GET /api/v1/events`.
