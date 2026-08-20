# Vision produit

## Proposition

CyTask réunit la gestion du travail, les médias de production, Git et Unreal
Engine sans imposer Git ni Unreal aux équipes qui n'en ont pas besoin. Une équipe
peut utiliser le service hébergé sur son propre serveur, le Web ou une application
installée.

## Principes

1. **Le cœur fonctionne seul.** Projets et tâches ne dépendent d'aucun fournisseur.
2. **Local-first pour les fichiers lourds, pas pour les autorisations.** Le client
   peut optimiser un média, mais le serveur contrôle toujours le résultat et les
   droits.
3. **Sécurisé par défaut.** Une installation neuve n'expose ni plugin privilégié,
   ni inscription publique, ni secret par défaut.
4. **Extensible avec consentement.** Chaque plugin déclare ses capacités ; un
   administrateur accepte toute permission sensible.
5. **API stable avant multiplication des clients.** Web, applications et Unreal
   consomment les mêmes contrats versionnés.
6. **Déploiement simple.** Une petite équipe doit pouvoir démarrer avec un serveur,
   PostgreSQL et un stockage S3 compatible.
7. **Préparer la décentralisation sans la simuler trop tôt.** Identifiants,
   révisions et fichiers seront synchronisables, mais la base active ne sera
   jamais placée directement dans Syncthing.

## Périmètre fonctionnel

### Cœur

- organisations, espaces, membres, équipes et rôles ;
- projets, vues, états, priorités, jalons et étiquettes ;
- tâches, sous-tâches, relations, dépendances et listes de contrôle ;
- commentaires, mentions, abonnements et notifications ;
- activité et journal d'audit ;
- recherche, filtres enregistrés et mises à jour en temps réel ;
- import/export documenté afin d'éviter l'enfermement des données.

### Médias

- envoi direct et reprenable vers le stockage objet ;
- vignettes, métadonnées, variantes d'images et lecture vidéo adaptative ;
- optimisation locale facultative dans l'application ;
- traitement serveur isolé comme solution universelle ;
- conservation optionnelle de l'original selon la politique de l'organisation.

La conversion locale est une optimisation, jamais une frontière de confiance. Le
serveur vérifie type réel, taille, dimensions, durée, codecs et quotas.

### Git

- connecteurs Git génériques et fournisseurs spécialisés ;
- association explicite d'un commit, d'une branche ou d'une demande de fusion ;
- association automatique par clé de tâche, par exemple `CY-142` ;
- statut des contrôles et liens retour, sans rendre Git obligatoire ;
- webhooks authentifiés, idempotents et rejouables.

### Unreal Engine

- connexion par navigateur avec jeton court et stockage sécurisé du système ;
- panneau de projets, tâches, commentaires et pièces jointes dans l'éditeur ;
- capture d'écran ou média depuis l'éditeur vers une tâche ;
- association de packages/assets et de changements de source à une tâche ;
- recettes d'assets avec prévisualisation, validation, transaction et annulation ;
- cœur C++ commun, adaptateurs par version et matrice de compilation 4.27–5.8.

Une recette standard ne contient ni commande shell, ni Python arbitraire. Les
actions risquées seront réservées à un plugin de confiance explicitement autorisé.

### Extensions

- manifestes versionnés, paquets signés et permissions déclarées ;
- extensions serveur isolées, connecteurs externes et extensions d'interface ;
- registre privé d'organisation avant un éventuel registre public ;
- compatibilité d'API vérifiée avant installation ou mise à jour.

## Non-objectifs de la première version

- reproduire immédiatement toutes les fonctions de ClickUp ;
- autoriser du code natif non vérifié dans le processus serveur ;
- rendre le cluster Kubernetes obligatoire ;
- synchroniser les fichiers PostgreSQL ou SQLite avec Syncthing ;
- garantir chaque version Unreal avec un seul binaire de plugin ;
- livrer simultanément Web, quatre bureaux, Android et Unreal.

## Critères initiaux de réussite

- installation d'évaluation en moins de quinze minutes ;
- chemin critique tâche/commentaire utilisable avec une latence ressentie faible ;
- aucune perte lors d'un renvoi de webhook ou d'un job média ;
- séparation d'organisation testée automatiquement ;
- restauration complète testée à partir d'une sauvegarde ;
- une tâche CyTask visible et commentable depuis Unreal et le Web.

