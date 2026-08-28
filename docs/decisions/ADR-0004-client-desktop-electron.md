# ADR-0004 — Client desktop Electron multi-serveur

- Statut : accepté
- Date : 2026-08-28

## Décision

CyTask Desktop utilise Electron et charge l’application Web exposée par un serveur
choisi par l’utilisateur. Le sélecteur local conserve uniquement les profils de
serveur ; chaque origine distante s’exécute dans une fenêtre sandboxée sans Node ni
preload et possède une partition de session séparée.

CyAnnota reste une extension Web officielle servie par CyTask. Elle est rendue dans
la tâche et fonctionne donc sans implémentation spécifique supplémentaire dans le
shell desktop.

## Raisons

Le client Web possède déjà toutes les vues, le chat, les médias et les plugins.
Electron permet de réutiliser exactement cette interface sur Windows, Linux et macOS,
d’accorder explicitement les capacités natives WebRTC et de distribuer rapidement un
client connecté à une IP ou un domaine auto-hébergé.

## Conséquences

- une instance Production doit utiliser HTTPS et un certificat valide ;
- les URL HTTP nécessitent une confirmation visible et sont réservées au local ;
- aucune API Electron n’est exposée au contenu distant ;
- la sécurité dépend aussi des mises à jour régulières d’Electron et de Chromium ;
- les paquets sont produits séparément pour chaque plateforme et doivent être signés
  avant une distribution publique ;
- Android utilisera plus tard une PWA installable ou un shell mobile distinct.