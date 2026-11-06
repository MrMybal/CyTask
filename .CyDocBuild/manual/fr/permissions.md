---
id: permissions
title: Membres, rôles et accès aux projets
order: 13
description: Comprenez les rôles, les projets privés et les discussions restreintes.
section: Équipe
parent: chat
sourceRevision: 2
---

Les permissions sont vérifiées par le serveur, pas seulement par l’affichage des boutons. Lien de tâche, identifiant de ressource et aperçu de message doivent toujours passer les contrôles d’accès.

## Rôles {#roles}
| Rôle | Responsabilité habituelle |
| --- | --- |
| Propriétaire | Possède l’espace et sa configuration d’administration |
| Administrateur | Gère membres, projets et fonctions d’administration |
| Membre | Participe et modifie le travail autorisé |
| Lecteur | Consulte le travail autorisé sans les actions normales d’écriture |

Un projet hérite des accès de l’espace ou utilise une liste privée de membres. Les administrateurs de l’organisation conservent leur accès administratif. Les groupes privés vérifient aussi leurs participants.

## Configurer correctement {#configure-safely}
Gérez les membres depuis l’équipe et les paramètres du projet. Après un changement de visibilité, vérifiez avec un compte membre ou lecteur distinct, pas uniquement avec le propriétaire.

Les invitations et tokens d’agents sont des identifiants d’accès. Utilisez l’invitation prévue pour une personne et une identité d’agent limitée pour une automatisation ; ne partagez pas le compte administrateur.

## Périmètre et limites {#scope-and-limits}
Les permissions de projet ne sont pas une matrice complète autoriser/refuser par salon. Catégories et dossiers classent le contenu sans créer automatiquement de frontière de sécurité.

Un espace local partagé fait confiance aux personnes qui accèdent à son dossier. Cet accès système ou de synchronisation n’est pas protégé par les rôles de l’interface Web.

En cas de refus, vérifiez appartenance, rôle et participation au groupe privé. Voir [dépannage](doc:troubleshooting) et [agents](doc:agents-api).
