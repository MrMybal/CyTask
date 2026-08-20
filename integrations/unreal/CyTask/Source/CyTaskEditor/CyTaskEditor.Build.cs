using UnrealBuildTool;

public class CyTaskEditor : ModuleRules
{
    public CyTaskEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "CyTaskAssetRecipes",
            "CyTaskCompat",
            "CyTaskCore",
            "Engine",
            "InputCore",
            "LevelEditor",
            "Slate",
            "SlateCore",
            "ToolMenus"
        });
    }
}
