---
id: troubleshooting
title: Dépannage
order: 23
description: Résolvez les problèmes d’affichage, d’accès, d’envoi, d’appel et d’espace local.
section: Aide
parent: shortcuts
sourceRevision: 2
---

Commencez par la vérification réversible la plus simple. Ne supprimez pas espace, profil navigateur ou base pour corriger un problème d’affichage.

## Écran vide ou interface absente {#blank-screen-or-missing-interface}
Rechargez la page ou rouvrez l’espace. Vérifiez que serveur, fichiers Web et client desktop proviennent de la même compilation. En local, vérifiez le démarrage du moteur et le choix de la racine du dossier.

À distance, contrôlez adresse et certificat HTTPS. Gardez le message d’erreur, en retirant les identifiants avant tout partage. Ne videz pas le dossier de données.

## Tâches absentes ou modifications refusées {#missing-tasks-or-rejected-edits}
Retirez les filtres, développez les dossiers et utilisez Afficher plus dans les listes paginées. Vérifiez projet et salon.

Un refus d’accès indique souvent une appartenance manquante, un rôle lecteur ou un tchat restreint. Un conflit de révision indique une modification concurrente : rechargez, comparez et réappliquez seulement le changement souhaité.

## Envoi ou lecture des médias {#upload-or-playback-problems}
Attendez la fin des blocs et de la validation. Une pièce en quarantaine n’est pas disponible. Vérifiez taille, type et espace de stockage. Une vidéo téléchargeable mais illisible peut utiliser un codec incompatible : essayez un navigateur adapté ou convertissez une copie séparément.

## Appels et connexion {#calls-and-account-access}
Vérifiez permissions micro/caméra du système et navigateur, HTTPS et périphériques choisis. Entre réseaux, contrôlez TURN et proxy WebSocket. Réessayez l’appel après correction.

En MFA, utilisez le dernier courriel, synchronisez les horloges ou utilisez un code de récupération inutilisé. Ne désactivez pas la politique globale pour contourner un seul compte.

## Local et Sync {#local-data-and-sync}
Une clé de chiffrement manquante ou incorrecte doit être remplacée par l’originale ; aucun retour au clair ou récupération par mot de passe n’est possible. Arrêtez les modifications en cas de fichiers subitement illisibles.

Suspendez Sync avant conflit ou restauration. Conservez les copies jusqu’à identification de la référence.

## Aide hors ligne {#help-offline}
Le client desktop ouvre `Documentation/Documentation.html` comme fichier local. Si des ressources manquent, réinstallez le client complet au lieu de copier son exécutable seul. Pour un manuel téléchargé, extrayez toute l’archive et gardez `Documentation.html` à côté de son dossier `DocData`. Aucun serveur Web n’est nécessaire. Recherchez un sujet depuis l’en-tête ou avec Ctrl+K. Signets et notes dépendent du stockage local autorisé ; exportez les notes si ce stockage est indisponible.

Voir [sauvegardes](doc:sync-backup), [MFA](doc:mfa) et [administration](doc:administration).
