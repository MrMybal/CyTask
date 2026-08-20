# Intégration Unreal Engine

Le plugin source se trouve dans `CyTask/`. Il vise Unreal Engine 4.27 à 5.8 ;
chaque version et plateforme doit produire son propre artefact, car un même binaire
ne peut pas être partagé entre ces moteurs.

## État actuel

| Module | Type | Responsabilité actuelle |
| --- | --- | --- |
| `CyTaskCompat` | Runtime | macros et détection de version 4.27–5.8 |
| `CyTaskCore` | Runtime | URL sûre, OAuth natif PKCE, Bearer en mémoire et API projets/tâches |
| `CyTaskAssetRecipes` | Editor | parsing strict, aperçu et exécution confirmée des recettes v1 |
| `CyTaskEditor` | Editor | onglet Slate et entrée dans le menu Window |

Le panneau vérifie la disponibilité d'un serveur HTTPS, ouvre l'autorisation dans
le navigateur système, reçoit le callback sur `127.0.0.1` avec un port dynamique,
échange le code avec PKCE `S256`, puis affiche les projets et tâches du compte.
Aucun mot de passe ou secret client n'est embarqué. Le Bearer opaque reste en
mémoire, est écrasé à la fermeture et le bouton de déconnexion demande aussi sa
révocation au serveur.

## Installation dans un projet

1. Copier le dossier `CyTask` dans `<Projet>/Plugins/CyTask`.
2. Ouvrir le projet avec la version Unreal cible et accepter la compilation.
3. Activer **CyTask** dans Plugins si nécessaire, puis redémarrer l'éditeur.
4. Ouvrir **Window > CyTask**.

Le descripteur n'indique volontairement pas un unique `EngineVersion` : la
compatibilité est vérifiée au build et les paquets distribués seront nommés par
version et plateforme.

## Recettes d'assets

Le contrat canonique est
`../../packages/contracts/unreal-asset-recipe.schema.json`. Le plugin applique en
plus des contrôles défensifs :

- schéma v1 et champs inconnus refusés ;
- seulement `create-folder`, `duplicate-asset` et `set-metadata` ;
- chemins confinés à `/Game/...` ou `/Plugins/<Nom>/...`, sans traversée ;
- préflight complet sur le Game Thread avant toute modification ;
- confirmation explicite imposée par l'API d'exécution ;
- transaction Undo pour les objets et idempotence pendant la session éditeur ;
- aucune sauvegarde automatique des packages modifiés ;
- aucun Python, Blueprint arbitraire, processus ou commande système.

Le préfixe de contrat `/Plugins/MonPlugin/...` est traduit vers le point de montage
Unreal `/MonPlugin/...`. Le plugin cible doit donc être activé et posséder du contenu
monté. Un dossier physique vide créé par une recette peut subsister si une étape
ultérieure échoue ; cette limite est signalée et empêche de présenter l'opération
comme une transaction de système de fichiers parfaite.

## Construction et tests

Exemple Windows avec une installation Unreal donnée :

```powershell
& '<UE>/Engine/Build/BatchFiles/RunUAT.bat' BuildPlugin `
  '-Plugin=<repo>/integrations/unreal/CyTask/CyTask.uplugin' `
  '-Package=<sortie>/CyTask' `
  -TargetPlatforms=Win64 `
  -Rocket
```

Les tests Automation sont regroupés sous `CyTask` : validation de recette, refus
d'exécution sans confirmation, politique d'URL serveur et PKCE `S256` avec le
vecteur de référence RFC 7636. Ils se lancent avec :

```powershell
& '<UE>/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' '<hote>.uproject' `
  -unattended -nop4 -nosplash -NullRHI `
  '-ExecCmds=Automation RunTests CyTask;Quit' `
  '-TestExit=Automation Test Queue Empty'
```

Matrice vérifiée localement sur Win64 :

| Version | Compilation | Tests Automation | Note |
| --- | --- | --- | --- |
| 4.27 | unités CyTask atteintes | non exécutés | installation locale incomplète : bibliothèques Core du moteur absentes |
| 5.2 | Editor, Development, Shipping | 4/4 réussis | ancienne API `UMetaData`, PKCE et panneau de tâches couverts |
| 5.8 | Editor, Development, Shipping | 4/4 réussis | nouvelle API `FMetaData`, PKCE et panneau de tâches couverts |

La CI de publication devra encore compiler 4.27 sur une installation saine, puis
5.0, une version 5.x médiane et 5.8 avant de déclarer la matrice complète.
