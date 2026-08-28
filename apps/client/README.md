# CyTask Desktop

Client Electron pour Windows, Linux et macOS. Il charge l’interface Web servie par
une instance CyTask et permet de mémoriser jusqu’à vingt adresses : domaine HTTPS,
IP locale ou port de développement.

## Développement

```powershell
Push-Location apps/client
npm ci
npm run check
npm run dev
Pop-Location
```

Pour la démo locale, utiliser `http://127.0.0.1:5173` et confirmer explicitement
l’avertissement HTTP. Une instance d’équipe en Production doit être exposée en HTTPS.

## Distribution

```powershell
npm run dist:win
npm run dist:linux
npm run dist:mac
```

Les artefacts vont dans `apps/client/release`. Les formats configurés sont portable
et NSIS pour Windows, AppImage et DEB pour Linux, DMG et ZIP pour macOS. Chaque
plateforme doit idéalement être construite et signée sur son système natif.

## Sécurité

- le sélecteur local utilise le protocole privé `cytask-client://` et une CSP stricte ;
- le contenu serveur s’ouvre dans une fenêtre séparée sans preload ni API Node ;
- `nodeIntegration` et les WebView sont désactivés, l’isolation de contexte et le
  sandbox Chromium restent actifs ;
- les navigations et nouvelles fenêtres hors du serveur sont envoyées au navigateur
  système ;
- chaque origine possède une partition persistante distincte pour ses cookies ;
- caméra, microphone, notifications, plein écran et partage de la fenêtre CyTask ne
  sont accordés qu’à l’origine exacte du serveur ;
- les certificats TLS invalides ne sont jamais contournés ;
- le fichier local `servers.json` ne contient que les noms et URL, jamais les mots de
  passe ni les jetons.

CyAnnota fonctionne dans le desktop parce qu’il est servi par CyTask et rendu dans
l’onglet de tâche, comme dans un navigateur normal.