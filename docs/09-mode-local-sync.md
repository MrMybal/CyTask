# Mode local et synchronisation par dossier

CyTask Desktop peut ouvrir un dossier comme un espace autonome, sans PostgreSQL ni serveur à administrer. Le client lance alors un sidecar CyTask auto-contenu sur une adresse aléatoire de `127.0.0.1`. L’interface Web, l’API et les médias restent les mêmes qu’en mode serveur.

## Utilisation

1. Ouvrir **CyTask Desktop**.
2. Choisir **Dossier local**, puis sélectionner ou créer le dossier du projet.
3. Créer le premier compte lors de la première ouverture.
4. Pour partager les données, ajouter ce dossier à Syncthing en mode `sendreceive` sur chaque appareil.
5. Ouvrir le même dossier synchronisé depuis CyTask Desktop sur les autres appareils et utiliser le même compte.

Le bouton **Local · Synchronisé** dans la barre latérale force une sauvegarde. Son infobulle indique le nombre d’appareils, de snapshots et de conflits détectés.

## Format du dossier

```text
mon-projet/
├─ .stignore
└─ .cytask/
   ├─ workspace.json
   ├─ exchange/
   │  ├─ snapshots/<device-id>/<sequence>-<sha256>.json
   │  └─ conflicts/<conflict-id>.json
   └─ media/
      ├─ objects/
      ├─ uploads/       # local, ignoré par Syncthing
      └─ quarantine/    # local, ignoré par Syncthing
```

Les snapshots sont complets, immuables, idempotents et vérifiés par SHA-256. Chaque appareil écrit uniquement dans son propre sous-dossier. CyTask ne synchronise jamais une base SQLite/PostgreSQL ouverte.

Les entités avec révision utilisent la révision la plus haute. À révision identique mais contenu différent, CyTask conserve un résultat déterministe et écrit un conflit consultable. Les collections immuables sont fusionnées par identifiant. Des tombstones propagent les suppressions de dossiers/labels, affectations, liens parent-enfant, dépendances, checklists et activations de plugins. Une collision de numéros de tâches concurrentes est signalée sans supprimer aucune tâche.

Les cinquante derniers snapshots de chaque appareil sont conservés. Les médias validés sont adressés par contenu et peuvent être transportés avec le dossier.

## Sécurité

- le sidecar écoute uniquement sur `127.0.0.1` et choisit un port libre ;
- les sessions, codes OAuth, jetons natifs/API, uploads actifs et secrets AI restent sur la machine ;
- les vérificateurs de mots de passe et les données métier sont présents dans les snapshots afin que le compte fonctionne sur les autres appareils : le dossier synchronisé doit donc être protégé par les permissions du système, le chiffrement du disque et des appareils Syncthing approuvés ;
- `.stignore` exclut le runtime, la quarantaine, les uploads incomplets et les fichiers temporaires sans remplacer les règles ajoutées par l’utilisateur ;
- une altération ou un snapshot tronqué est ignoré grâce à son empreinte ; Syncthing reste un transport et n’accorde aucun droit CyTask.

## Relation avec CyRevision

Le format ne dépend pas du binaire Syncthing. Le moteur `ManagedSyncthingEngine` de CyRevision peut donc transporter le même dossier en conservant ses principes : runtime isolé par projet, API Syncthing limitée au loopback, profils `sendreceive`/`sendonly`/`receiveonly`, détection des conflits et runtime embarqué, géré, `PATH` ou personnalisé.

Une future interface **CyTask Sync** pourra réutiliser ce moteur comme plugin ou sidecar dédié pour configurer les appareils, invitations et dossiers depuis CyTask. Cette première version prépare déjà le dossier et reste compatible avec un Syncthing installé séparément. Aucun fichier du projet CyRevision n’est modifié par cette intégration.