# Mode local et synchronisation par dossier

CyTask Desktop peut ouvrir un dossier comme un espace autonome, sans PostgreSQL ni serveur à administrer. Le client lance alors un sidecar CyTask auto-contenu sur une adresse aléatoire de `127.0.0.1`. L’interface Web, l’API et les médias restent les mêmes qu’en mode serveur.

## Utilisation

1. Ouvrir **CyTask Desktop**.
2. Choisir **Dossier local**, puis sélectionner ou créer le dossier du projet.
3. CyTask ouvre automatiquement l’identité propriétaire locale : aucun compte ni mot de passe n’est demandé.
4. Pour partager les données, ajouter ce dossier à Syncthing en mode `sendreceive` sur chaque appareil.
5. Ouvrir le même dossier synchronisé depuis CyTask Desktop sur les autres appareils. Chaque client recrée uniquement sa session locale et retrouve le même espace.

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

Les snapshots sont écrits uniquement quand les données changent. Les checkpoints déjà lus sont mis en cache et les gros fichiers sont traités en flux. CyTask conserve jusqu’à cinquante snapshots par appareil, dans un budget de 256 Mio avec au moins deux checkpoints pour les gros espaces. Un snapshot dépassant la limite prise en charge de 1 Gio provoque une erreur explicite plutôt qu’un retour silencieux à un ancien état.

Les annotations CyAnnota font partie des snapshots. Les images et vidéos ajoutées au canvas sont enregistrées dans la bibliothèque de fichiers de l’espace ; enregistrer le canvas partage aussi leurs références. Les anciens médias encore présents dans le cache du navigateur sont migrés vers cette bibliothèque à l’ouverture du canvas.

La fermeture du client attend une confirmation de sauvegarde du moteur local avant de l’arrêter.

## Sécurité

- le sidecar écoute uniquement sur `127.0.0.1` et choisit un port libre ;
- le client desktop génère à chaque lancement une clé d’ouverture éphémère transmise uniquement au sidecar ;
- les sessions, codes OAuth, jetons natifs/API, uploads actifs et secrets AI restent sur la machine ; seules les empreintes nécessaires à la reprise locale des jetons sont conservées dans le profil de l’appareil ;
- les identités et les données métier sont présentes dans les snapshots : le dossier synchronisé doit donc être protégé par les permissions du système, le chiffrement du disque et des appareils Syncthing approuvés ;
- `.stignore` exclut le runtime, la quarantaine, les uploads incomplets et les fichiers temporaires sans remplacer les règles ajoutées par l’utilisateur ;
- une altération ou un snapshot tronqué est ignoré grâce à son empreinte ; Syncthing reste un transport et n’accorde aucun droit CyTask.

## Relation avec CyRevision

Le format ne dépend pas du binaire Syncthing. Le moteur `ManagedSyncthingEngine` de CyRevision peut donc transporter le même dossier en conservant ses principes : runtime isolé par projet, API Syncthing limitée au loopback, profils `sendreceive`/`sendonly`/`receiveonly`, détection des conflits et runtime embarqué, géré, `PATH` ou personnalisé.

Une future interface **CyTask Sync** pourra réutiliser ce moteur comme plugin ou sidecar dédié pour configurer les appareils, invitations et dossiers depuis CyTask. Cette première version prépare déjà le dossier et reste compatible avec un Syncthing installé séparément. Aucun fichier du projet CyRevision n’est modifié par cette intégration.
