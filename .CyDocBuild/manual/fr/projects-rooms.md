---
id: projects-rooms
title: Projets, catégories et salons
order: 3
description: Organisez les projets, les catégories de salons et les pages de votre équipe.
section: Travail quotidien
sourceRevision: 2
---

Le projet constitue le périmètre principal de collaboration. Il rassemble membres, ressources, tâches et salons. Les catégories organisent la liste des salons ; les dossiers classent les tâches du projet. Ces deux structures ont des rôles différents.

```diagram
{"type":"architecture","title":"Projet → Catégorie production → Tâches → Documents / canvas / fichiers → Catégorie équipe → Tchat / annonces → Vocal / vidéo","nodes":[{"id":"n0","label":"Projet","x":185,"y":10,"width":320},{"id":"n1","label":"Catégorie production","x":20,"y":110,"width":320},{"id":"n2","label":"Tâches","x":20,"y":220,"width":320},{"id":"n3","label":"Documents / canvas / fichiers","x":20,"y":330,"width":320},{"id":"n4","label":"Catégorie équipe","x":370,"y":110,"width":320},{"id":"n5","label":"Tchat / annonces","x":370,"y":220,"width":320},{"id":"n6","label":"Vocal / vidéo","x":370,"y":330,"width":320}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n1","to":"n3"},{"from":"n0","to":"n4"},{"from":"n4","to":"n5"},{"from":"n4","to":"n6"}]}
```

## Choisir un type de salon {#choose-a-room-type}
| Salon | Utilisation |
| --- | --- |
| Tâches | Consulter et modifier en liste, vue compacte ou tableau |
| Tchat / annonces | Discuter, partager des liens et publier les actualités |
| Vocal / vidéo | Rejoindre un appel en direct |
| Document | Rédiger une page partagée du projet |
| Canvas | Disposer notes, dessins, formes et médias dans un espace libre |
| Fichiers | Consulter ressources et pièces jointes stockées |
| Graphe | Explorer la hiérarchie et les relations entre tâches |

## Organiser la navigation {#organize-the-sidebar}
Utilisez les contrôles d’ajout des salons ou catégories pour créer l’élément souhaité. Vérifiez le projet de destination. Repliez les catégories pour alléger la navigation.

Les dossiers de tâches peuvent contenir des sous-dossiers. Leur chevron ne change que l’affichage : replier ne supprime aucun contenu. Une catégorie n’est pas une tâche parente et changer de salon ne modifie pas les dépendances.

## Partager un accès {#share-and-access}
Copiez le lien du salon ou de la tâche pour orienter vos collègues. Ils doivent se connecter au même serveur et disposer des droits du projet. Un tchat privé peut restreindre davantage ses membres.

La présentation utilise projets et salons, mais les permissions restent organisées par projet : il ne s’agit pas d’une reproduction complète des permissions par salon de Discord.

Voir [dossiers et vues](doc:views-folders), [tchat](doc:chat) et [permissions](doc:permissions).
