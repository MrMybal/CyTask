---
id: encryption
title: Chiffrement optionnel au repos
order: 19
description: Protégez les contenus stockés et conservez les clés nécessaires à leur lecture.
section: Serveur
parent: administration
sourceRevision: 2
---

CyTask peut chiffrer le contenu stocké avec AES-256-GCM. L’option est désactivée par défaut. Elle protège le stockage, pas un serveur en cours d’exécution compromis ; ce n’est pas du chiffrement de bout en bout.

## Espace local {#local-workspace}
Sur un nouvel espace, activez Chiffrer les données au repos dans le sélecteur desktop. Créez la clé hors de l’espace et du dossier synchronisé, puis sauvegardez-la séparément. Pour rouvrir ailleurs, choisissez la même clé transférée par une voie fiable.

Le desktop conserve son chemin, pas la clé dans le projet partagé. Une clé perdue rend les données irrécupérables ; changer le mot de passe du compte ne les récupère pas.

## Couverture et limites {#coverage-and-limits}
Manifestes, snapshots et conflits locaux sont chiffrés, ainsi que les médias stockés et leur quarantaine. Les champs de contenu du serveur persistant sont chiffrés, mais les métadonnées de routage PostgreSQL restent lisibles : identités, noms de projets et salons, relations, rôles, dates, tailles et autres champs structurels.

Téléchargements, exports, caches navigateur, journaux, mémoire virtuelle et anciennes sauvegardes sont hors de cette fonction. Serveur actif et utilisateurs autorisés déchiffrent le contenu. HTTPS et permissions restent indispensables.

## Configuration du serveur {#server-configuration}
Pour un nouveau serveur, fournissez ces paramètres par le mécanisme de configuration protégé du déploiement :

~~~text
CyTask__DataEncryptionEnabled=true
CyTask__DataEncryptionKey=<encodage base64 de 32 octets aléatoires cryptographiquement sûrs>
~~~

Générez une nouvelle clé avec un générateur cryptographiquement sûr ; ne réutilisez pas la clé MFA ou des fournisseurs. Pour Compose, les noms sont `CYTASK_DATA_ENCRYPTION_ENABLED` et `CYTASK_DATA_ENCRYPTION_KEY`. La propriété `key` d'un fichier desktop `.cytask-key` contient la valeur base64 du moteur local. Ne stockez jamais de vraie clé dans le projet, le dossier synchronisé ou l'image de l'application. Le propriétaire du processus peut inspecter son environnement : utilisez un gestionnaire de secrets ou un environnement protégé adapté.

Les paramètres et `GET /api/v1/storage/security` indiquent si le chiffrement est actif, sans renvoyer la clé ni son chemin.

## Données existantes : conversion hors ligne {#existing-data-offline-conversion}
Un simple bouton ne convertit pas les données existantes. Cette opération relève de l'administrateur :

1. Arrêtez **tous** les processus serveur et desktop de CyTask. Mettez Sync en pause sur chaque appareil pour empêcher toute écriture pendant la conversion.
2. Sauvegardez intégralement la base ou l'espace, les médias et la clé séparément. Vérifiez la restauration des sauvegardes. Les anciennes copies restent non chiffrées.
3. Configurez la connexion et les chemins du stockage d'origine, activez le chiffrement et fournissez la clé prévue. Appliquez d'abord la migration 032, ou définissez `ApplyMigrations=true`. Pour un dossier local, fournissez aussi ses paramètres habituels `LocalMode`, `UseInMemoryStore`, `LocalWorkspacePath`, `LocalDeviceId`, `LocalAccessKey` et `MediaStoragePath`. Lancez le moteur une fois :

~~~text
CyTask.Api --encrypt-storage --confirm-backup
~~~

Vous pouvez aussi utiliser `dotnet CyTask.Api.dll --encrypt-storage --confirm-backup`. Cette commande de maintenance n'ouvre pas d'écoute HTTP et refuse une mauvaise clé ou une configuration invalide.

4. Attendez la réussite. La base est convertie dans une transaction ; les fichiers sont remplacés atomiquement, un par un. Après une interruption, relancez avec la **même clé et les mêmes arguments**. Ne reprenez pas l'utilisation ordinaire à mi-conversion.
5. Redémarrez avec le chiffrement actif. Contrôlez tâches, messages et médias. Convertissez chaque appareil hors ligne avec la **même clé** et utilisez les binaires actuels avant de reprendre Sync. Mélanger des appareils chiffrés et non chiffrés n'est pas pris en charge.

Prévoyez assez d'espace libre et de capacité pour la transaction et les journaux WAL. Restaurer une ancienne sauvegarde exige sa clé correspondante et peut nécessiter une nouvelle conversion. Modifier seulement la clé configurée rend le contenu existant illisible.

Ni retour automatique au clair, ni rotation de clé en ligne, ni effacement sûr des anciennes copies ne sont proposés. Voir [Sync et sauvegardes](doc:sync-backup) et [administration](doc:administration).
