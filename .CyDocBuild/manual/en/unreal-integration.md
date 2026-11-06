---
id: unreal-integration
title: Unreal Engine connector
description: Connect the editor, associate assets and files, and review controlled recipes.
section: Developers
parent: api-reference
order: 167
revision: 1
---

The source plugin has runtime modules `CyTaskCompat` and `CyTaskCore`, plus editor modules `CyTaskAssetRecipes` and `CyTaskEditor`. Use a build for your engine and platform; one binary cannot cover every Unreal version. The compatibility target is 4.27–5.8, not a guarantee that every version has been validated.

## Connect the editor {#connect-editor}

1. Copy the supplied `CyTask` plugin into your Unreal project's `Plugins/CyTask` folder.
2. Open the project in its target engine, compile the plugin and enable it if necessary.
3. Open **Window → CyTask**, enter the server's HTTPS URL and authorize access in the system browser.
4. Select a project. Enable the Unreal Engine plugin in that CyTask project to use its shared task fields.

Sign-in uses PKCE S256 with a loopback callback and no embedded client secret. The opaque bearer token remains in memory; signing out requests revocation. The panel can show your assigned tasks and create self-assigned tasks.

Capture context to record engine version, project and map. Add selected Content Browser assets or files beneath the project root. File paths are stored relatively. Saving creates a revision with assets, files, platform, review build and notes. On a conflict, reload instead of overwriting another user's update.

## Public C++ API {#public-api}

Include `CyTaskApiClient.h` and depend on `CyTaskCore`. `FCyTaskApiClient` is shared-owned; network methods return `void` and deliver their result through the supplied callback. Results expose `bSucceeded`, `StatusCode`, `Message` and the operation's data.

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

`ProjectId` and `TaskId` are server UUID strings. `GetUnrealTaskData` returns `Data` and `Revision`; pass that revision to the update. `FCyTaskUnrealData` carries `EngineVersion`, `ProjectName`, `MapPath`, `AssetPaths`, `FilePaths`, `TargetPlatform`, `ReviewBuild` and `Notes`. History entries also include `UpdatedBy` and `UpdatedAt`. Inspect failure fields before using result data.

For example, check readiness after accepting a URL:

~~~cpp
#include "CyTaskApiClient.h"
TSharedRef<FCyTaskApiClient> Client = MakeShared<FCyTaskApiClient>();
FString Error;
if (Client->SetServerUrl(ServerUrl, Error))
{
    Client->CheckReady([](const FCyTaskConnectionResult& Result)
    {
        // Display Result.Message when !Result.bSucceeded.
    });
}
~~~

An authenticated operation also requires a valid access token set by the authorization flow. Do not put a token in task text or code examples. The [HTTP contracts](doc:api-http) describe the server's access and revision rules.

## Asset recipes {#asset-recipes}

Include `CyTaskAssetRecipe.h` and depend on editor module `CyTaskAssetRecipes`. `FCyTaskAssetRecipeParser::ParseAndValidate(Json, OutRecipe, OutValidation)` returns a boolean and validation errors/affected paths. `Validate(Recipe)` returns `FCyTaskAssetRecipeValidation`.

Use `FCyTaskAssetRecipeExecutor::Preview(Recipe)` first. Display its operations and obtain explicit user confirmation before `ExecuteConfirmed(Recipe, bUserConfirmed)`. Both return `FCyTaskAssetRecipeExecution` with success, already-applied state, message and operations.

Version 1 permits only `create-folder`, `duplicate-asset` and `set-metadata`. Paths are confined to `/Game/...` or `/Plugins/<Name>/...`; plugin content must be mounted. The executor preflights on the Game Thread and uses Undo for objects, but never automatically saves modified packages. An empty physical directory can remain after a later failure. Session idempotency is not a general filesystem transaction. Recipes cannot run arbitrary Python, Blueprint, processes or shell commands.
