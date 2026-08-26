using UnrealBuildTool;

public class CyTaskEditor : ModuleRules
{
    public CyTaskEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "ContentBrowser",
            "CoreUObject",
            "CyTaskAssetRecipes",
            "CyTaskCompat",
            "CyTaskCore",
            "DesktopPlatform",
            "Engine",
            "InputCore",
            "LevelEditor",
            "Slate",
            "SlateCore",
            "ToolMenus",
            "UnrealEd"
        });
    }
}
