using UnrealBuildTool;

public class CyTaskAssetRecipes : ModuleRules
{
    public CyTaskAssetRecipes(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "Json"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "AssetRegistry",
            "AssetTools",
            "CoreUObject",
            "CyTaskCompat",
            "Engine",
            "UnrealEd"
        });
    }
}
