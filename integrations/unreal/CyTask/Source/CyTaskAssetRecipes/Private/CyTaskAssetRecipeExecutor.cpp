#include "CyTaskAssetRecipe.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetToolsModule.h"
#include "CyTaskVersionCompat.h"
#include "HAL/FileManager.h"
#include "Misc/PackageName.h"
#include "Misc/ScopeLock.h"
#include "Modules/ModuleManager.h"
#include "ScopedTransaction.h"
#include "UObject/MetaData.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"

#define LOCTEXT_NAMESPACE "CyTaskAssetRecipeExecutor"

namespace
{
    FCriticalSection AppliedKeysLock;
    TSet<FString> AppliedKeys;

    FString ResolveLongPackageName(const FString& ContractPath)
    {
        static const FString PluginPrefix(TEXT("/Plugins/"));
        if (!ContractPath.StartsWith(PluginPrefix))
        {
            return ContractPath;
        }

        const FString Relative = ContractPath.Mid(PluginPrefix.Len());
        return TEXT("/") + Relative;
    }

    FString MakeObjectPath(const FString& ContractPath)
    {
        const FString LongPackageName = ResolveLongPackageName(ContractPath);
        return LongPackageName + TEXT(".") + FPackageName::GetShortName(*LongPackageName);
    }

    UObject* LoadAsset(const FString& ContractPath)
    {
        return StaticLoadObject(UObject::StaticClass(), nullptr, *MakeObjectPath(ContractPath));
    }

    bool AssetExists(const FString& ContractPath)
    {
        return FPackageName::DoesPackageExist(ResolveLongPackageName(ContractPath));
    }

    void Fail(FCyTaskAssetRecipeExecution& Result, const FString& Message)
    {
        Result.bSucceeded = false;
        Result.Message = Message;
    }

    bool Preflight(
        const FCyTaskAssetRecipe& Recipe,
        FCyTaskAssetRecipeExecution& Result,
        bool bIncludeOperations)
    {
        const FCyTaskAssetRecipeValidation Validation = FCyTaskAssetRecipeParser::Validate(Recipe);
        if (!Validation.IsValid())
        {
            Fail(Result, FString::Join(Validation.Errors, TEXT("\n")));
            return false;
        }
        if (!GIsEditor || !IsInGameThread())
        {
            Fail(Result, TEXT("Une recette ne peut être exécutée que dans l'éditeur, sur le Game Thread."));
            return false;
        }

        for (const FCyTaskAssetPrecondition& Precondition : Recipe.Preconditions)
        {
            const bool bExists = AssetExists(Precondition.Path);
            if (Precondition.Kind == ECyTaskAssetPreconditionKind::AssetExists && !bExists)
            {
                Fail(Result, TEXT("Précondition non satisfaite : asset absent ") + Precondition.Path);
                return false;
            }
            if (Precondition.Kind == ECyTaskAssetPreconditionKind::AssetMissing && bExists)
            {
                Fail(Result, TEXT("Précondition non satisfaite : asset déjà présent ") + Precondition.Path);
                return false;
            }
        }

        for (const FCyTaskAssetStep& Step : Recipe.Steps)
        {
            switch (Step.Kind)
            {
            case ECyTaskAssetStepKind::CreateFolder:
            {
                FString FolderOnDisk;
                if (!FPackageName::TryConvertLongPackageNameToFilename(
                    ResolveLongPackageName(Step.Path), FolderOnDisk))
                {
                    Fail(Result, TEXT("Le point de montage Unreal n'existe pas : ") + Step.Path);
                    return false;
                }
                if (bIncludeOperations)
                {
                    Result.Operations.Add(TEXT("Créer le dossier ") + Step.Path);
                }
                break;
            }
            case ECyTaskAssetStepKind::DuplicateAsset:
                if (!AssetExists(Step.Source) || LoadAsset(Step.Source) == nullptr)
                {
                    Fail(Result, TEXT("Asset source introuvable : ") + Step.Source);
                    return false;
                }
                if (AssetExists(Step.Destination))
                {
                    Fail(Result, TEXT("La destination existe déjà : ") + Step.Destination);
                    return false;
                }
                if (bIncludeOperations)
                {
                    Result.Operations.Add(
                        TEXT("Dupliquer ") + Step.Source + TEXT(" vers ") + Step.Destination);
                }
                break;
            case ECyTaskAssetStepKind::SetMetadata:
                if (!AssetExists(Step.Asset) || LoadAsset(Step.Asset) == nullptr)
                {
                    Fail(Result, TEXT("Asset à annoter introuvable : ") + Step.Asset);
                    return false;
                }
                if (bIncludeOperations)
                {
                    Result.Operations.Add(
                        TEXT("Définir ") + Step.Key + TEXT(" sur ") + Step.Asset);
                }
                break;
            }
        }
        return true;
    }

    bool ApplyStep(const FCyTaskAssetStep& Step, FString& OutError)
    {
        switch (Step.Kind)
        {
        case ECyTaskAssetStepKind::CreateFolder:
        {
            const FString LongPackagePath = ResolveLongPackageName(Step.Path);
            FString FolderOnDisk;
            if (!FPackageName::TryConvertLongPackageNameToFilename(LongPackagePath, FolderOnDisk)
                || !IFileManager::Get().MakeDirectory(*FolderOnDisk, true))
            {
                OutError = TEXT("Impossible de créer le dossier : ") + Step.Path;
                return false;
            }

            FAssetRegistryModule& RegistryModule =
                FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
            RegistryModule.Get().ScanPathsSynchronous({ LongPackagePath }, true);
            return true;
        }
        case ECyTaskAssetStepKind::DuplicateAsset:
        {
            UObject* Source = LoadAsset(Step.Source);
            const FString Destination = ResolveLongPackageName(Step.Destination);
            const FString DestinationPath = FPackageName::GetLongPackagePath(Destination);
            const FString DestinationName = FPackageName::GetShortName(*Destination);
            IAssetTools& AssetTools =
                FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools")).Get();
            UObject* Duplicate = AssetTools.DuplicateAsset(DestinationName, DestinationPath, Source);
            if (Duplicate == nullptr)
            {
                OutError = TEXT("Échec de la duplication vers : ") + Step.Destination;
                return false;
            }
            return true;
        }
        case ECyTaskAssetStepKind::SetMetadata:
        {
            UObject* Asset = LoadAsset(Step.Asset);
            if (Asset == nullptr)
            {
                OutError = TEXT("Asset à annoter introuvable : ") + Step.Asset;
                return false;
            }

            Asset->Modify();
            UPackage* Package = Asset->GetOutermost();
            Package->Modify();
#if CYTASK_UE_VERSION_AT_LEAST(5, 6)
            FMetaData& MetaData = Package->GetMetaData();
            MetaData.SetValue(Asset, *Step.Key, *Step.Value);
#else
            UMetaData* MetaData = Package->GetMetaData();
            MetaData->SetValue(Asset, *Step.Key, *Step.Value);
#endif
            Package->MarkPackageDirty();
            return true;
        }
        }

        OutError = TEXT("Action de recette non prise en charge.");
        return false;
    }
}

FCyTaskAssetRecipeExecution FCyTaskAssetRecipeExecutor::Preview(const FCyTaskAssetRecipe& Recipe)
{
    FCyTaskAssetRecipeExecution Result;
    if (!Preflight(Recipe, Result, true))
    {
        return Result;
    }

    Result.bSucceeded = true;
    Result.Message = TEXT("Aperçu prêt. Aucune modification n'a été effectuée.");
    return Result;
}

FCyTaskAssetRecipeExecution FCyTaskAssetRecipeExecutor::ExecuteConfirmed(
    const FCyTaskAssetRecipe& Recipe,
    bool bUserConfirmed)
{
    FCyTaskAssetRecipeExecution Result;
    if (!bUserConfirmed)
    {
        Fail(Result, TEXT("Confirmation utilisateur requise."));
        return Result;
    }

    {
        FScopeLock Lock(&AppliedKeysLock);
        if (AppliedKeys.Contains(Recipe.IdempotencyKey))
        {
            Result.bSucceeded = true;
            Result.bWasAlreadyApplied = true;
            Result.Message = TEXT("Cette recette a déjà été appliquée pendant cette session éditeur.");
            return Result;
        }
    }

    if (!Preflight(Recipe, Result, true))
    {
        return Result;
    }

    FScopedTransaction Transaction(LOCTEXT("ApplyRecipe", "Appliquer une recette CyTask"));
    for (const FCyTaskAssetStep& Step : Recipe.Steps)
    {
        FString Error;
        if (!ApplyStep(Step, Error))
        {
            Transaction.Cancel();
            Fail(Result, Error);
            return Result;
        }
    }

    {
        FScopeLock Lock(&AppliedKeysLock);
        AppliedKeys.Add(Recipe.IdempotencyKey);
    }
    Result.bSucceeded = true;
    Result.Message = TEXT("Recette appliquée. Les packages modifiés restent à sauvegarder manuellement.");
    return Result;
}

#undef LOCTEXT_NAMESPACE
