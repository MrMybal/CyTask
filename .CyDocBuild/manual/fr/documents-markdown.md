---
id: documents-markdown
title: Documents et texte mis en forme
order: 9
description: Rédigez documents partagés et descriptions mises en forme avec Markdown et CyMD.
section: Travail quotidien
parent: projects-rooms
sourceRevision: 2
---

Utilisez une ressource Document pour une page partagée, et descriptions ou messages pour le texte lié au travail. Les documents se classent avec les autres ressources dans les dossiers du projet.

## Rédiger un document {#write-a-document}
Créez un document depuis les contrôles de ressources, donnez-lui un nom explicite et choisissez son dossier. Modifiez le contenu, vérifiez l’aperçu puis enregistrez. Rouvrez-le pour confirmer la révision souhaitée.

Markdown permet titres, emphase, listes, liens, citations et blocs de code :

~~~markdown
## Critères de validation
- Reproduire le problème
- Joindre une vidéo de test
- **Confirmer** le résultat attendu

Référencer la tâche avec son lien partagé.
~~~

## Éditeur et aperçu {#editor-and-preview}
CyTask utilise ses outils de texte intégré et l’intégration CyMD lorsqu’elle est proposée. Un éditeur dédié modifie un brouillon. Appliquer le brouillon le renvoie au formulaire appelant ; enregistrez ou envoyez ce formulaire pour conserver le résultat.

L’aperçu met le texte en forme ; il n’autorise pas l’exécution de HTML ou de scripts. Coller du code dans un message ne l’exécute pas sur le serveur.

## Liens et extensions {#links-and-extensions}
Utilisez le contrôle de lien ou collez l’URL d’une tâche pour la référencer. Les extensions de messages et texte apportent des aperçus enrichis via les plugins pris en charge. Le plugin doit être activé pour le projet et correspondre à la ressource.

Ne stockez pas mots de passe et tokens dans une page pour configurer une intégration. Utilisez ses paramètres de connexion.

Voir [les fichiers](doc:files-media) et [les plugins](doc:plugins).
