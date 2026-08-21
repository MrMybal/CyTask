# CyTask

CyTask est un gestionnaire de projets et de tâches open source, auto-hébergeable,
conçu pour les équipes de production numérique et les projets Unreal Engine.

Le produit doit fonctionner avec ou sans dépôt Git. Git, Unreal Engine, les
traitements médias et, plus tard, CyRevision sont des intégrations autour d'un
cœur qui reste utilisable seul.

## Objectifs

- application Web rapide et installable, puis clients Windows, Linux, macOS et Android ;
- serveur d'équipe auto-hébergeable avec une sécurité vérifiable ;
- tâches, projets, commentaires, dépendances, pièces jointes et temps réel ;
- images et vidéos avec conversion locale optionnelle et traitement serveur ;
- commits, branches et demandes de fusion reliés aux tâches via un plugin Git ;
- panneau CyTask dans Unreal Engine 4.27 à 5.8 ;
- recettes d'assets contrôlées, prévisualisables et exécutables depuis Unreal ;
- extensions signées et limitées par permissions ;
- fondations compatibles avec un futur mode décentralisé CyRevision/Syncthing.

## État du dépôt

La première tranche verticale est implémentée : amorçage sécurisé du premier
compte, sessions, invitations à usage unique, rôles, organisation, projets,
tâches éditables avec contrôle de révision, commentaires et événements temps réel.
La recherche, le journal d’activité et l’export JSON sont également disponibles.
Le pipeline de pièces jointes calcule les empreintes côté client, envoie les données
par blocs vérifiés et conserve les originaux en quarantaine hors du Web. Un worker
d'analyse en sort chaque fichier : il parcourt réellement le conteneur PNG, JPEG,
GIF, WebP, MP4 ou WebM, refuse les fichiers tronqués ou dont le contenu ne
correspond pas au type annoncé, puis rend le fichier téléchargeable dans la seule
organisation qui l'a déposé. Le réencodage et l'analyse antivirale restent à faire.
Les tâches peuvent aussi recevoir des références Git manuelles génériques ; aucun
dépôt ni secret n'est requis tant que le connecteur Git officiel n'est pas activé.
Le premier plugin Unreal source est également présent : panneau Slate, connexion
PKCE dans le navigateur système, consultation des projets et tâches, révocation du
jeton, validateur strict et exécuteur confirmé de recettes d'assets. Le flux natif
utilise un code unique et un jeton Bearer opaque révocable réservé au client
`cytask-unreal` ; le jeton reste uniquement en mémoire dans l'éditeur.
Il compile sur UE 5.2 et 5.8 ; la validation 4.27 reste à répéter sur une installation
du moteur complète.
Le client Web responsive et installable consomme la même API que les futurs
clients et le plugin Unreal. Son interface de tâches propose maintenant vues
Liste et Kanban, priorités, échéances, assignation aux membres, filtres et tris mémorisés localement,
vignettes et téléchargement des fichiers validés, motif affiché pour les fichiers refusés,
palette de commandes `Ctrl/⌘ + K`, ajout rapide d'une tâche en une ligne, préchargement du détail
au survol et notifications non bloquantes,
déplacement optimiste avec contrôle de révision, détail en onglets et liens directs
partageables. Les tâches peuvent aussi exprimer des dépendances acycliques et les
tâches qu'elles bloquent. PostgreSQL est la persistance cible ; un stockage
mémoire explicite est disponible pour les tests et le développement rapide.

## Démarrage rapide

Avec Node.js 22 et le SDK local `.tools/dotnet` déjà installé :

```powershell
./scripts/dev.ps1
```

Ouvrir ensuite `http://127.0.0.1:5173`. Ce mode perd ses données au redémarrage.
Pour PostgreSQL et le déploiement conteneurisé, voir [infra/README.md](infra/README.md).

Pour remplir le serveur local avec le projet fictif **Nebula Station**, lancer dans
un second terminal pendant que le mode développement fonctionne :

```powershell
pwsh ./scripts/seed-demo.ps1
```

Le script crée une équipe, treize tâches réalistes, des échéances, commentaires,
références Git et dépendances. Les identifiants de démonstration sont affichés à
la fin de son exécution.

L'API est utilisable par des plugins et des scripts sans passer par le flux Unreal :
un jeton personnel `cytask_pat_…` se crée depuis la section **API** du client Web,
avec une portée lecture ou lecture/écriture, une expiration optionnelle et une
révocation immédiate. Le contrat complet est servi par `/api/v1/openapi.json`.

```bash
curl -H "Authorization: Bearer cytask_pat_…" http://127.0.0.1:5080/api/v1/projects
```

## Documentation

- [Vision et périmètre](docs/01-vision-produit.md)
- [Architecture](docs/02-architecture.md)
- [Sécurité](docs/03-securite.md)
- [Feuille de route](docs/04-feuille-de-route.md)
- [Guide de développement](docs/05-developpement.md)
- [Interface des tâches](docs/06-interface-taches.md)
- [API pour plugins et intégrations](docs/07-api-plugins.md)
- [Décisions d'architecture](docs/decisions)
- [Contrats de plugins](packages/contracts)
- [Plugin Unreal](integrations/unreal/README.md)

## Organisation prévue

```text
apps/                  serveur, Web et clients
integrations/unreal/   plugin Unreal et couches de compatibilité
packages/              contrats et SDK partagés
plugins/               plugins officiels, dont Git
infra/                 déploiement local et production
docs/                  produit, architecture, sécurité et décisions
```

## Vérifications

```powershell
./.tools/dotnet/dotnet test CyTask.slnx
Push-Location apps/web; npm run build; Pop-Location
```

Les commandes de construction et de tests Unreal sont documentées dans
[`integrations/unreal/README.md`](integrations/unreal/README.md).

## Licence

CyTask a vocation à être open source. La licence doit être choisie explicitement
avant d'accepter des contributions : AGPL-3.0 si les dérivés hébergés doivent
rester ouverts, ou Apache-2.0 si l'adoption la plus large est prioritaire.
