# ADR-0002 — Préparer la synchronisation sans répliquer la base

- Statut : accepté et implémenté pour le mode dossier local
- Date : 2026-08-20
- Mise en œuvre initiale : 2026-08-28

## Contexte

CyRevision doit fournir une variante décentralisée transportée par Syncthing. Synchroniser une base active ou des fichiers mutables provoquerait corruption, conflits opaques et contournement des autorisations.

## Décision

CyTask échange des snapshots JSON immuables, idempotents et vérifiés par SHA-256, accompagnés de blobs adressés par contenu. Chaque appareil possède son flux et les suppressions sont propagées par tombstones. La fusion privilégie les révisions de domaine et crée un enregistrement visible lorsqu’une égalité de révision possède deux contenus différents.

CyRevision pourra transporter ce même format avec son moteur Syncthing isolé. Une signature asymétrique reste prévue pour les échanges entre appareils qui ne partagent pas déjà le même périmètre de confiance.

## Conséquences

- aucune base active n’est placée dans Syncthing ;
- les écritures de deux appareils ne ciblent jamais le même fichier de snapshot ;
- les sessions et secrets restent locaux à l’appareil ;
- les conflits de domaine sont détectés par CyTask, pas délégués aux suffixes `sync-conflict` ;
- Syncthing et CyRevision restent des transports et n’accordent aucune autorisation CyTask.