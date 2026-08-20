# ADR-0003 — Pile de la première tranche

- Statut : accepté
- Date : 2026-08-20

## Décision

- ASP.NET Core et .NET 10 LTS pour l'API et les workers ;
- Npgsql et PostgreSQL 18 pour la persistance ;
- React, TypeScript et Vite pour le client Web ;
- Server-Sent Events pour les notifications serveur vers client de la première tranche ;
- C++ natif pour le futur plugin Unreal ;
- shell installé à décider séparément après mesure de Tauri et des besoins médias.

## Raisons

.NET 10 fournit une période LTS adaptée au serveur, un runtime performant et des
primitives Web maintenues. PostgreSQL porte les transactions, contraintes et
requêtes nécessaires au monolithe modulaire. Le client reste léger et indépendant
d'une bibliothèque de composants. SSE couvre les invalidations actuelles avec un
protocole navigateur simple ; les commandes restent en HTTP.

## Conséquences

- le serveur cible `net10.0` et refuse les avertissements ;
- les dépendances sont verrouillées et auditées ;
- le mode mémoire ne représente jamais la production ;
- WebSocket pourra être ajouté pour présence bidirectionnelle ou collaboration fine ;
- le choix du shell desktop/mobile n'est pas implicitement figé par React.
