---
id: migration
title: Migrer depuis ClickUp ou Jira
section: Intégrations
order: 16
sourceRevision: 1
---

L’outil importe du travail ClickUp ou Jira Cloud vers un projet CyTask. Une analyse et un mapping précèdent l’écriture des tâches.

## Préparer {#prepare}
Créez ou sélectionnez le projet de destination et vérifiez vos droits d’écriture. Préparez URL ou identifiants source et un accès API limité à la lecture nécessaire.

Envisagez un premier essai dans un projet temporaire. Conservez le système source jusqu’à validation de l’import.

## Analyser et associer {#analyze-and-map}
1. Ouvrez Migration dans le projet cible.
2. Choisissez ClickUp ou Jira Cloud et renseignez la connexion.
3. Analysez la source pour obtenir un aperçu.
4. Associez états, priorités, personnes et options proposées.
5. Vérifiez nombres et avertissements, puis lancez explicitement l’import.

L’aperçu est temporaire. S’il expire, refaites l’analyse plutôt que de supposer qu’un ancien mapping reste valable.

## Vérifier {#verify-the-result}
Ouvrez plusieurs tâches importées, notamment sous-tâches, commentaires et états particuliers. Vérifiez responsables, dates, labels et liens. Le suivi d’import évite les doublons des éléments source reconnus ; ce n’est pas une synchronisation bidirectionnelle générale.

Les identifiants source servent à la demande de migration, sans devenir un compte source permanent. Les pièces jointes peuvent rester des liens externes : tous les fichiers binaires ne sont pas téléchargés.

L’outil ne modifie ni ne supprime les tâches du système source. Permissions et fonctions sans équivalent demandent une vérification manuelle.

Voir [tâches](doc:tasks), [fichiers](doc:files-media) et [permissions](doc:permissions).
