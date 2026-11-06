---
id: content-plugin-protocol
title: Contrat des extensions de contenu
description: Déclarez des actions de message, texte et média avec des données validées et révisées.
section: Développement
parent: api-reference
order: 168
sourceRevision: 1
---

Les catalogues de plugins conservent `contributes.taskTabs` et peuvent déclarer des `contentActions`. Une contribution n'est visible que si son plugin est activé pour le projet. Il s'agit d'un contrat de rendu fixe de l'hôte, pas d'un catalogue d'extensions exécutables.

## Déclarer une action {#declare-action}

Par exemple, une entrée de `contentActions` peut décrire des champs sur les messages et textes :

~~~json
{
  "id": "context",
  "title": "Contexte Unreal",
  "renderer": "fields",
  "surfaces": ["message", "text"],
  "fields": [
    {"key": "notes", "label": "Notes", "type": "textarea", "maxLength": 20000}
  ]
}
~~~

Les surfaces compatibles sont `editor`, `message`, `text` et `media`. Le rendu `fields` ouvre un panneau validé par schéma ; `cyannota` ouvre l'éditeur d'annotations embarqué ; `cymd` modifie un brouillon Markdown. Un rendu doit déjà être implémenté et validé par l'hôte : les manifestes n'injectent ni JavaScript ni HTML.

Enregistrer dans CyMD met à jour le brouillon actif ; l'utilisateur soumet ensuite normalement le message ou document. Une archive `.cymd` n'est pas une valeur de champ texte. Les libellés courts, identifiants de connexion et champs structurés restent des entrées natives plutôt que des éditeurs enrichis.

## Lire et modifier les données {#action-data}

Utilisez les [opérations de salon et contenu](doc:rooms-api#operations) :

~~~text
GET /api/v1/projects/{projectId}/content/{kind}/{id}/plugins/{pluginId}/{actionId}
PUT /api/v1/projects/{projectId}/content/{kind}/{id}/plugins/{pluginId}/{actionId}
~~~

`kind` vaut `message`, `task` ou `resource`. Le serveur résout la cible réelle, vérifie projet, appartenance aux discussions privées, activation du plugin et portée de sa contribution. Une écriture exige un rôle modificateur et l'autorisation session/CSRF ou API limitée ; les champs non déclarés sont refusés.

~~~json
{"data": {"notes": "Examiner les assets sélectionnés"}, "expectedRevision": 0}
~~~

Utilisez la révision du dernier chargement. Une révision périmée renvoie 409 : rechargez et rapprochez les modifications au lieu d'écraser. Désactiver un plugin masque ses actions et bloque ces opérations sans supprimer les données existantes.

## Médias et stockage {#media-storage}

CyAnnota utilise les annotations validées de version 1, avec une limite de 4 Mio par document. Les octets médias restent dans CyTask. Le pont identifie les pièces jointes et ressources partagées par des marqueurs `cytask-attachment:{id}`. Lecture des médias et sauvegarde des annotations sont de nouveau autorisées par l'hôte et le serveur.

PostgreSQL conserve les données d'action avec isolation des organisations et événements transactionnels. Les espaces locaux les placent dans les snapshots ; Sync utilise révisions et signalement des conflits. Le dossier média doit accompagner les snapshots.

Les frames CyMD embarquées vérifient origine, source, protocole, version et valeur de session aléatoire. Elles reçoivent le brouillon actif, pas le jeton d'authentification. Ces éditeurs embarqués sont de confiance, pas un bac à sable pour du code arbitraire. Les images Markdown externes restent des liens, sans requête automatique distante. Voir [plugins](doc:plugins), [médias](doc:files-media) et [documents](doc:documents-markdown).
