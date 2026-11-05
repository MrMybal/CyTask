---
id: agents-api
title: Agents, orchestration, API et MCP
section: Intégrations
order: 17
sourceRevision: 1
---

CyTask représente des travailleurs automatisés par des membres agents sans mot de passe interactif. Un orchestrateur peut structurer le travail pendant qu’une personne consulte le même projet dans l’application.

```diagram
{"type":"flow","title":"L’orchestrateur crée les tâches → Appel durable → L’agent prend une tâche → Progression et acquittement","nodes":[{"id":"n0","label":"L’orchestrateur crée les tâches","x":20,"y":10,"width":400},{"id":"n1","label":"Appel durable","x":20,"y":130,"width":400},{"id":"n2","label":"L’agent prend une tâche","x":20,"y":250,"width":400},{"id":"n3","label":"Progression et acquittement","x":20,"y":370,"width":400}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n2","to":"n3"}]}
```

## Créer un agent {#create-an-agent}
Dans l’administration des agents, créez une identité dédiée et limitez ses capacités et projets. Stockez le token délivré dans le mécanisme de secrets du travailleur ; son affichage peut être unique.

Utilisez une identité par travailleur pour distinguer responsabilité et historique. Mettez en pause ou désactivez les identités inutilisées. Ne distribuez pas la session du propriétaire aux sous-agents.

## Coordonner le travail {#coordinate-work}
Créez parents et sous-tâches, affectez les travailleurs et émettez un appel durable pour demander leur attention. Ils consultent les appels, réservent les tâches avec l’opération atomique de claim, publient leur progression puis acquittent l’appel.

La réservation évite que deux travailleurs prennent simultanément le même travail. Acquitter un appel ne termine pas la tâche. Un runtime externe reste nécessaire : CyTask n’exécute pas arbitrairement le texte des tâches.

## Connecter un client MCP {#connect-an-mcp-client}
Le dépôt fournit le pont stdio `integrations/mcp/cytask-mcp.mjs`. Configurez un hôte MCP compatible pour lancer Node avec ce fichier et fournissez `CYTASK_URL` et `CYTASK_TOKEN` dans son environnement ou son mécanisme de secrets.

Utilisez une adresse locale ou HTTPS adaptée au déploiement. Ne placez jamais le vrai token dans les sources, tâches ou exemples de ligne de commande. Le pont expose les opérations autorisées du projet, pas un accès illimité aux fichiers.

## Intégrer dans une autre application {#embed-and-develop}
Le SDK et l’API servent de points d’extension. Chaque réponse reste limitée à l’identité fournie. Gérez explicitement refus d’accès, conflits de révision et erreurs réseau.

Les contrats et exemples détaillés sont dans la documentation développeur du dépôt. Voir [permissions](doc:permissions) et [Assistant IA](doc:ai-assistant).
