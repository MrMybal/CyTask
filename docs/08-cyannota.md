# Annotations CyAnnota

Le plugin officiel `dev.cytask.cyannota` permet d’annoter les images et vidéos d’une
tâche sans quitter CyTask. Il est désactivé par défaut et doit être activé par un
propriétaire ou un administrateur depuis la page **Plugins** du projet.

## Copie intégrée

CyTask contient sa propre copie Web dans `plugins/cyannota/web`. Le projet CyAnnota
d’origine reste indépendant et n’est jamais modifié par l’intégration. Le build de
production place cette copie sous `/plugins/cyannota/` ; le client Web et CyTask
Desktop utilisent donc le même plugin et le même stockage d’annotations.

## Configuration

`CyTask:CyAnnotaUrl` vaut `/plugins/cyannota/` par défaut. Cette route charge le
plugin inclus dans le serveur et ne demande aucun second déploiement. La valeur doit
rester un chemin relatif sûr sur la même origine CyTask ; un domaine externe est refusé
afin de ne pas élargir la politique de sécurité du site.

La variable correspondante est `CYTASK__CYANNOTAURL`. Le navigateur et le client
desktop chargent cette route directement depuis le serveur CyTask connecté.

## Flux sécurisé intégré

1. CyTask crée un nonce aléatoire et charge le plugin dans un iframe isolé de l’onglet.
2. CyTask récupère le média avec la session de l’utilisateur, puis transmet une copie
   en mémoire au frame avec `postMessage`.
3. Les deux côtés vérifient la fenêtre source, l’origine exacte, le nonce et
   l’identifiant de pièce jointe.
4. À la sauvegarde, CyAnnota remplace la source binaire de l’image par l’identifiant
   `cytask-attachment:` et renvoie uniquement le document JSON d’annotations.
5. CyTask vérifie de nouveau le rôle, le CSRF, l’organisation, la tâche, le média, le
   type image/vidéo, la taille et la révision avant l’écriture.

Le pont n’injecte aucun jeton API, chemin de stockage ou URL temporaire. Le module
embarqué est couvert par une CSP dédiée, ne peut être encadré que par CyTask et peut
être fermé ou placé en plein écran sans ouvrir de fenêtre supplémentaire.

## API

- `GET /api/v1/tasks/{taskId}/plugins/cyannota/workspace` : route du module, limite du
  document et résumés des médias annotés ;
- `GET /api/v1/tasks/{taskId}/plugins/cyannota/media/{attachmentId}` : document courant
  ou état initial de révision 0 ;
- `PUT /api/v1/tasks/{taskId}/plugins/cyannota/media/{attachmentId}` : sauvegarde
  optimiste avec `expectedRevision`.

Les documents sont limités à 4 Mio et 5 000 annotations. Seules les pièces jointes
validées par l’analyse média et reconnues comme image ou vidéo sont acceptées. Une
révision obsolète répond `409 Conflict`.
