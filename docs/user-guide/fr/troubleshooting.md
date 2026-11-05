---
id: troubleshooting
title: Dépannage
section: Sécurité et exploitation
order: 23
sourceRevision: 1
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
Le desktop ouvre le fichier index.html de CyDoc avec une URL file. Si des fichiers manquent, réinstallez ou recompilez le client complet au lieu de copier son exécutable seul. Dans un navigateur, téléchargez puis extrayez l’archive hors ligne ; gardez scripts, styles et ressources ensemble. Aucun service worker ni serveur Web n’est nécessaire. Signets et notes dépendent du stockage autorisé pour les fichiers locaux ; exportez les notes si le stockage est indisponible.

Voir [sauvegardes](doc:sync-backup), [MFA](doc:mfa) et [administration](doc:administration).
