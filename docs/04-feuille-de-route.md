# Feuille de route

La progression se fait par tranches utilisables. Chaque phase doit conserver une
installation simple, des migrations réversibles quand possible et une sauvegarde
restaurable.

## Phase 0 — Fondations

- décisions de langage, licence et gouvernance ;
- monorepo, formatage, tests, CI et génération des contrats ;
- serveur, migrations PostgreSQL, observabilité et configuration sûre ;
- Web minimal et environnement de développement reproductible ;
- modèle de menace, politique de sécurité et sauvegarde/restauration.

**Sortie :** serveur local démarrable, contrôles CI verts et restauration prouvée.

## Phase 1 — Première tranche verticale

- compte, organisation, membres et rôles ;
- projet, tâche, états, labels, checklists et commentaires ;
- journal d'activité et mise à jour temps réel ;
- recherche simple et export ;
- application Web responsive/PWA.

**Sortie :** une petite équipe peut réellement gérer un projet sans Git.

## Phase 2 — Fichiers et médias

- envoi reprenable vers stockage S3 compatible ;
- quarantaine, validation et quotas ;
- vignettes image et profils vidéo serveur ;
- progression, reprise des jobs et politique de conservation ;
- optimisation locale dans un premier client installé.

**Sortie :** médias lourds fiables, restaurables et utilisables sur connexion lente.

## Phase 3 — Git officiel

- SDK de connecteur et installation administrateur ;
- Git générique puis un fournisseur distant prioritaire ;
- clés de tâche, commits, branches, demandes de fusion et webhooks ;
- durcissement SSRF/secrets et audit des opérations.

**Sortie :** navigation bidirectionnelle fiable entre travail et code.

## Phase 4 — Unreal vertical

- authentification PKCE et panneau de tâches ;
- commentaires, pièces jointes, captures et liens d'assets ;
- cache hors ligne limité et file d'envoi ;
- une recette d'asset simple de bout en bout ;
- compilation automatisée d'abord sur 4.27, 5.0, une version 5.x médiane et 5.8,
  puis élargissement de la matrice.

**Sortie :** la même tâche est actionnable depuis le Web et Unreal.

## Phase 5 — Plateforme de plugins

- paquet, signature, registre privé et permissions ;
- hôte isolé, SDK stable et compatibilité d'API ;
- extensions UI isolées et connecteurs de service ;
- mise à jour, retour arrière et révocation.

**Sortie :** un tiers peut étendre CyTask sans accès implicite au serveur.

## Phase 6 — Clients et échelle

- applications Windows, Linux et macOS ;
- Android centré sur consultation, notifications et capture ;
- profils de charge, cache mesuré et extraction éventuelle de workers ;
- haute disponibilité optionnelle, sans pénaliser les petites installations.

## Phase 7 — CyRevision décentralisé

- format de paquet de synchronisation signé ;
- transport Syncthing via CyRevision ;
- import idempotent, conflits visibles et réparation ;
- liens entre versions d'assets, tâches et révisions.

**Sortie :** collaboration non centralisée sans synchronisation brute de base.

## Premier incrément recommandé

Le premier développement doit tenir dans un seul scénario automatisé :

1. démarrer une installation locale ;
2. créer un compte et une organisation ;
3. créer un projet et une tâche ;
4. commenter depuis une seconde session ;
5. recevoir le commentaire en temps réel ;
6. exporter les données ;
7. sauvegarder, supprimer l'installation de test et restaurer le même état.

