---
id: hierarchy
title: Sous-tâches et dépendances
section: Travail quotidien
order: 6
sourceRevision: 1
---

La hiérarchie répond à « de quel travail cela fait-il partie ? ». La dépendance répond à « que faut-il faire avant ? ». Utilisez ces liens explicitement plutôt que de tout encoder dans les titres.

```diagram
{"type":"dependency","title":"Jalon / tâche parente → Sous-tâche artistique → Sous-tâche de build → La revue dépend de la build","nodes":[{"id":"n0","label":"Jalon / tâche parente","x":185,"y":10,"width":320},{"id":"n1","label":"Sous-tâche artistique","x":20,"y":120,"width":320},{"id":"n2","label":"Sous-tâche de build","x":370,"y":120,"width":320},{"id":"n3","label":"La revue dépend de la build","x":370,"y":230,"width":320}],"edges":[{"from":"n0","to":"n1"},{"from":"n0","to":"n2"},{"from":"n2","to":"n3"}]}
```

Un lien parent regroupe le travail ; une dépendance décrit un ordre.

## Découper une tâche {#split-a-task}
1. Ouvrez la tâche parente.
2. Dans Sous-tâches, créez un enfant ou rattachez une tâche existante avec le sélecteur de parent.
3. Donnez à chaque enfant responsables, état et critères de validation.
4. Gardez le parent comme synthèse du livrable.

Une checklist suffit généralement aux étapes sans responsable ni calendrier distinct. Une sous-tâche reste une vraie tâche, consultable et partageable séparément.

## Ajouter une dépendance {#set-a-dependency}
Dans Relations, choisissez la tâche préalable et ajoutez-la à Dépend de. Le lien inverse apparaît dans Bloque sur la tâche préalable. Retirez le lien lorsqu’il ne représente plus le travail.

« Relire la build » peut dépendre de « Préparer la build » sans en être un enfant. Parents et dépendances ne sont pas interchangeables.

## Garder un graphe lisible {#keep-the-graph-usable}
Les cycles et relations incompatibles entre projets sont refusés. En cas de refus, vérifiez le projet, vos droits et l’absence de boucle.

Le Graphe présente dossiers, parents, enfants et relations. Zoomez et déplacez-vous pour explorer un groupe ; ouvrez une tâche depuis son nœud pour la modifier.

Les dépendances décrivent la coordination, pas une automatisation : un lien ne lance pas une build, n’appelle pas un agent et ne termine pas les autres tâches.

Voir [agents et MCP](doc:agents-api) pour les travailleurs automatisés.
