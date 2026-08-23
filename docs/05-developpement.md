# Développement

## Prérequis

- SDK .NET 10.0.302 ;
- Node.js 22 ou supérieur ;
- Docker Compose uniquement pour la persistance PostgreSQL locale.

Le SDK .NET peut rester local dans `.tools/dotnet` et n'est jamais versionné.

## Boucle rapide

```powershell
./scripts/dev.ps1
```

Le script démarre l'API en arrière-plan sur le port 5080 et Vite sur le port 5173.
Le serveur est en environnement Development et utilise le stockage mémoire ; toute
donnée disparaît avec le processus.

## Tests et construction

```powershell
./.tools/dotnet/dotnet test CyTask.slnx

Push-Location apps/web
npm ci
npm run build
Pop-Location
```

Les projets .NET traitent les avertissements de compilation et d'analyse comme des
erreurs. Les versions NuGet et npm sont verrouillées. La CI répète les tests, la
construction Web, l'audit npm et la construction de l'image de production.

## Plugin Unreal

Le plugin source est dans `integrations/unreal/CyTask`. `BuildPlugin` doit être
exécuté séparément pour chaque couple version/plateforme ; les sorties locales vont
dans `integrations/unreal/.build`, ignoré par Git. Les tests Automation portent le
préfixe `CyTask` et doivent être exécutés dans `UnrealEditor-Cmd` avec `-NullRHI`.

La matrice minimale de CI avant publication est 4.27, 5.0, une version 5.x médiane
et 5.8. Les builds locaux actuels passent sur 5.2 et 5.8. L'installation 4.27
présente sur le poste manque de bibliothèques et d'en-têtes générés du moteur ; elle
ne permet donc pas encore un verdict complet sur cette extrémité de matrice.

## Configuration serveur

Clés de la section `CyTask` :

| Clé | Défaut | Rôle |
| --- | ---: | --- |
| `DatabaseConnection` | vide | chaîne PostgreSQL, obligatoire hors mémoire |
| `ApplyMigrations` | `false` | applique les migrations au démarrage |
| `UseInMemoryStore` | `false` | réservé au développement et aux tests |
| `SessionHours` | `12` | durée absolue d'une session |
| `NativeAuthorizationCodeMinutes` | `5` | durée du code PKCE à usage unique |
| `NativeAccessTokenMinutes` | `60` | durée du Bearer opaque pour Unreal |
| `InvitationHours` | `72` | durée maximale d'un lien d'invitation à usage unique |
| `MaxRequestBodyBytes` | `5242880` | limite globale, supérieure à un bloc d'envoi |
| `MaxAttachmentBytes` | `2147483648` | taille maximale déclarée d'une pièce jointe |
| `UploadChunkBytes` | `4194304` | taille attendue d'un bloc, sauf le dernier |
| `UploadHours` | `24` | expiration d'une session d'envoi |
| `MediaStoragePath` | `.data/media` | stockage privé des blocs, de la quarantaine et des objets validés |
| `MediaReviewSeconds` | `5` | intervalle entre deux passes du worker d'analyse |
| `MediaReviewBatch` | `8` | pièces jointes réservées par passe |
| `MediaReviewAttempts` | `3` | tentatives avant refus définitif d'un fichier |
| `MaxMediaDimension` | `20000` | côté maximal accepté pour une image |
| `MaxMediaPixels` | `80000000` | surface maximale acceptée pour une image |
| `MaxApiTokensPerUser` | `20` | jetons d'API actifs au maximum par compte |

Dans une variable d'environnement, `CyTask:DatabaseConnection` devient
`CYTASK__DATABASECONNECTION`.

`AllowedHosts` n'autorise par défaut que `localhost` et `127.0.0.1`. Un déploiement
d'équipe doit fournir son nom DNS explicite, par exemple `AllowedHosts=tasks.example.org`.

## Règles de la tranche actuelle

- aucune inscription publique après l'amorçage du premier propriétaire ;
- invitations à expiration et usage unique, dont seul le SHA-256 est persisté ;
- rôles `owner`, `admin`, `member` et `viewer` contrôlés côté serveur ;
- jetons de session aléatoires stockés uniquement sous forme hachée ;
- mots de passe salés via le format versionné ASP.NET Identity, avec PBKDF2-HMAC-SHA512 à 220 000 itérations ;
- double jeton CSRF, lié à la session côté serveur ;
- cookies `Secure`, `HttpOnly` pour la session et `SameSite=Strict` en Production ;
- requêtes de données toujours bornées par l'organisation authentifiée ;
- tailles contrôlées dans l'API et par contraintes PostgreSQL ;
- événements temps réel en SSE, avec relecture de l'état après reconnexion.
- recherche limitée à 50 résultats et toujours bornée par l'organisation ;
- export JSON versionné réservé aux propriétaires et administrateurs ;
- service worker de production qui exclut explicitement `/api` et `/health` du cache.
- pièces jointes envoyées séquentiellement par blocs SHA-256 et placées en quarantaine ;
- dix sessions d'envoi actives au maximum par utilisateur ;
- sortie de quarantaine décidée par un worker qui parcourt réellement le conteneur du fichier ;
- type servi déduit du contenu, jamais de la déclaration du client, et restreint à une liste connue ;
- téléchargement borné à l'organisation, toujours en pièce jointe et avec `nosniff` ;
- bail concurrent et nombre de tentatives bornés sur l'analyse, pour un fichier qui la ferait échouer ;
- jetons d'API stockés hachés, affichés une seule fois, portée et expiration vérifiées à chaque requête ;
- un jeton en portée lecture est refusé sur toute méthode mutante, avant même le contrôle de rôle ;
- la création et l'inventaire des jetons exigent la session navigateur : un jeton ne peut pas se propager.

## Limites connues avant une bêta

- un seul espace est sélectionné automatiquement à la connexion ;
- l'ajout d'un compte existant à plusieurs espaces, les passkeys, OIDC, MFA et la récupération de compte restent à faire ;
- la migration vers Argon2id et son calibrage sur le matériel serveur doivent être terminés avant la bêta ;
- le dispatcher durable de l'outbox n'est pas encore branché au flux SSE ;
- la recherche PostgreSQL utilise encore `ILIKE` avant l'ajout d'un index de recherche dédié ;
- aucune migration de changement de schéma n'a encore été exercée en production ;
- les connecteurs Git distants et la plateforme de plugins restent à construire ;
- l'analyse valide les conteneurs et relève dimensions et durée dans leurs en-têtes, mais ne
  décode aucune image : ni vignette de vidéo, ni profil réencodé, ni analyse antivirale ;
- le worker d'analyse tourne dans le processus serveur ; son isolement dans un processus dédié reste à faire ;
- le hachage Web est incrémental et lit le fichier par tranches de 8 Mio ; il plafonne à
  environ 50 Mio/s, ce qui reste le poste le plus long d'un envoi volumineux ;
- l'envoi ne reprend toujours pas après une fermeture d'onglet : la session d'envoi survit
  côté serveur, mais le client ne sait pas encore la retrouver ;
- le futur client installé devra fournir une conversion locale et une reprise réelle.
