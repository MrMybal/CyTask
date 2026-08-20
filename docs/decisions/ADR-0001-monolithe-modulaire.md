# ADR-0001 — Monolithe modulaire et workers

- Statut : proposé
- Date : 2026-08-20

## Contexte

CyTask demande temps réel, médias, Git, plugins et plusieurs clients, mais doit
rester simple à auto-héberger et à sécuriser par une petite équipe.

## Décision

Le cœur est livré comme un monolithe modulaire. Les traitements lourds ou exposés à
des entrées hostiles s'exécutent dans des workers séparés. Les modules communiquent
par interfaces internes et événements d'outbox versionnés.

## Conséquences

- installation, transactions, traces et sauvegardes plus simples ;
- moins de services et de secrets exposés ;
- discipline nécessaire pour empêcher les accès directs entre modèles de modules ;
- extraction future possible pour les médias ou connecteurs sous charge mesurée.

