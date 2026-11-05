---
id: team-server
title: Se connecter à un serveur d’équipe
section: Prise en main
order: 2
sourceRevision: 1
---

Un serveur d’équipe permet de travailler à plusieurs avec des comptes individuels. Demandez l’adresse et votre compte à son administrateur ; l’espace de démonstration n’est pas un service de comptes pour la production.

## Connexion {#connect}
1. Ouvrez l’URL du serveur dans un navigateur. Dans le client desktop, ajoutez son adresse complète, protocole et port compris si nécessaire.
2. Utilisez HTTPS en dehors d’un environnement local de développement isolé.
3. Connectez-vous, ou acceptez une invitation et créez votre compte si cette option est proposée.
4. Validez le second facteur s’il est demandé, puis sélectionnez un projet.

Une invitation peut expirer ou avoir déjà servi. Demandez son remplacement au lieu d’utiliser le compte d’un autre membre.

## Sessions mémorisées {#retained-sessions}
Une session valide est conservée pour éviter de ressaisir le mot de passe à chaque démarrage. Déconnexion, révocation, changement de politique ou expiration peuvent l’invalider. Le client desktop isole les connexions aux différentes adresses de serveurs.

Ne placez pas de token dans une URL, une capture ou un lien partagé. Un lien vers un salon ou une tâche indique un contenu, sans donner le droit d’y accéder.

## Premier administrateur {#first-administrator}
Sur un nouveau déploiement, suivez la création du propriétaire initial et choisissez un mot de passe unique. Les comptes des scripts de démonstration sont réservés aux tests.

Configurez adresse publique, hôtes autorisés, stockage, base et messagerie avant d’inviter l’équipe. Vérifiez HTTPS, restauration et permissions avec un compte distinct non administrateur.

Voir [les permissions](doc:permissions), [la double authentification](doc:mfa) et [l’administration](doc:administration).
