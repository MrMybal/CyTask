#include "CyTaskAssetRecipe.h"

#include "CyTaskVersionCompat.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
    void AddError(FCyTaskAssetRecipeValidation& Validation, const FString& Message)
    {
        Validation.Errors.AddUnique(Message);
    }

    bool HasOnlyFields(
        const TSharedPtr<FJsonObject>& Object,
        const TArray<FString>& Allowed,
        const FString& Context,
        FCyTaskAssetRecipeValidation& Validation)
    {
        if (!Object.IsValid())
        {
            AddError(Validation, Context + TEXT(" doit être un objet."));
            return false;
        }

        bool bValid = true;
        for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : Object->Values)
        {
            if (!Allowed.Contains(Pair.Key))
            {
                AddError(Validation, FString::Printf(
                    TEXT("Champ inconnu '%s' dans %s."), *Pair.Key, *Context));
                bValid = false;
            }
        }
        return bValid;
    }

    bool TryGetRequiredString(
        const TSharedPtr<FJsonObject>& Object,
        const TCHAR* Field,
        FString& OutValue,
        FCyTaskAssetRecipeValidation& Validation)
    {
        if (!Object.IsValid() || !Object->TryGetStringField(Field, OutValue))
        {
            AddError(Validation, FString::Printf(TEXT("Le champ '%s' est obligatoire."), Field));
            return false;
        }
        return true;
    }

    bool ParseEngineVersion(const FString& Value, int32& OutEncoded)
    {
        if (Value == TEXT("4.27"))
        {
            OutEncoded = CYTASK_UE_VERSION_ENCODE(4, 27);
            return true;
        }
        if (Value.Len() != 3 || Value[0] != TEXT('5') || Value[1] != TEXT('.')
            || Value[2] < TEXT('0') || Value[2] > TEXT('8'))
        {
            return false;
        }

        FString MajorText;
        FString MinorText;
        if (!Value.Split(TEXT("."), &MajorText, &MinorText)
            || MajorText.IsEmpty()
            || MinorText.IsEmpty()
            || !MajorText.IsNumeric()
            || !MinorText.IsNumeric())
        {
            return false;
        }

        const int32 Major = FCString::Atoi(*MajorText);
        const int32 Minor = FCString::Atoi(*MinorText);
        if (Major != 5 || Minor < 0 || Minor > 8)
        {
            return false;
        }

        OutEncoded = CYTASK_UE_VERSION_ENCODE(Major, Minor);
        return true;
    }

    bool IsSafeContentPath(const FString& Path)
    {
        const bool bGameRoot = Path.StartsWith(TEXT("/Game/"));
        const bool bPluginRoot = Path.StartsWith(TEXT("/Plugins/"));
        bool bAllowedRoot = bGameRoot;
        if (bPluginRoot)
        {
            const FString PluginRelative = Path.Mid(9);
            FString PluginName;
            FString PluginPath;
            if (PluginRelative.Split(TEXT("/"), &PluginName, &PluginPath)
                && !PluginName.IsEmpty())
            {
                bAllowedRoot = true;
                for (const TCHAR Character : PluginName)
                {
                    if (!FChar::IsAlnum(Character)
                        && Character != TEXT('_')
                        && Character != TEXT('-'))
                    {
                        bAllowedRoot = false;
                        break;
                    }
                }
            }
        }
        if (!bAllowedRoot || Path.Len() > 512 || Path.Contains(TEXT("\\"))
            || Path.Contains(TEXT("//")) || Path.Contains(TEXT("/../"))
            || Path.EndsWith(TEXT("/..")) || Path.Contains(TEXT("/./")))
        {
            return false;
        }

        for (const TCHAR Character : Path)
        {
            const bool bAllowed = FChar::IsAlnum(Character)
                || Character == TEXT('_')
                || Character == TEXT('-')
                || Character == TEXT('.')
                || Character == TEXT('/');
            if (!bAllowed)
            {
                return false;
            }
        }
        return true;
    }

    void AddAffectedPath(FCyTaskAssetRecipeValidation& Validation, const FString& Path)
    {
        if (!Path.IsEmpty())
        {
            Validation.AffectedPaths.AddUnique(Path);
        }
    }

    bool IsSafeMetadataKey(const FString& Key)
    {
        if (!Key.StartsWith(TEXT("CyTask.")) || Key.Len() <= 7 || Key.Len() > 128)
        {
            return false;
        }
        for (int32 Index = 7; Index < Key.Len(); ++Index)
        {
            const TCHAR Character = Key[Index];
            if (!FChar::IsAlnum(Character)
                && Character != TEXT('_')
                && Character != TEXT('-')
                && Character != TEXT('.'))
            {
                return false;
            }
        }
        return true;
    }
}

FCyTaskAssetRecipeValidation FCyTaskAssetRecipeParser::Validate(const FCyTaskAssetRecipe& Recipe)
{
    FCyTaskAssetRecipeValidation Validation;

    if (Recipe.SchemaVersion != 1)
    {
        AddError(Validation, TEXT("Seule la version 1 du schéma est acceptée."));
    }
    if (!Recipe.RecipeId.IsValid() || !Recipe.TaskId.IsValid())
    {
        AddError(Validation, TEXT("recipeId et taskId doivent être des UUID valides."));
    }
    if (Recipe.Revision < 1)
    {
        AddError(Validation, TEXT("revision doit être supérieure ou égale à 1."));
    }
    if (Recipe.IdempotencyKey.Len() < 16 || Recipe.IdempotencyKey.Len() > 128)
    {
        AddError(Validation, TEXT("idempotencyKey doit contenir entre 16 et 128 caractères."));
    }
    if (Recipe.Title.Len() > 120)
    {
        AddError(Validation, TEXT("title dépasse 120 caractères."));
    }
    if (Recipe.Preconditions.Num() > 100)
    {
        AddError(Validation, TEXT("Une recette ne peut pas avoir plus de 100 préconditions."));
    }
    if (Recipe.Steps.Num() < 1 || Recipe.Steps.Num() > 500)
    {
        AddError(Validation, TEXT("Une recette doit contenir entre 1 et 500 étapes."));
    }

    int32 MinimumVersion = 0;
    int32 MaximumVersion = 0;
    if (!ParseEngineVersion(Recipe.MinimumEngine, MinimumVersion)
        || !ParseEngineVersion(Recipe.MaximumEngine, MaximumVersion))
    {
        AddError(Validation, TEXT("La plage moteur doit être comprise entre 4.27 et 5.8."));
    }
    else
    {
        if (MinimumVersion > MaximumVersion)
        {
            AddError(Validation, TEXT("La version moteur minimum dépasse la version maximum."));
        }
        if (CYTASK_UE_VERSION < MinimumVersion || CYTASK_UE_VERSION > MaximumVersion)
        {
            AddError(Validation, FString::Printf(
                TEXT("Cette recette ne cible pas Unreal Engine %s."),
                *CyTaskCompat::GetEngineVersionLabel()));
        }
    }

    for (const FCyTaskAssetPrecondition& Precondition : Recipe.Preconditions)
    {
        if (!IsSafeContentPath(Precondition.Path))
        {
            AddError(Validation, TEXT("Une précondition contient un chemin Content invalide."));
        }
        AddAffectedPath(Validation, Precondition.Path);
    }

    for (const FCyTaskAssetStep& Step : Recipe.Steps)
    {
        switch (Step.Kind)
        {
        case ECyTaskAssetStepKind::CreateFolder:
            if (!IsSafeContentPath(Step.Path))
            {
                AddError(Validation, TEXT("create-folder contient un chemin invalide."));
            }
            AddAffectedPath(Validation, Step.Path);
            break;
        case ECyTaskAssetStepKind::DuplicateAsset:
            if (!IsSafeContentPath(Step.Source) || !IsSafeContentPath(Step.Destination))
            {
                AddError(Validation, TEXT("duplicate-asset contient un chemin invalide."));
            }
            AddAffectedPath(Validation, Step.Source);
            AddAffectedPath(Validation, Step.Destination);
            break;
        case ECyTaskAssetStepKind::SetMetadata:
            if (!IsSafeContentPath(Step.Asset))
            {
                AddError(Validation, TEXT("set-metadata contient un chemin d'asset invalide."));
            }
            if (!IsSafeMetadataKey(Step.Key))
            {
                AddError(Validation, TEXT("La clé de métadonnée CyTask contient un caractère invalide."));
            }
            if (Step.Value.Len() > 2048)
            {
                AddError(Validation, TEXT("La valeur de métadonnée dépasse 2048 caractères."));
            }
            AddAffectedPath(Validation, Step.Asset);
            break;
        }
    }

    return Validation;
}

bool FCyTaskAssetRecipeParser::ParseAndValidate(
    const FString& Json,
    FCyTaskAssetRecipe& OutRecipe,
    FCyTaskAssetRecipeValidation& OutValidation)
{
    OutRecipe = FCyTaskAssetRecipe();
    OutValidation = FCyTaskAssetRecipeValidation();

    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        AddError(OutValidation, TEXT("Le document n'est pas un objet JSON valide."));
        return false;
    }

    HasOnlyFields(
        Root,
        { TEXT("schemaVersion"), TEXT("recipeId"), TEXT("taskId"), TEXT("revision"),
          TEXT("idempotencyKey"), TEXT("title"), TEXT("engine"), TEXT("preconditions"),
          TEXT("steps") },
        TEXT("la recette"),
        OutValidation);

    double SchemaVersion = 0;
    double Revision = 0;
    if (!Root->TryGetNumberField(TEXT("schemaVersion"), SchemaVersion))
    {
        AddError(OutValidation, TEXT("Le champ 'schemaVersion' est obligatoire."));
    }
    if (!Root->TryGetNumberField(TEXT("revision"), Revision))
    {
        AddError(OutValidation, TEXT("Le champ 'revision' est obligatoire."));
    }
    if (SchemaVersion == 1.0)
    {
        OutRecipe.SchemaVersion = 1;
    }
    else
    {
        if (SchemaVersion != FMath::FloorToDouble(SchemaVersion))
        {
            AddError(OutValidation, TEXT("schemaVersion doit être un entier."));
        }
        OutRecipe.SchemaVersion = 0;
    }
    if (Revision >= 1.0 && Revision <= 2147483647.0
        && Revision == FMath::FloorToDouble(Revision))
    {
        OutRecipe.Revision = static_cast<int32>(Revision);
    }
    else
    {
        AddError(OutValidation, TEXT("revision doit être un entier positif sur 32 bits."));
        OutRecipe.Revision = 0;
    }

    FString RecipeId;
    FString TaskId;
    TryGetRequiredString(Root, TEXT("recipeId"), RecipeId, OutValidation);
    TryGetRequiredString(Root, TEXT("taskId"), TaskId, OutValidation);
    FGuid::Parse(RecipeId, OutRecipe.RecipeId);
    FGuid::Parse(TaskId, OutRecipe.TaskId);
    TryGetRequiredString(Root, TEXT("idempotencyKey"), OutRecipe.IdempotencyKey, OutValidation);
    if (Root->HasField(TEXT("title")))
    {
        if (!Root->TryGetStringField(TEXT("title"), OutRecipe.Title) || OutRecipe.Title.IsEmpty())
        {
            AddError(OutValidation, TEXT("title doit être une chaîne non vide lorsqu'il est fourni."));
        }
    }

    const TSharedPtr<FJsonObject>* Engine = nullptr;
    if (!Root->TryGetObjectField(TEXT("engine"), Engine) || Engine == nullptr || !Engine->IsValid())
    {
        AddError(OutValidation, TEXT("Le champ 'engine' est obligatoire."));
    }
    else
    {
        HasOnlyFields(*Engine, { TEXT("minimum"), TEXT("maximum") }, TEXT("engine"), OutValidation);
        TryGetRequiredString(*Engine, TEXT("minimum"), OutRecipe.MinimumEngine, OutValidation);
        TryGetRequiredString(*Engine, TEXT("maximum"), OutRecipe.MaximumEngine, OutValidation);
    }

    const TArray<TSharedPtr<FJsonValue>>* Preconditions = nullptr;
    if (Root->HasField(TEXT("preconditions"))
        && (!Root->TryGetArrayField(TEXT("preconditions"), Preconditions) || Preconditions == nullptr))
    {
        AddError(OutValidation, TEXT("preconditions doit être un tableau."));
    }
    else if (Preconditions != nullptr)
    {
        if (Preconditions->Num() > 100)
        {
            AddError(OutValidation, TEXT("preconditions dépasse 100 éléments."));
        }
        else
        {
            for (const TSharedPtr<FJsonValue>& Value : *Preconditions)
            {
                const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
                HasOnlyFields(Object, { TEXT("kind"), TEXT("path") }, TEXT("une précondition"), OutValidation);

                FString Kind;
                FCyTaskAssetPrecondition Parsed;
                if (!TryGetRequiredString(Object, TEXT("kind"), Kind, OutValidation)
                    || !TryGetRequiredString(Object, TEXT("path"), Parsed.Path, OutValidation))
                {
                    continue;
                }
                if (Kind == TEXT("asset-exists"))
                {
                    Parsed.Kind = ECyTaskAssetPreconditionKind::AssetExists;
                }
                else if (Kind == TEXT("asset-missing"))
                {
                    Parsed.Kind = ECyTaskAssetPreconditionKind::AssetMissing;
                }
                else
                {
                    AddError(OutValidation, TEXT("Type de précondition inconnu."));
                    continue;
                }
                OutRecipe.Preconditions.Add(MoveTemp(Parsed));
            }
        }
    }

    const TArray<TSharedPtr<FJsonValue>>* Steps = nullptr;
    if (!Root->TryGetArrayField(TEXT("steps"), Steps) || Steps == nullptr)
    {
        AddError(OutValidation, TEXT("Le tableau 'steps' est obligatoire."));
    }
    else
    {
        if (Steps->Num() > 500)
        {
            AddError(OutValidation, TEXT("steps dépasse 500 éléments."));
        }
        else
        {
            for (const TSharedPtr<FJsonValue>& Value : *Steps)
            {
                const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
                FString Kind;
                if (!TryGetRequiredString(Object, TEXT("kind"), Kind, OutValidation))
                {
                    continue;
                }

                FCyTaskAssetStep Parsed;
                if (Kind == TEXT("create-folder"))
                {
                    Parsed.Kind = ECyTaskAssetStepKind::CreateFolder;
                    HasOnlyFields(Object, { TEXT("kind"), TEXT("path") }, Kind, OutValidation);
                    TryGetRequiredString(Object, TEXT("path"), Parsed.Path, OutValidation);
                }
                else if (Kind == TEXT("duplicate-asset"))
                {
                    Parsed.Kind = ECyTaskAssetStepKind::DuplicateAsset;
                    HasOnlyFields(Object, { TEXT("kind"), TEXT("source"), TEXT("destination") }, Kind, OutValidation);
                    TryGetRequiredString(Object, TEXT("source"), Parsed.Source, OutValidation);
                    TryGetRequiredString(Object, TEXT("destination"), Parsed.Destination, OutValidation);
                }
                else if (Kind == TEXT("set-metadata"))
                {
                    Parsed.Kind = ECyTaskAssetStepKind::SetMetadata;
                    HasOnlyFields(
                        Object,
                        { TEXT("kind"), TEXT("asset"), TEXT("key"), TEXT("value") },
                        Kind,
                        OutValidation);
                    TryGetRequiredString(Object, TEXT("asset"), Parsed.Asset, OutValidation);
                    TryGetRequiredString(Object, TEXT("key"), Parsed.Key, OutValidation);
                    TryGetRequiredString(Object, TEXT("value"), Parsed.Value, OutValidation);
                }
                else
                {
                    AddError(OutValidation, FString::Printf(TEXT("Étape inconnue '%s'."), *Kind));
                    continue;
                }
                OutRecipe.Steps.Add(MoveTemp(Parsed));
            }
        }
    }

    FCyTaskAssetRecipeValidation SemanticValidation = Validate(OutRecipe);
    OutValidation.Errors.Append(SemanticValidation.Errors);
    OutValidation.AffectedPaths = MoveTemp(SemanticValidation.AffectedPaths);
    return OutValidation.IsValid();
}
