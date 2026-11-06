---
id: administration
title: Administration du serveur
order: 21
description: Déployez un serveur d’équipe persistant et configurez stockage, courriel et appels.
section: Serveur
sourceRevision: 2
---

Pour une équipe réelle, utilisez une base persistante et une configuration de déploiement maîtrisée. Le serveur en mémoire et le script de démo servent aux tests, pas à la production.

## Déployer et mettre à jour {#deploy-and-update}
Le dépôt fournit `infra/compose.yaml`, son exemple d’environnement et un Dockerfile serveur. Préparez les valeurs privées, puis lancez depuis la racine du dépôt :
Le serveur persistant exige aussi une clé de plugins : générez 32 octets
cryptographiquement aléatoires, encodez-les en base64 et placez cette valeur dans
`CYTASK_PLUGIN_SECRET_KEY` de l’environnement privé. Le Compose de base ne transmet
pas ce réglage ; créez une surcharge privée `infra/compose.private.yaml` :

~~~yaml
services:
  server:
    environment:
      CYTASK__PLUGINSECRETKEY: ${CYTASK_PLUGIN_SECRET_KEY:?Set the persistent plugin key}
~~~

Lancez ensuite avec les deux fichiers :

~~~sh
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.private.yaml up --build -d
~~~

Créez d’abord votre fichier privé `infra/.env` à partir de l’exemple et remplacez chaque identifiant exemple. Le port applicatif Compose écoute sur la boucle locale : ajoutez un reverse proxy TLS, gardez PostgreSQL privé et conservez les volumes nommés base/médias.

Avant mise à jour, sauvegardez base, médias et clés nécessaires. Suspendez les écritures, appliquez les migrations de la version et testez le service avant réouverture. Supprimer les volumes n’est jamais une étape de mise à jour.

## Paramètres essentiels {#essential-settings}
| Paramètre | Usage |
| --- | --- |
| `CYTASK_DB_PASSWORD` | Identifiant de base unique pour Compose |
| `CYTASK_ALLOWED_HOSTS` | Noms d’hôtes réellement autorisés |
| `CYTASK_PUBLIC_ORIGIN` | Origine HTTPS publique exacte pour les appels derrière un proxy TLS |
| `CyTask__PluginSecretKey` | Clé persistante des secrets fournisseurs |
| `CyTask__DataEncryptionEnabled` / `CyTask__DataEncryptionKey` | Chiffrement optionnel du contenu et clé distincte |
| `CyTask__MfaPolicy` | `disabled`, `optional` ou `required` |
| `CyTask__MfaEncryptionKey` | Clé persistante de protection des secrets MFA |

Les noms `CyTask__...` sont les variables directes du serveur. Compose associe les variables `CYTASK_...` documentées ; tout autre réglage doit être transmis explicitement au service. Une variable quelconque n’est pas automatiquement propagée.

## Courriel et appels {#email-and-live-calls}
La MFA par courriel nécessite hôte SMTP, port, expéditeur et TLS : `StartTls` ou `SslOnConnect`. Nom d’utilisateur et mot de passe sont fournis ensemble si requis. Testez la livraison avant de l’imposer.

Le proxy doit transmettre les mises à niveau WebSocket du signalement d’appel. Configurez vos propres `CyTask__WebRtcStunUrls__0` et `CyTask__WebRtcTurnUrls__0` si nécessaire. TURN exige `CyTask__WebRtcTurnSharedSecret` ; le mode relais seul exige un relais fonctionnel.

Aucun fournisseur STUN/TURN public n’est contacté par défaut. Le signalement est interne au processus : utilisez un seul serveur pour les appels sans architecture de routage partagé supplémentaire. Le maillage accepte par défaut 8 participants, au plus 16.

## Vérifications de mise en service {#acceptance-checklist}
Testez santé, connexion d’un membre, droits non administrateur, modification, envoi/téléchargement, appel entre appareils et restauration. Servez Web et guide de la même version que le serveur.

Voir [chiffrement](doc:encryption), [MFA](doc:mfa), [appels](doc:calls) et [sauvegardes](doc:sync-backup).
