# CyTask Desktop

Client Electron pour Windows, Linux et macOS. Il charge une instance CyTask distante ou lance un moteur local auto-contenu à partir d’un dossier. Il mémorise jusqu’à vingt espaces : domaines HTTPS, IP locales ou projets locaux compatibles Syncthing.

## Développement

```powershell
Push-Location apps/client
npm ci
npm run check
npm run dev
Pop-Location
```

Pour la démo serveur, utiliser `http://127.0.0.1:5173` et confirmer explicitement l’avertissement HTTP. Une instance d’équipe en Production doit être exposée en HTTPS.

## Mode local et Sync

Le sélecteur **Dossier local** lance le sidecar sur `127.0.0.1` et crée le manifeste, les snapshots et `.stignore` dans le dossier choisi. Le même dossier peut être ajouté à Syncthing ou transporté par le moteur CyRevision.

Construire seulement le site et le sidecar Windows courant :

```powershell
npm run server:win
```

## Distribution

```powershell
npm run dist:win
npm run dist:linux
npm run dist:mac
```

Les commandes construisent le site Web, publient le sidecar .NET auto-contenu pour la plateforme ciblée, puis l’intègrent aux ressources Electron. Les artefacts vont dans `apps/client/release` : portable et NSIS pour Windows, AppImage et DEB pour Linux, DMG et ZIP pour macOS. Chaque plateforme doit idéalement être construite et signée sur son système natif.

## Sécurité

- le sélecteur local utilise le protocole privé `cytask-client://` et une CSP stricte ;
- le contenu CyTask s’ouvre dans une fenêtre séparée sans preload ni API Node ;
- `nodeIntegration` et les WebView sont désactivés, l’isolation de contexte et le sandbox Chromium restent actifs ;
- les navigations et nouvelles fenêtres hors de l’origine approuvée sont envoyées au navigateur système ;
- chaque origine distante ou dossier local possède une partition persistante distincte pour ses cookies ;
- le sidecar local écoute uniquement sur `127.0.0.1`, sur un port libre ;
- caméra, microphone, notifications, plein écran et partage de la fenêtre CyTask ne sont accordés qu’à l’origine exacte ;
- les certificats TLS invalides ne sont jamais contournés ;
- `servers.json` contient uniquement les noms, URL ou chemins de dossiers, jamais les mots de passe ni les jetons ;
- l’identité de l’appareil reste hors du dossier synchronisé ;
- la fermeture laisse au snapshot périodique le temps de rendre la dernière mutation durable avant d’arrêter le sidecar.

Voir aussi [Mode local et synchronisation par dossier](../../docs/09-mode-local-sync.md).