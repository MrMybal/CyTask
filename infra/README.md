# Infrastructure

## Installation locale persistante

Prérequis : Docker avec Compose.

```powershell
Copy-Item infra/.env.example infra/.env
# Remplacer impérativement CYTASK_DB_PASSWORD dans infra/.env
docker compose --env-file infra/.env -f infra/compose.yaml up --build
```

Le service écoute ensuite sur `http://127.0.0.1:8080` pour recevoir les requêtes
d’un reverse proxy local. La base n’est pas publiée sur l’hôte. Les cookies de la
configuration Production exigent HTTPS : placer un reverse proxy TLS maintenu
devant CyTask, même pour la recette finale d’une installation d’équipe, et conserver
le port applicatif inaccessible depuis Internet. Pour une évaluation sans Docker
ni TLS, utiliser `scripts/dev.ps1` et le stockage temporaire en mémoire.

CyAnnota est inclus dans le serveur sous `/plugins/cyannota/`, valeur par
défaut de `CYTASK_CYANNOTA_URL`. Le chemin reste sur la même origine CyTask.

Le mot de passe présent dans `.env.example` est volontairement invalide pour une
production. Le fichier `infra/.env` est ignoré par Git via la règle globale `.env`.

Le volume nommé `cytask-media` contient les blocs temporaires et les originaux en
quarantaine. Il doit être sauvegardé avec PostgreSQL et restauré au même point
logique. Il ne doit jamais être publié directement par le reverse proxy ni monté
dans une racine Web.
