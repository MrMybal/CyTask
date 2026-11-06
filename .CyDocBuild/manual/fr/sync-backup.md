---
id: sync-backup
title: Sync, sauvegardes et restauration
order: 20
description: Synchronisez des appareils de confiance et restaurez une sauvegarde indépendante.
section: Démarrer
parent: desktop-local
sourceRevision: 2
---

Sync vise les appareils de confiance qui répliquent un dossier, par exemple via Syncthing ou un transport géré par CyRevision. Le format partagé de CyTask n’est pas une base serveur en cours d’exécution.

```diagram
{"type":"flow","title":"Appareil A · espace local → Transport Syncthing / CyRevision → Appareil B · espace local","nodes":[{"id":"n0","label":"Appareil A · espace local","x":20,"y":10,"width":400},{"id":"n1","label":"Transport Syncthing / CyRevision","x":20,"y":130,"width":400},{"id":"n2","label":"Appareil B · espace local","x":20,"y":250,"width":400}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"}]}
```

Les snapshots et médias voyagent avec le dossier. Sessions, jetons et clés restent propres à l’appareil.

## Configurer Sync {#set-up-sync}
1. Créez ou ouvrez l’espace en mode Sync.
2. Configurez l’outil externe pour répliquer sa racine.
3. Attendez la fin de la première synchronisation avant ouverture ailleurs.
4. Sur l’autre appareil, choisissez la racine répliquée dans le client desktop.
5. En cas de chiffrement, fournissez séparément la même clé, jamais dans le dossier synchronisé.

CyTask utilise des snapshots immuables et les médias pour ce fonctionnement. Sessions, clés d’accès locales et profils privés ne doivent pas être partagés comme identifiants. Choisir Sync n’installe ni ne configure automatiquement le logiciel externe.

## Modifications simultanées {#concurrent-changes}
Plusieurs appareils peuvent modifier hors connexion. Au retour du réseau, examinez les conflits signalés et vérifiez les données résultantes. Ne supprimez pas un fichier sync-conflict parce que son nom paraît temporaire ; conservez une copie récupérable jusqu’à compréhension du conflit.

Ne synchronisez pas un répertoire PostgreSQL ouvert ou une base active pour remplacer ce mode. Les personnes pouvant écrire dans le dossier partagé sont considérées de confiance.

## Sauvegarder reste nécessaire {#backup-is-different}
La synchronisation propage erreurs et suppressions. Conservez des sauvegardes versionnées, restaurables indépendamment, avec les clés de chiffrement séparées.

Pour restaurer, arrêtez les écritures et suspendez Sync partout. Restaurez d’abord ailleurs, vérifiez tâches et médias avec logiciel et clé adaptés, puis désignez la copie de référence avant reprise.

Voir [chiffrement](doc:encryption), [mode local](doc:desktop-local) et [dépannage](doc:troubleshooting).
## Exporter les données {#export-workspace-data}
Propriétaires et administrateurs peuvent ouvrir Équipe depuis Paramètres et
outils, puis Exporter l’espace. Un JSON versionné des données et membres est
téléchargé. Il sert à l’inspection ou à l’interopérabilité, mais ne remplace pas
une sauvegarde complète base, médias et clés. Conservez cet export comme une
donnée de projet, pas comme un exemple public, et vérifiez son contenu avant
de le transmettre à un autre outil.
