# Orchestration d’agents, MCP et SDK

CyTask distingue les comptes humains des **membres agents**. Un agent possède un nom, une clé stable, une description, une liste de capacités et un état `active`, `paused` ou `disabled`. Il n’a aucun mot de passe interactif : sa création produit une fois un jeton API `read write` rattaché à son identité.

Mettre un agent en pause suspend immédiatement son accès et empêche toute nouvelle prise de tâche. Le réactiver restaure l’accès avec le même jeton ; le désactiver est destiné à une sortie définitive de l’orchestration.

## Flux d’orchestration

1. Un propriétaire ou administrateur crée les agents dans **Paramètres et outils → Agents**.
2. L’orchestrateur crée des tâches, les découpe en enfants et ajoute les dépendances utiles.
3. Il envoie un appel durable à un agent, éventuellement lié à une tâche.
4. L’agent lit son contexte et sa boîte de notifications.
5. Il prend atomiquement une tâche libre, publie sa progression en commentaires et met à jour l’état.
6. Il acquitte l’appel traité.

La prise est idempotente pour le même agent et répond en conflit si un autre membre possède déjà la tâche. Un agent en pause ou désactivé ne peut plus utiliser son jeton ; une réactivation restaure le jeton d’un agent en pause.

Les agents, leurs états et leurs appels font partie des snapshots du mode dossier. Les jetons restent propres à l’appareil et ne sont pas écrits dans le dossier partagé.

## Serveur MCP

Le serveur stdio se trouve dans `integrations/mcp/cytask-mcp.mjs`. Il utilise JSON-RPC ligne par ligne et accepte les versions MCP `2025-11-25` et `2025-06-18`.

Variables d’environnement obligatoires :

- `CYTASK_URL` : origine du serveur CyTask ;
- `CYTASK_TOKEN` : jeton de l’orchestrateur ou de l’agent.

Dans CyTask Desktop, l’adresse courante peut être copiée dans **Paramètres et outils → Agents**. Le moteur local doit rester ouvert pendant l’utilisation depuis une autre application.

Les outils couvrent la lecture du contexte, les projets et tâches, la création et modification de tâches, le découpage parent/enfants, les commentaires, la création et l’appel d’agents, la prise de tâche et l’acquittement des notifications.

## SDK embarquable

`packages/sdk-js` fournit `CyTaskClient`, un module ESM sans dépendance externe. Une application Node.js, Electron ou un service local peut injecter son propre `fetch`, lire le même serveur qu’un navigateur et utiliser exactement les mêmes contrôles d’autorisation.

```js
import { CyTaskClient } from "@cytask/sdk";

const client = new CyTaskClient({
  baseUrl: process.env.CYTASK_URL,
  token: process.env.CYTASK_TOKEN
});

const context = await client.agentContext();
await client.claimTask(context.notifications[0].taskId);
```

Le SDK n’enregistre jamais le jeton. L’application hôte choisit son stockage de secrets et l’injecte à l’exécution.
