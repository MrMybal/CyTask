# Plugin CyAnnota

Ce dossier contient la copie CyTask du client Web CyAnnota. Le projet source
`D:\_Project\AiInterface_Project` n’est ni modifié ni requis au runtime.

La copie reprend uniquement l’éditeur image/vidéo et son moteur FFmpeg local. Elle
ajoute le pont `postMessage` compatible avec un iframe CyTask et se construit comme
une application Vite autonome sous `/plugins/cyannota/`.

```powershell
Push-Location plugins/cyannota/web
npm ci
npm run build
Pop-Location
```

Le Dockerfile de CyTask place automatiquement `dist` dans le répertoire statique du
serveur. En développement, `scripts/dev.ps1` lance le module sur le port 5174 et le
proxy Vite principal le rend disponible sous la même route.

Pour actualiser la copie depuis CyAnnota, recopier explicitement `app/page.tsx`,
`app/video-annotator.tsx`, `app/globals.css` et `scripts/sync-ffmpeg.mjs`, puis
réappliquer et tester le pont iframe. Ne jamais synchroniser automatiquement le
projet complet : ses applications desktop et CyCapture sont hors du plugin CyTask.