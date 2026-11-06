---
id: desktop-local
title: Client desktop et espaces locaux
order: 1
description: Ouvrez un dossier personnel, retrouvez votre session et déplacez un espace local.
section: Démarrer
parent: getting-started
sourceRevision: 2
---

Le client desktop propose deux entrées : une connexion à un serveur distant, ou l’ouverture d’un dossier local. L’espace local est un environnement de travail complet, pas une démonstration en lecture seule.

## Ouvrir un espace local {#open-a-local-workspace}
1. Dans le sélecteur desktop, choisissez le mode local puis un dossier dédié.
2. Utilisez le dossier seul sur cette machine, ou configurez ensuite Sync pour le répliquer. Le stockage local est compatible avec la synchronisation dans les deux cas.
3. L’espace solo s’ouvre directement avec son propriétaire local, sans formulaire de connexion. La création de compte et la confirmation du mot de passe concernent les comptes d’un serveur d’équipe, pas l’ouverture d’un dossier solo.
4. Créez vos projets et tâches. Un dossier existant rouvre son espace au lieu de créer un nouveau projet.

Le mode solo utilise une session propriétaire locale et un moteur limité à la machine. Il n’impose pas une connexion au serveur à chaque lancement. Les sessions distantes sont conservées tant qu’elles sont valides ; expiration, révocation ou politique administrateur peuvent imposer une reconnexion.

## Comprendre le stockage {#understand-storage}
Sélectionnez la racine de l’espace, pas son dossier interne de métadonnées. Les données partagées et les médias vivent dans ce dossier. Préférences desktop, identité d’appareil et connexions mémorisées restent propres à l’appareil.

Ne modifiez pas les snapshots internes à la main. Utilisez l’interface ou [l’API des agents](doc:agents-api).

## Fermer, déplacer et restaurer {#close-move-and-restore}
Fermez normalement l’espace avant de le copier ou de le déplacer. Sauvegardez le dossier entier, médias compris, ainsi que sa clé de chiffrement éventuelle conservée séparément. Ouvrez la destination avec le sélecteur de dossier.

Le mode local suppose que les personnes autorisées à écrire dans le dossier sont de confiance. Utilisez un serveur pour des membres non fiables ou des comptes contrôlés centralement.

Consultez [Sync et sauvegardes](doc:sync-backup) pour plusieurs appareils, ou [le dépannage](doc:troubleshooting) en cas d’écran vide.
