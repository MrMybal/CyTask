---
id: encryption
title: Chiffrement optionnel au repos
section: Sécurité et exploitation
order: 19
sourceRevision: 1
---

CyTask peut chiffrer le contenu stocké avec AES-256-GCM. L’option est désactivée par défaut. Elle protège le stockage, pas un serveur en cours d’exécution compromis ; ce n’est pas du chiffrement de bout en bout.

## Espace local {#local-workspace}
Sur un nouvel espace, activez Chiffrer les données au repos dans le sélecteur desktop. Créez la clé hors de l’espace et du dossier synchronisé, puis sauvegardez-la séparément. Pour rouvrir ailleurs, choisissez la même clé transférée par une voie fiable.

Le desktop conserve son chemin, pas la clé dans le projet partagé. Une clé perdue rend les données irrécupérables ; changer le mot de passe du compte ne les récupère pas.

## Couverture et limites {#coverage-and-limits}
Manifestes, snapshots et conflits locaux sont chiffrés, ainsi que les médias stockés et leur quarantaine. Les champs de contenu du serveur persistant sont chiffrés, mais les métadonnées de routage PostgreSQL restent lisibles : identités, noms de projets et salons, relations, rôles, dates, tailles et autres champs structurels.

Téléchargements, exports, caches navigateur, journaux, mémoire virtuelle et anciennes sauvegardes sont hors de cette fonction. Serveur actif et utilisateurs autorisés déchiffrent le contenu. HTTPS et permissions restent indispensables.

## Données existantes : conversion hors ligne {#existing-data-offline-conversion}
Un simple bouton ne convertit pas un espace existant. Arrêtez tous les serveurs et appareils, mettez Sync en pause et vérifiez les sauvegardes complètes.

L’administrateur configure stockage d’origine, chiffrement et clé, applique les migrations nécessaires, puis lance :

~~~text
CyTask.Api --encrypt-storage --confirm-backup
~~~

C’est une maintenance, pas un démarrage normal. Suivez la procédure complète du dépôt pour les paramètres du moteur local et convertissez chaque appareil avec la même clé avant de reprendre Sync.

Ni retour automatique au clair, ni rotation de clé en ligne, ni effacement sûr des anciennes copies ne sont proposés. Voir [Sync et sauvegardes](doc:sync-backup) et [administration](doc:administration).
