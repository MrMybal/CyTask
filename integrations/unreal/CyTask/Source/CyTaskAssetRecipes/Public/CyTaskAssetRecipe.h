#pragma once

#include "CoreMinimal.h"

enum class ECyTaskAssetPreconditionKind : uint8
{
    AssetExists,
    AssetMissing
};

enum class ECyTaskAssetStepKind : uint8
{
    CreateFolder,
    DuplicateAsset,
    SetMetadata
};

struct CYTASKASSETRECIPES_API FCyTaskAssetPrecondition
{
    ECyTaskAssetPreconditionKind Kind = ECyTaskAssetPreconditionKind::AssetExists;
    FString Path;
};

struct CYTASKASSETRECIPES_API FCyTaskAssetStep
{
    ECyTaskAssetStepKind Kind = ECyTaskAssetStepKind::CreateFolder;
    FString Path;
    FString Source;
    FString Destination;
    FString Asset;
    FString Key;
    FString Value;
};

struct CYTASKASSETRECIPES_API FCyTaskAssetRecipe
{
    int32 SchemaVersion = 0;
    FGuid RecipeId;
    FGuid TaskId;
    int32 Revision = 0;
    FString IdempotencyKey;
    FString Title;
    FString MinimumEngine;
    FString MaximumEngine;
    TArray<FCyTaskAssetPrecondition> Preconditions;
    TArray<FCyTaskAssetStep> Steps;
};

struct CYTASKASSETRECIPES_API FCyTaskAssetRecipeValidation
{
    TArray<FString> Errors;
    TArray<FString> AffectedPaths;

    bool IsValid() const { return Errors.Num() == 0; }
};

class CYTASKASSETRECIPES_API FCyTaskAssetRecipeParser
{
public:
    static bool ParseAndValidate(
        const FString& Json,
        FCyTaskAssetRecipe& OutRecipe,
        FCyTaskAssetRecipeValidation& OutValidation);

    static FCyTaskAssetRecipeValidation Validate(const FCyTaskAssetRecipe& Recipe);
};

struct CYTASKASSETRECIPES_API FCyTaskAssetRecipeExecution
{
    bool bSucceeded = false;
    bool bWasAlreadyApplied = false;
    FString Message;
    TArray<FString> Operations;
};

class CYTASKASSETRECIPES_API FCyTaskAssetRecipeExecutor
{
public:
    static FCyTaskAssetRecipeExecution Preview(const FCyTaskAssetRecipe& Recipe);

    // L'appelant doit afficher l'aperçu et recueillir une confirmation explicite.
    // Les packages modifiés restent non sauvegardés afin que l'utilisateur garde le contrôle.
    static FCyTaskAssetRecipeExecution ExecuteConfirmed(
        const FCyTaskAssetRecipe& Recipe,
        bool bUserConfirmed);
};
