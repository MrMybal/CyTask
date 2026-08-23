# Interface des tâches

L'interface Web garde la tâche au centre : la navigation, les filtres et le détail
restent dans le même espace de travail sans imposer une succession de pages.

## Vues et navigation

- la vue **Liste** privilégie le balayage rapide, le statut et la dernière activité ;
- la vue **Kanban** regroupe les mêmes tâches par état sans dupliquer les données ;
- recherche locale, filtres d'état, de priorité, de responsable et d'échéance,
  ainsi que le tri, s'appliquent aux deux vues ;
- les priorités et échéances sont visibles dans la liste, le Kanban et le détail ;
- les échéances dépassées sont signalées sans masquer le statut de la tâche ;
- une tâche peut être assignée à un membre, recherchée par son nom et filtrée par responsable ;
- la vue, le tri et l'état de la barre latérale sont des préférences locales au navigateur ;
- une tâche possède une route `#/tasks/<uuid>` partageable et restaurée après connexion ;
- Précédent/Suivant et la fermeture du détail ne créent pas de navigation fantôme.

## Mutations sûres

Le glisser-déposer est un raccourci d'interface, pas une source de vérité. Chaque
changement d'état transmet la révision connue à l'API. L'interface applique le
changement immédiatement, puis conserve la réponse serveur. En cas de conflit
HTTP 409, elle recharge la tâche et explique que sa version locale était dépassée.

Les champs de planification sont persistés par l'API et PostgreSQL. Une mise à jour
provenant d'un ancien client qui n'envoie ni priorité ni échéance conserve leurs
valeurs courantes ; une échéance envoyée explicitement à `null` est en revanche
supprimée.

L'assignation suit la même règle de compatibilité. L'API refuse un identifiant qui
n'appartient pas à l'organisation, et PostgreSQL renforce cette frontière avec une
clé étrangère composite sur l'appartenance du membre.

Le Kanban fournit toujours un sélecteur d'état utilisable au clavier et sur mobile ;
aucune action ne dépend exclusivement du glisser-déposer. Les lecteurs ne voient
pas de contrôle de mutation, et le serveur vérifie encore le rôle et le CSRF.

## Détail

Le panneau latéral sépare cinq contextes : **Détails**, **Relations**, **Fichiers**,
**Git** et **Activité**. L'ouverture d'une autre tâche annule logiquement la réponse
réseau précédente afin qu'une réponse lente ne remplace jamais la sélection courante.
Le commentaire accepte `Ctrl/⌘ + Entrée`, tandis que `/`, `N`, `B` et `Échap`
accélèrent respectivement filtre, création, mode concentré et fermeture.

L'onglet **Relations** distingue les tâches dont la sélection dépend et celles
qu'elle bloque. L'ajout est idempotent, limité à l'organisation et protégé contre
les auto-dépendances et les cycles transitifs. PostgreSQL sérialise la vérification
du graphe par organisation afin que deux ajouts concurrents ne puissent pas créer
un cycle entre eux.

L'onglet **Fichiers** distingue trois moments de la vie d'une pièce jointe. Pendant
l'analyse, le fichier est visible mais aucun lien ne permet de le lire. Une fois
validé, il affiche ses dimensions, une vignette lorsque le serveur a reconnu une
image, et un lien de téléchargement. Une vidéo MP4 ou WebM ajoute sa durée et un
lecteur intégré : le téléchargement gère les requêtes de plage, le déplacement dans
la timeline ne rapatrie donc pas le fichier entier. Refusé, le fichier conserve sa
ligne et affiche le motif exact du refus plutôt que de disparaître sans explication.

L'empreinte d'un fichier volumineux est calculée par tranches, sans jamais le charger
entièrement en mémoire ; sa progression est affichée avant celle de l'envoi. Aucune
limite de taille n'est imposée par le client : seule la configuration du serveur décide.

## Vitesse perçue

La palette `Ctrl/⌘ + K` recherche tâches, projets et actions par correspondance
approximative, se pilote entièrement au clavier et n'impose aucun aller-retour
serveur. Survoler une tâche précharge son détail, ses fichiers, ses références et
ses dépendances ; l'ouvrir consomme alors le résultat déjà en vol au lieu de
relancer quatre requêtes. Le cache expire après quinze secondes pour ne jamais
afficher un état périmé.

Une ligne d'ajout rapide crée une tâche depuis la liste ou la colonne « À faire »
sans ouvrir de formulaire, et l'insère immédiatement. Les erreurs et confirmations
passent par des notifications empilées qui ne déplacent plus la mise en page, et le
détail affiche un squelette pendant son chargement au lieu d'un panneau vide.

## Performance et accessibilité

- les réponses périmées après un changement de projet sont ignorées ;
- les lignes et cartes hors écran utilisent `content-visibility` quand disponible ;
- le Kanban défile horizontalement sur les petites surfaces et la liste se compacte ;
- les contrôles exposent labels, états pressés et focus visible ;
- la préférence système de réduction des animations est respectée.

La prochaine étape d'échelle sera une pagination serveur à curseur et une mesure
sur des projets réalistes avant d'introduire une virtualisation JavaScript plus
complexe.
