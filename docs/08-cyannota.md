# Annotations CyAnnota

Le plugin officiel `dev.cytask.cyannota` relie les images et vidéos d’une tâche à
l’application Web CyAnnota. Il est désactivé par défaut et doit être activé par un
propriétaire ou un administrateur depuis la page **Plugins** du projet.

## Configuration

Le serveur expose l’URL configurée par `CyTask:CyAnnotaUrl` (variable
`CYTASK__CYANNOTAURL`). La valeur doit être une URL HTTP(S) absolue sans identifiants
ni fragment. En production, utilisez l’URL HTTPS déployée de CyAnnota ; en
développement, la valeur par défaut est `http://localhost:3000`.

Les navigateurs de l’équipe doivent pouvoir joindre CyTask et CyAnnota. Le serveur
CyTask n’effectue aucun appel sortant vers CyAnnota.

## Flux sécurisé

1. CyTask crée un nonce de session aléatoire et ouvre CyAnnota sur son origine exacte.
2. CyTask récupère le média avec la session de l’utilisateur, puis en transmet une copie
   en mémoire à la fenêtre CyAnnota avec `postMessage`.
3. CyAnnota valide l’origine, la fenêtre source, le nonce et l’identifiant de pièce jointe.
4. Lors d’une sauvegarde, CyAnnota retire la source binaire de l’image et renvoie seulement
   le document JSON d’annotations.
5. CyTask vérifie de nouveau le rôle, le CSRF, l’organisation, la tâche, le média, le type
   image/vidéo, la taille et la révision avant l’écriture.

Aucun cookie, jeton API, chemin de stockage ou lien temporaire CyTask n’est transmis à
CyAnnota. Une fenêtre liée ne peut pas remplacer le média par un autre fichier.

## API

- `GET /api/v1/tasks/{taskId}/plugins/cyannota/workspace` : URL de l’application,
  limite du document et résumés des médias annotés ;
- `GET /api/v1/tasks/{taskId}/plugins/cyannota/media/{attachmentId}` : document courant
  ou état initial de révision 0 ;
- `PUT /api/v1/tasks/{taskId}/plugins/cyannota/media/{attachmentId}` : sauvegarde
  optimiste avec `expectedRevision`.

Les documents sont limités à 4 Mio et 5 000 annotations. Seules les pièces jointes
validées par l’analyse média et reconnues comme image ou vidéo sont acceptées. Une
révision obsolète répond `409 Conflict`.
