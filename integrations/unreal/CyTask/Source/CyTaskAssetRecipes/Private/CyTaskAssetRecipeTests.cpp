#if WITH_DEV_AUTOMATION_TESTS

#include "CyTaskAssetRecipe.h"
#include "Misc/AutomationTest.h"

namespace
{
    FString MakeRecipe(const FString& StepJson)
    {
        return FString::Printf(TEXT(R"CYTASK({
            "schemaVersion": 1,
            "recipeId": "0198c8c5-8129-7d0e-9673-8dd3ba16ed4b",
            "taskId": "0198c8c4-e1ff-7a63-b4e6-b8de8fdd293e",
            "revision": 1,
            "idempotencyKey": "0198c8c5-8129-7d0e-9673-8dd3ba16ed4b:1",
            "engine": { "minimum": "4.27", "maximum": "5.8" },
            "steps": [%s]
        })CYTASK"), *StepJson);
    }
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCyTaskAssetRecipeValidationTest,
    "CyTask.AssetRecipes.Validation",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCyTaskAssetRecipeValidationTest::RunTest(const FString& Parameters)
{
    FCyTaskAssetRecipe Recipe;
    FCyTaskAssetRecipeValidation Validation;

    TestTrue(
        TEXT("Recette sûre acceptée"),
        FCyTaskAssetRecipeParser::ParseAndValidate(
            MakeRecipe(TEXT("{ \"kind\": \"create-folder\", \"path\": \"/Game/CyTaskPreview\" }")),
            Recipe,
            Validation));
    TestEqual(TEXT("Un chemin affecté"), Validation.AffectedPaths.Num(), 1);

    TestFalse(
        TEXT("Traversée de chemin refusée"),
        FCyTaskAssetRecipeParser::ParseAndValidate(
            MakeRecipe(TEXT("{ \"kind\": \"create-folder\", \"path\": \"/Game/../Secrets\" }")),
            Recipe,
            Validation));

    TestFalse(
        TEXT("Action inconnue refusée"),
        FCyTaskAssetRecipeParser::ParseAndValidate(
            MakeRecipe(TEXT("{ \"kind\": \"run-command\", \"command\": \"whoami\" }")),
            Recipe,
            Validation));

    TestFalse(
        TEXT("Champ supplémentaire refusé"),
        FCyTaskAssetRecipeParser::ParseAndValidate(
            MakeRecipe(TEXT("{ \"kind\": \"create-folder\", \"path\": \"/Game/Safe\", \"script\": \"x\" }")),
            Recipe,
            Validation));

    TestFalse(
        TEXT("Révision fractionnaire refusée"),
        FCyTaskAssetRecipeParser::ParseAndValidate(
            MakeRecipe(TEXT("{ \"kind\": \"create-folder\", \"path\": \"/Game/Safe\" }"))
                .Replace(TEXT("\"revision\": 1"), TEXT("\"revision\": 1.5")),
            Recipe,
            Validation));

    TestFalse(
        TEXT("Chemin plugin incomplet refusé"),
        FCyTaskAssetRecipeParser::ParseAndValidate(
            MakeRecipe(TEXT("{ \"kind\": \"create-folder\", \"path\": \"/Plugins/Demo\" }")),
            Recipe,
            Validation));

    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCyTaskAssetRecipeConfirmationTest,
    "CyTask.AssetRecipes.RequiresConfirmation",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCyTaskAssetRecipeConfirmationTest::RunTest(const FString& Parameters)
{
    FCyTaskAssetRecipe Recipe;
    FCyTaskAssetRecipeValidation Validation;
    if (!FCyTaskAssetRecipeParser::ParseAndValidate(
        MakeRecipe(TEXT("{ \"kind\": \"create-folder\", \"path\": \"/Game/CyTaskPreview\" }")),
        Recipe,
        Validation))
    {
        AddError(TEXT("La fixture de recette doit être valide."));
        return false;
    }

    const FCyTaskAssetRecipeExecution Result =
        FCyTaskAssetRecipeExecutor::ExecuteConfirmed(Recipe, false);
    TestFalse(TEXT("Exécution sans confirmation refusée"), Result.bSucceeded);
    return true;
}

#endif
