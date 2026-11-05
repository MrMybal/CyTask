---
id: ai-assistant
title: Connexions de l’Assistant IA
section: Intégrations
order: 15
sourceRevision: 1
---

Le plugin Assistant IA relie CyTask aux fournisseurs configurés. Un profil de connexion décrit un accès ; il ne garantit pas l’exécution autonome de toutes les tâches.

## Configurer une connexion {#configure-a-connection}
1. Activez Assistant IA pour le projet.
2. Ouvrez ses connexions et choisissez le fournisseur ou l’API compatible.
3. Renseignez modèle et authentification dans les champs dédiés.
4. Testez la connexion avant d’utiliser le contexte du projet.

Les profils couvrent OpenAI, Anthropic, API compatibles, endpoints locaux Ollama ou LM Studio, ainsi que les voies Codex, Claude Code et OpenCode prises en charge. Leur disponibilité dépend des capacités autorisées sur le serveur.

Ne collez pas de clé dans une description de tâche. Utilisez les paramètres de connexion et révoquez une clé exposée chez son fournisseur.

## Outils locaux et serveur distant {#local-tools-and-remote-servers}
« Local » désigne la machine qui exécute l’outil. Un CLI sur le serveur d’équipe n’est pas automatiquement celui de votre desktop. L’exécution locale doit être autorisée et configurée par l’administrateur.

Ne fournissez que le contexte nécessaire. Vérifiez les propositions avant de les appliquer : un modèle peut mal interpréter une consigne ou produire une réponse inexacte.

## Assistance et orchestration {#assistance-versus-orchestration}
L’assistance contextualisée est distincte de la planification durable d’agents. Pour créer des membres agents, réserver du travail et acquitter des appels, utilisez l’API dédiée et l’intégration MCP.

Une connexion à un fournisseur n’autorise pas à lancer arbitrairement des commandes ni à publier le projet. Voir [agents et MCP](doc:agents-api), [permissions](doc:permissions) et [plugins](doc:plugins).
