# Infrastructure

## Installation locale persistante

Prérequis : Docker avec Compose.

```powershell
Copy-Item infra/.env.example infra/.env
# Remplacer impérativement CYTASK_DB_PASSWORD dans infra/.env
# Préparer aussi la clé de plugins et infra/compose.private.yaml comme ci-dessous.
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.private.yaml up --build
```

Le stockage persistant exige également une clé de protection des secrets de
plugins. Dans l’environnement privé, définir `CYTASK_PLUGIN_SECRET_KEY` avec
32 octets cryptographiquement aléatoires encodés en base64, et conserver cette
clé entre les redémarrages. Le fichier Compose de base ne transmet pas ce réglage :
créer un fichier privé `infra/compose.private.yaml` (ignoré par Git) :

```yaml
services:
  server:
    environment:
      CYTASK__PLUGINSECRETKEY: ${CYTASK_PLUGIN_SECRET_KEY:?Définir la clé de plugins persistante}
```

Le [guide d’administration](../docs/user-guide/fr/administration.md) précise les
autres réglages, les sauvegardes et la mise à jour d’un déploiement.

Le service écoute ensuite sur `http://127.0.0.1:8080` pour recevoir les requêtes
d’un reverse proxy local. La base n’est pas publiée sur l’hôte. Les cookies de la
configuration Production exigent HTTPS : placer un reverse proxy TLS maintenu
devant CyTask, même pour la recette finale d’une installation d’équipe, et conserver
le port applicatif inaccessible depuis Internet. Pour une évaluation sans Docker
ni TLS, utiliser `scripts/dev.ps1` et le stockage temporaire en mémoire.

Pour les appels derrière ce proxy TLS, définir `CYTASK_PUBLIC_ORIGIN` avec l’origine
HTTPS publique exacte et ajouter son hôte à `CYTASK_ALLOWED_HOSTS`. Le proxy doit
transmettre les upgrades WebSocket. Les en-têtes `X-Forwarded-*` fournis par le client
ne remplacent pas ce réglage explicite. Voir la [configuration des appels](../docs/live-calls.md)
pour le relais TURN et les limites actuelles.

La variable `CYTASK_MFA_POLICY` permet de choisir `disabled`, `optional` ou `required`.
Pour l’activer sur un serveur persistant, fournir une clé `CYTASK_MFA_ENCRYPTION_KEY`
aléatoire de 32 octets encodés en base64 et la conserver entre les redémarrages.
Les applications TOTP sont autorisées par défaut ; les codes e-mail nécessitent
`CYTASK_MFA_EMAIL_ENABLED=true` et les paramètres SMTP TLS. Voir le
[guide de double authentification](../docs/two-factor-authentication.md).

CyAnnota est inclus dans le serveur sous `/plugins/cyannota/`, valeur par
défaut de `CYTASK_CYANNOTA_URL`. Le chemin reste sur la même origine CyTask.

Le mot de passe présent dans `.env.example` est volontairement invalide pour une
production. Le fichier `infra/.env` est ignoré par Git via la règle globale `.env`.

Le volume nommé `cytask-media` contient les blocs temporaires et les originaux en
quarantaine. Il doit être sauvegardé avec PostgreSQL et restauré au même point
logique. Il ne doit jamais être publié directement par le reverse proxy ni monté
dans une racine Web.
