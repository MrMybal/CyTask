# Journal des versions

Ce fichier présente les changements notables de CyTask.

[Retour au README](README.fr.md) · [English](CHANGELOG.md)

## [Non publié]

## [0.2.3] - 2026-11-06

**Statut : EN DÉVELOPPEMENT · Client publié : Windows x64.**

Cette version de développement est destinée aux essais et retours, sans déclaration de maturité pour la production. Les [téléchargements et notes de publication](https://github.com/MrMybal/CyTask/releases/tag/v0.2.3) fournissent portable, installateur et empreintes SHA-256.

### Ajouts

- Lecteur CyDoc publié sur GitHub Pages avec génération documentaire automatique et liens de README par langue.
- Documentation CyDoc locale avec guides complets anglais/français, contrats API publics, signatures SDK, galeries de captures et schémas SVG.
- Aide desktop ouverte directement depuis les fichiers, liens contextuels et manuel hors ligne autonome téléchargeable.
- Entrées documentaires dans l’interface Web, l’écran de connexion et le sélecteur desktop, ainsi que menu Aide et raccourci F1.
- Navigation par projets comparable à des serveurs, avec catégories, salons typés, liens de salon et rôles propres au projet.
- Éditeurs Markdown avec mentions, suggestions de tâches et édition CyMD intégrée.
- Actions de plugins sur messages, textes et médias, dont les annotations CyAnnota.
- Salons vocaux et vidéo en direct avec partage d’écran indépendant, choix des périphériques et configuration STUN/TURN.
- Double authentification facultative ou obligatoire par application d’authentification ou codes e-mail, avec paramètres du compte et codes de secours.
- Chiffrement au repos optionnel pour les espaces locaux/Sync, médias déposés et contenus PostgreSQL, avec clés desktop externes et commande explicite de conversion hors ligne.

### Améliorations

- Lecteur documentaire actualisé avec recherche globale en en-tête, navigation arborescente, barre latérale élargie, infobulles descriptives et positions de lecture conservées.
- Organisation standard Documentation.html/DocData, consignes pour agents séparées, archive hors ligne et compatibilité des liens d’aide contextuels.
- Contraste renforcé des textes, états et priorités dans les six thèmes, y compris lignes sélectionnées et focus clavier.
- Libellés et contrôles plus lisibles dans le tableau compact, sans perdre sa densité.
- Couverture de non-régression élargie pour accès aux projets, extensions de contenu, appels, authentification, stockage chiffré et thèmes.

### Problèmes connus

Les notes de publication ne fournissent pas de liste détaillée de bugs confirmés. Consultez le [suivi des problèmes](https://github.com/MrMybal/CyTask/issues) ou [signalez un problème](https://github.com/MrMybal/CyTask/issues/new). Les limites ci-dessous décrivent le périmètre du produit ; ce ne sont ni des tickets inventés ni l’affirmation qu’aucun bug n’existe.

### Limites documentées

- Les paquets natifs publiés de la 0.2.3 concernent seulement Windows x64. Des cibles Linux/macOS existent dans les sources, mais aucun binaire n’est fourni pour cette release. Aucun client Android n’est publié.
- Les exécutables Windows ne sont pas signés avec Authenticode ; SmartScreen peut afficher un avertissement. Fermez CyTask avant une mise à jour et conservez les dossiers de projet ainsi que les sauvegardes des clés.
- Le connecteur Unreal est un plugin source, à compiler pour chaque moteur/plateforme. Des compilations sont documentées pour UE 5.2 et 5.8 ; la cible 4.27 nécessite encore une validation sur une installation complète du moteur. La compatibilité sur toute la plage 4.27–5.8 n’est pas garantie.
- Le réencodage automatique des vidéos déposées dans les tâches et l’analyse antivirale ne sont pas implémentés. Le moteur WASM séparé de CyAnnota ne fournit pas ces fonctions à l’ensemble du serveur. La lecture dépend des codecs du navigateur.
- Les appels utilisent un maillage pair-à-pair : 8 participants par défaut et un maximum configurable de 16. Des réseaux séparés peuvent nécessiter un relais TURN privé. Aucun SFU, enregistrement ou partage garanti du son système n’est fourni.
- La migration ClickUp/Jira conserve les pièces jointes distantes comme liens vers la source ; leurs contenus binaires ne sont pas téléchargés automatiquement.
- Sync nécessite un transport externe configuré séparément et des participants de confiance dans le dossier. Ce n’est pas une sauvegarde et il ne faut pas répliquer le répertoire d’une base active.
- Le chiffrement au repos est facultatif et n’est pas de bout en bout. Les données existantes nécessitent une conversion explicite hors ligne ; réinitialiser le mot de passe du compte ne récupère pas une clé de stockage perdue.

## [0.2.2] - 2026-10-25

### Ajouts

- Ouverture directe des espaces locaux solo, sans écran de compte interactif.
- Membres agents avec appels de travail persistants, notifications et prise atomique des tâches.
- SDK JavaScript sans dépendance et pont MCP stdio pour exposer l’orchestration des projets et tâches à d’autres applications.

### Corrections

- Arrêt local après confirmation d’un point de sauvegarde ; les grands espaces et annotations sont conservés au redémarrage.
- Conservation des états modifiés, assignations de tâches et modifications concurrentes pendant la synchronisation.
- Médias des canvas stockés dans la bibliothèque du projet et partagés entre les sessions.
- Lectures de collaboration PostgreSQL regroupées, avec reprise des workers après une interruption de la base.
- Rafraîchissements de collaboration regroupés pour réduire les requêtes redondantes.

### Distribution

- Client portable Windows x64 reconstruit avec l’interface Web, le serveur local et le runtime Electron actualisés.
- Exécutable non signé avec Authenticode ; Windows SmartScreen peut afficher un avertissement.

## [0.2.1] - 2026-09-13

### Changements

- Les compilations desktop de distribution n’incluent plus les source maps Web ni les symboles de débogage .NET.
- La génération du moteur desktop construit et embarque désormais le plugin Web CyAnnota à chaque compilation de distribution.
- Mode de compilation de distribution dédié pour l’interface Web principale et l’intégration CyAnnota.

### Distribution

- Exécutable portable Windows x64 et installateur interactif NSIS actualisés.
- Binaires non signés avec Authenticode. Contrôlez SHA256SUMS.txt avant de les exécuter ; Windows SmartScreen peut afficher un avertissement.

## [0.2.0] - 2026-08-31

### Ajouts

- Outil de migration ClickUp et Jira Cloud avec aperçu de la source, correspondance des états/responsables et détection des doublons lors d’imports répétés.
- Six thèmes persistants : Graphite, Minuit, Forêt, Brume, Papier et Contraste élevé.
- Sélection visuelle du thème depuis Paramètres et outils, avec libellés anglais/français.
- Dossiers imbriqués repliables et création de tâches/groupes directement dans la vue courante.

### Améliorations

- Navigation, contrôles, listes de tâches et paramètres plus compacts.
- Surfaces opaques cohérentes, bordures plus nettes et contraste renforcé dans les thèmes clairs/sombres, y compris onglets de tâches, menus, formulaires et panneaux de plugins.
- Sessions locales conservées après redémarrage jusqu’à leur expiration configurée ; leur stockage reste sur l’appareil, hors des dossiers synchronisés.
- Confirmation du mot de passe à la création du premier compte.

### Corrections

- Affichage vide des espaces locaux et fonds de survol sombres illisibles dans les onglets de tâches en thème clair.
- Suppression des cookies de session locale et registres de session de l’appareil lors du retrait du profil d’espace enregistré.

### Mise à jour Windows

- Exécutable portable Windows x64 et installateur NSIS interactif, tous deux avec serveur local et interface Web actualisés.
- Sauvegardez les dossiers de projet avant la mise à niveau. Fermez CyTask, puis lancez le nouvel installateur ou remplacez la portable ; conservez vos dossiers de données existants.
- Binaires non signés avec Authenticode. Contrôlez SHA256SUMS.txt avant de les exécuter ; Windows SmartScreen peut afficher un avertissement.

### Notes de migration

Les identifiants de la source ne sont pas conservés. Examinez aperçu et correspondances avant l’import. Les pièces jointes de la source restent liées ; leurs contenus binaires ne sont pas téléchargés automatiquement.

## [0.1.0] - 2026-08-28

Première publication du client Windows.

### Points principaux

- Gestion auto-hébergée des projets et tâches, avec vues Liste, Compacte, Kanban, Canvas et Graphe.
- Mode dossier local avec snapshots immuables conçus pour Syncthing et CyRevision Sync.
- Interface anglaise par défaut, avec prise en charge persistante du français sur le Web et le desktop.
- Dossiers de projet, états colorés personnalisés, responsables multiples, édition groupée et vues enregistrées.
- Discussion d’équipe avec salons, groupes privés, aperçus de tâches, pièces jointes et fondations du vocal/partage d’écran.
- Intégrations déclaratives Git, AI Assistant, Unreal Engine, CyRevision et CyAnnota.
- Client portable Windows x64 et installateur NSIS interactif embarquant le moteur local CyTask.

### Note de distribution

Les binaires Windows ne sont pas signés avec Authenticode. Contrôlez les empreintes SHA-256 publiées avant leur lancement.

[Non publié]: https://github.com/MrMybal/CyTask/compare/v0.2.3...main
[0.2.3]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.3
[0.2.2]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.2
[0.2.1]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.1
[0.2.0]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.0
[0.1.0]: https://github.com/MrMybal/CyTask/releases/tag/v0.1.0
