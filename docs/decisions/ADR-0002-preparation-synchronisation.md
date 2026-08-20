# ADR-0002 — Préparer la synchronisation sans répliquer la base

- Statut : proposé
- Date : 2026-08-20

## Contexte

CyRevision doit plus tard fournir une variante décentralisée transportée par
Syncthing. Synchroniser une base active ou des fichiers mutables provoquerait
corruption, conflits opaques et contournement des autorisations.

## Décision

Les objets publics reçoivent un UUIDv7 et une révision. Les mutations produisent
des événements d'outbox. CyRevision échangera des paquets immuables, idempotents et
signés, accompagnés de blobs adressés par contenu.

## Conséquences

- le modèle centralisé reste simple ;
- les opérations futures disposent d'identités stables ;
- les conflits doivent être définis par domaine avant le mode décentralisé ;
- Syncthing reste un transport et n'accorde aucune autorisation.

