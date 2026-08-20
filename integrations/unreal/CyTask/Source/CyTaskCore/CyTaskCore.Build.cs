using UnrealBuildTool;

public class CyTaskCore : ModuleRules
{
    public CyTaskCore(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "HTTP",
            "Json",
            "Sockets"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "CyTaskCompat"
        });

        AddEngineThirdPartyPrivateStaticDependencies(Target, "OpenSSL");
    }
}
