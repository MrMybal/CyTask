# Client Web CyTask

Client React/TypeScript responsive de la première tranche verticale.

## Développement

Lancer le serveur sur `http://127.0.0.1:5080`, puis :

```powershell
npm install
npm run dev
```

Vite relaie `/api` et `/health` vers le serveur ; cookies et protection CSRF restent
donc dans une origine cohérente pour le navigateur.
