---
id: unreal-integration
title: Connecteur Unreal Engine
description: Connectez l'éditeur, associez assets et fichiers, puis examinez les recettes contrôlées.
section: Développement
parent: api-reference
order: 167
sourceRevision: 1
---

Le plugin source comporte les modules runtime `CyTaskCompat` et `CyTaskCore`, ainsi que les modules éditeur `CyTaskAssetRecipes` et `CyTaskEditor`. Utilisez une compilation adaptée au moteur et à la plateforme : un même binaire ne couvre pas toutes les versions Unreal. La cible de compatibilité est 4.27–5.8, sans garantie de validation de chaque version.

## Connecter l'éditeur {#connect-editor}

1. Copiez le plugin `CyTask` fourni dans le dossier `Plugins/CyTask` de votre projet Unreal.
2. Ouvrez le projet avec le moteur cible, compilez le plugin et activez-le si nécessaire.
3. Ouvrez **Window → CyTask**, indiquez l'URL HTTPS du serveur et autorisez l'accès dans le navigateur système.
4. Sélectionnez un projet. Activez le plugin Unreal Engine dans ce projet CyTask pour utiliser ses champs partagés.

La connexion utilise PKCE S256 et un retour sur l'interface locale, sans secret client embarqué. Le jeton opaque reste en mémoire ; la déconnexion demande sa révocation. Le panneau peut afficher vos tâches assignées et créer des tâches auto-assignées.

Capturez le contexte pour relever moteur, projet et map. Ajoutez les assets sélectionnés dans le Content Browser ou des fichiers sous la racine du projet. Les chemins de fichier restent relatifs. Chaque enregistrement crée une révision avec assets, fichiers, plateforme, build de revue et notes. En cas de conflit, rechargez au lieu d'écraser la modification d'un autre utilisateur.

## API C++ publique {#public-api}

Incluez `CyTaskApiClient.h` et ajoutez la dépendance `CyTaskCore`. `FCyTaskApiClient` utilise une propriété partagée ; ses méthodes réseau renvoient `void` et transmettent leur résultat par le callback fourni. Les résultats exposent `bSucceeded`, `StatusCode`, `Message` et les données de l'opération.

~~~cpp
bool SetServerUrl(const FString& Candidate, FString& OutError);
void CheckReady(FConnectionCallback Callback) const;
void ListProjects(FProjectsCallback Callback) const;
void ListTasks(const FString& ProjectId, FWorkItemsCallback Callback) const;
void GetUnrealTaskData(const FString& TaskId, FUnrealDataCallback Callback) const;
void GetUnrealTaskHistory(const FString& TaskId, FUnrealHistoryCallback Callback) const;
void UpdateUnrealTaskData(const FString& TaskId,
    const FCyTaskUnrealData& Data, int64 ExpectedRevision,
    FUnrealDataCallback Callback) const;
~~~

`ProjectId` et `TaskId` sont des UUID serveur sous forme de chaîne. `GetUnrealTaskData` renvoie `Data` et `Revision` ; transmettez cette révision à la mise à jour. `FCyTaskUnrealData` porte `EngineVersion`, `ProjectName`, `MapPath`, `AssetPaths`, `FilePaths`, `TargetPlatform`, `ReviewBuild` et `Notes`. L'historique ajoute `UpdatedBy` et `UpdatedAt`. Examinez les champs d'échec avant d'utiliser les données du résultat.

Par exemple, contrôlez la disponibilité après acceptation de l'URL :

~~~cpp
#include "CyTaskApiClient.h"
TSharedRef<FCyTaskApiClient> Client = MakeShared<FCyTaskApiClient>();
FString Error;
if (Client->SetServerUrl(ServerUrl, Error))
{
    Client->CheckReady([](const FCyTaskConnectionResult& Result)
    {
        // Afficher Result.Message si !Result.bSucceeded.
    });
}
~~~

Une opération authentifiée nécessite aussi le jeton d'accès valide défini par l'autorisation. Ne placez aucun jeton dans le texte des tâches ou les exemples. Les [contrats HTTP](doc:api-http) décrivent les règles d'accès et de révision du serveur.

## Recettes d'assets {#asset-recipes}

Incluez `CyTaskAssetRecipe.h` et ajoutez le module éditeur `CyTaskAssetRecipes`. `FCyTaskAssetRecipeParser::ParseAndValidate(Json, OutRecipe, OutValidation)` renvoie un booléen et les erreurs/chemins affectés. `Validate(Recipe)` renvoie `FCyTaskAssetRecipeValidation`.

Appelez d'abord `FCyTaskAssetRecipeExecutor::Preview(Recipe)`. Affichez les opérations et obtenez une confirmation explicite avant `ExecuteConfirmed(Recipe, bUserConfirmed)`. Les deux renvoient `FCyTaskAssetRecipeExecution` : réussite, état déjà appliqué, message et opérations.

La version 1 autorise seulement `create-folder`, `duplicate-asset` et `set-metadata`. Les chemins restent dans `/Game/...` ou `/Plugins/<Nom>/...` ; le contenu du plugin doit être monté. L'exécuteur vérifie d'abord les opérations sur le Game Thread et utilise Undo pour les objets, sans sauvegarde automatique des packages modifiés. Un dossier physique vide peut subsister après un échec ultérieur. L'idempotence de session n'est pas une transaction générale du système de fichiers. Les recettes ne lancent ni Python, ni Blueprint arbitraire, ni processus, ni commande système.
