using UnrealBuildTool;

public class CyTaskCompat : ModuleRules
{
    public CyTaskCompat(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core" });
    }
}
