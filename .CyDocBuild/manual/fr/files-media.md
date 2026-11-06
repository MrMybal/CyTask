---
id: files-media
title: Fichiers, images et vidéos
order: 7
description: Joignez des fichiers, consultez images et vidéos et ouvrez les annotations compatibles.
section: Travail quotidien
parent: projects-rooms
sourceRevision: 2
---

Un fichier peut être joint à une tâche, un message ou une ressource de projet. Le salon Fichiers présente le contenu stocké du projet selon vos permissions.

## Joindre et consulter {#attach-and-preview}
Déposez les fichiers sur une tâche ouverte ou dans la zone d’envoi du tchat, ou utilisez le sélecteur. Attendez la fin de l’envoi avant de quitter. Les images montrent un aperçu ; les vidéos se lisent directement si le navigateur prend en charge leur codec.

Cliquez sur une image pour l’agrandir. La visionneuse propose son téléchargement. Les contrôles vidéo permettent lecture et déplacement ; le téléchargement conserve le fichier, pas une capture de son aperçu.

```diagram
{"type":"flow","title":"Choisir / déposer un fichier → Empreinte et blocs d’envoi → Quarantaine / inspection → Aperçu / téléchargement autorisé","nodes":[{"id":"n0","label":"Choisir / déposer un fichier","x":20,"y":10,"width":400},{"id":"n1","label":"Empreinte et blocs d’envoi","x":20,"y":130,"width":400},{"id":"n2","label":"Quarantaine / inspection","x":20,"y":250,"width":400},{"id":"n3","label":"Aperçu / téléchargement autorisé","x":20,"y":370,"width":400}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n2","to":"n3"}]}
```

## Comprendre le traitement {#understand-upload-processing}
Les envois sont découpés en blocs avec empreintes d’intégrité. Les médias passent par une quarantaine et une vérification de conteneur avant publication. Un transfert échoué n’est pas une pièce jointe terminée. Réessayez avec les contrôles d’envoi plutôt qu’en déposant directement un fichier dans le stockage serveur.

Les aperçus couvrent notamment PNG, JPEG, GIF, WebP, et les vidéos MP4/WebM. Un conteneur accepté ne garantit pas la lecture de tous ses codecs sur tous les navigateurs.

Cette inspection ne remplace pas un antivirus généraliste. Ne considérez pas un téléchargement inconnu comme fiable parce que son envoi a réussi. Le transcodage automatique général des vidéos n’est pas proposé.

## Réutiliser et annoter {#reuse-and-annotate}
Les images jointes peuvent illustrer les cartes Kanban. Les liens de ressources se partagent dans le tchat. Lorsque CyAnnota est activé et prend en charge le média, utilisez son action d’annotation puis enregistrez via l’intégration.

Une URL externe n’est pas un fichier stocké. L’import peut conserver des liens de pièces jointes sans télécharger leur contenu.

Voir [plugins](doc:plugins), [tchat](doc:chat) et [sauvegardes](doc:sync-backup).
