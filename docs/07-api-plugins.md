# API pour plugins et intégrations

CyTask expose la même API HTTP à son client Web, à ses futurs clients natifs, au
plugin Unreal et aux extensions tierces. Aucune route privilégiée n'est réservée à
l'interface officielle.

Le contrat exécutable est servi par le serveur lui-même :

```
GET /api/v1/openapi.json
```

Il est accessible sans authentification, décrit en OpenAPI 3.1 et versionné avec le
code. Tout générateur de client (openapi-generator, NSwag, oapi-codegen…) peut le
consommer directement.

## Authentification

Deux modes coexistent et donnent exactement les mêmes droits métier.

| Mode | Usage | En-tête |
| --- | --- | --- |
| Session navigateur | client Web | cookie `CyTask.Session` + `X-CSRF-Token` |
| Jeton d'API | plugin, script, CI | `Authorization: Bearer cytask_pat_…` |
| Jeton natif PKCE | plugin Unreal | `Authorization: Bearer …` |

Un jeton d'API ne demande pas de CSRF : il n'est pas transporté automatiquement par
un navigateur, donc la classe d'attaque que le CSRF empêche ne s'applique pas.

## Créer un jeton

Depuis le client Web, section **API** de la barre latérale, ou par l'API depuis une
session navigateur :

```bash
curl -X POST https://tasks.example.org/api/v1/tokens \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  --cookie "CyTask.Session=$SESSION" \
  -d '{"name":"Robot CI","scope":"write","expiresInDays":90}'
```

Le champ `secret` de la réponse n'est jamais réaffiché : seul son SHA-256 est
conservé. Un jeton perdu se révoque et se recrée, il ne se relit pas.

## Portées

| Portée | Méthodes autorisées |
| --- | --- |
| `read` | `GET`, `HEAD`, `OPTIONS` |
| `write` | toutes, sous réserve du rôle du compte |

La portée est vérifiée avant le rôle. Un jeton `write` détenu par un compte
`viewer` ne peut donc rien modifier : la portée restreint le compte, elle ne
l'élargit jamais.

## Ce qu'un jeton ne peut pas faire

Un jeton ne peut ni lister, ni créer, ni révoquer des jetons. Ces routes exigent la
session navigateur. Un jeton compromis donne accès aux données de l'organisation
selon sa portée, mais ne peut pas se répliquer ni prolonger sa propre durée de vie.

Un jeton est également refusé sur l'ouverture d'une autorisation native Unreal, qui
demande un consentement humain dans le navigateur.

## Plugins déclaratifs de projet

Le catalogue officiel est disponible avec `GET /api/v1/plugins/catalog`. Un propriétaire ou
administrateur active ensuite une extension pour un projet avec
`PUT /api/v1/projects/{projectId}/plugins/{pluginId}`. La désactivation utilise `DELETE` sur
la même route. Les clients obtiennent les contributions actives d'un ticket avec
`GET /api/v1/tasks/{taskId}/plugins`.

Chaque manifeste peut déclarer des onglets de ticket et des champs typés. Le client Web rend
uniquement ce schéma contrôlé ; aucun script, HTML distant ou composant arbitraire n'est chargé.
Les valeurs sont écrites avec :

```http
PUT /api/v1/tasks/{taskId}/plugins/{pluginId}/data
Content-Type: application/json

{
  "expectedRevision": 3,
  "data": {
    "engineVersion": "5.8",
    "mapPath": "/Game/Maps/Hangar"
  }
}
```

Le serveur refuse les champs inconnus, types invalides, chemins Unreal hors `/Game` et
`/Plugins`, listes démesurées et objets de plus de 64 Kio. Une révision obsolète répond
`409 Conflict`. Les données restent bornées à l'organisation et au projet du ticket. Chaque
écriture réussie est aussi archivée et peut être relue avec
`GET /api/v1/tasks/{taskId}/plugins/{pluginId}/history` (100 révisions récentes au maximum).

Quatre plugins officiels servent de référence :

- `dev.cytask.git` rend l’onglet Git activable par projet et regroupe configuration du dépôt,
  liaison de commits, branches, tags et demandes de fusion ;
- `dev.cytask.ai-assistant` configure plusieurs fournisseurs chiffrés par projet et
  exécute une analyse bornée depuis le ticket. Les clés de fournisseur n’appartiennent
  jamais aux données d’un ticket ;
- `dev.cytask.unreal` partage moteur, projet, map, assets, fichiers du projet et historique entre le site et
  le panneau Unreal ;
- `dev.cytask.cyrevision` expose dépôt, branche, commit, révision et fichiers modifiés. Son
  connecteur compagnon est distribué dans CyRevision et utilise la même API Bearer que les
  intégrations Jira et ClickUp.

### Connexions AI Assistant

Le plugin `dev.cytask.ai-assistant` gère plusieurs profils par projet :

- jeton API chiffré pour OpenAI, Anthropic et les API compatibles OpenAI ;
- endpoint explicite pour Ollama et LM Studio ;
- compte local déjà authentifié pour Codex CLI, Claude Code et OpenCode.

Les administrateurs gèrent ces profils avec
`/api/v1/projects/{projectId}/plugins/ai-assistant/connections`. Le client ne reçoit
que `hasSecret` et les quatre derniers caractères masqués : ni le jeton en clair, ni
sa valeur chiffrée ne quittent le serveur. En stockage PostgreSQL,
`CYTASK__PLUGINSECRETKEY` est obligatoire et contient une clé aléatoire de 32 octets
encodée en base64.

Un membre lance une analyse avec
`POST /api/v1/tasks/{taskId}/plugins/ai-assistant/run`. CyTask construit un contexte
borné avec le titre, la description, l’état, la checklist et, sur demande, les 100
commentaires récents. La réponse est limitée, puis peut être conservée dans les données
révisionnées du ticket.

Les agents locaux sont désactivés par défaut. Lorsqu’ils sont autorisés, CyTask lance
directement l’exécutable configuré, sans shell : Codex utilise un sandbox en lecture seule,
Claude Code le mode `plan` avec un seul tour, et OpenCode un agent `plan` dont les
permissions d’outils sont refusées. CyTask ne lit jamais les fichiers d’authentification de
ces outils ; il réutilise uniquement leur session existante sur le compte système du serveur.

Les URLs personnalisées refusent les identifiants dans l’URL et bloquent par défaut les
adresses privées/locales ainsi que les redirections. `AiAllowPrivateEndpoints=true` doit
être un choix explicite de l’administrateur pour Ollama ou LM Studio.

## Bornes systématiques

- toute réponse est limitée à l'organisation du compte propriétaire du jeton ;
- les rôles `owner`, `admin`, `member` et `viewer` s'appliquent identiquement ;
- les mutations de tâche exigent `expectedRevision` et répondent 409 si la révision
  a changé, ce qui rend un robot sûr face à une édition concurrente ;
- l'ajout d'une dépendance est idempotent et refuse les cycles ;
- la révocation prend effet à la requête suivante, sans cache.

## Exemple : lier un commit à une tâche

```bash
TOKEN=cytask_pat_…
curl -X POST "$BASE/api/v1/tasks/$TASK/external-references" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "github",
    "repository": "studio/nebula",
    "referenceType": "commit",
    "referenceValue": "9f3c1a8",
    "label": "Corrige les colliders du hangar",
    "webUrl": "https://github.com/studio/nebula/commit/9f3c1a8"
  }'
```

Le serveur n'appelle jamais `webUrl` : c'est une référence déclarative, ce qui
supprime la classe SSRF tant que le connecteur Git officiel n'existe pas.

## Temps réel

`GET /api/v1/events` diffuse un flux `text/event-stream` borné à l'organisation.
Chaque événement porte un type, un UUID SSE `id` et l'identifiant de l'entité
concernée ; le client recharge ensuite l'entité par l'API. Le flux ne transporte
pas les données, ce qui évite qu'un client obtienne par le flux ce qu'une route lui
refuserait.

Le navigateur renvoie automatiquement le dernier `id` dans `Last-Event-ID`.
Le serveur rejoue alors, dans l'ordre, les événements conservés dans l'outbox puis
reprend le direct. Le rejeu et le direct sont dédupliqués. Si le curseur est invalide,
appartient à une autre organisation ou a dépassé la rétention, un événement `reset`
demande au client de recharger projets, tâches et détail courant. Des commentaires
`: keep-alive` empêchent les proxys de fermer un flux inactif.

## Médias

Les formats reconnus sont PNG, JPEG, GIF et WebP pour les images, MP4 et WebM pour les
vidéos. Le serveur relève les dimensions dans tous les cas, et la durée pour les vidéos.
Un plugin peut donc filtrer ou trier sans télécharger les fichiers.

`GET /api/v1/tasks/{taskId}/attachment-uploads` retourne les sessions actives créées
par l'utilisateur courant et leurs blocs reçus. Pour reprendre, le client vérifie
le SHA-256 du fichier complet, additionne les tailles des blocs séquentiels, renvoie
le premier bloc manquant puis appelle `complete`. Un bloc déjà reçu avec la même
taille et la même empreinte est idempotent ; une différence répond `409`. L'état,
les blocs et la finalisation d'une session sont réservés à son créateur.

`GET /api/v1/attachments/{id}/content` accepte l'en-tête `Range` : un lecteur peut se
déplacer dans une vidéo sans rapatrier le fichier entier. La réponse porte un `ETag`
égal à l'empreinte SHA-256 du contenu, qui ne change jamais pour une pièce jointe
donnée.

Tout autre format est accepté mais servi en `application/octet-stream`, sans
dimensions ni durée.

## Limites connues

- `GET /projects/{projectId}/task-page` fournit filtres et pagination à curseur ;
  la route historique `/tasks` reste complète pour les intégrations, tandis que
  la recherche globale demeure plafonnée à 50 résultats ;
- pas encore de webhooks sortants ; le flux SSE est le seul mécanisme de poussée ;
- pas encore de clé d'idempotence sur la création, seule la mise à jour de tâche
  est protégée par sa révision ;
- les jetons sont personnels : un jeton de service détaché d'un compte humain
  reste à concevoir avec la plateforme de plugins ;
- aucun réencodage ni vignette de vidéo : le serveur lit les en-têtes des conteneurs
  mais ne décode aucune image, en attendant la décision de licence sur FFmpeg.
