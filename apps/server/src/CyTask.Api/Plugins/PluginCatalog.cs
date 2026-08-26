namespace CyTask.Api.Plugins;

public sealed class PluginCatalog
{
    public const string GitPluginId = "dev.cytask.git";
    public const string AiAssistantPluginId = "dev.cytask.ai-assistant";
    public const string UnrealPluginId = "dev.cytask.unreal";

    private readonly IReadOnlyList<PluginManifest> _plugins =
    [
        new(
            1,
            GitPluginId,
            "Git",
            "Relie les tickets aux dépôts, branches, commits et demandes de fusion.",
            "0.1.0",
            "v1",
            "service-connector",
            ["tasks:read", "external-references:write", "tasks:plugin-data:write"],
            new PluginContributions(
            [
                new PluginTaskTabDefinition(
                    "git",
                    "Git",
                    "GT",
                    [
                        new("provider", "Forge", "select", Options: ["Git", "GitHub", "GitLab", "Forgejo", "Gitea", "Azure DevOps"]),
                        new("repository", "Dépôt principal", "text", Placeholder: "studio/nebula-station", MaxLength: 240),
                        new("defaultBranch", "Branche par défaut", "text", Placeholder: "main", MaxLength: 240),
                        new("remoteUrl", "URL du dépôt", "text", Placeholder: "https://git.example.org/studio/nebula.git", MaxLength: 2048),
                        new("integrationMode", "Mode", "select", Options: ["Références manuelles", "Webhook", "Application Git", "Local uniquement"]),
                        new("autoLink", "Lier automatiquement les clés de tickets", "boolean", Description: "Aucun dépôt ni secret n’est contacté par cette option seule.")
                    ])
            ]),
            "https://github.com/MrMybal/CyTask"),
        new(
            1,
            AiAssistantPluginId,
            "AI Assistant",
            "Ajoute un contexte d’assistance IA par ticket sans stocker de clé API dans CyTask.",
            "0.1.0",
            "v1",
            "service-connector",
            ["tasks:read", "attachments:read", "tasks:plugin-data:write", "ai:invoke"],
            new PluginContributions(
            [
                new PluginTaskTabDefinition(
                    "assistant",
                    "AI Assistant",
                    "AI",
                    [
                        new("provider", "Fournisseur", "select", Options: ["OpenAI", "Ollama", "LM Studio", "API compatible", "Désactivé"]),
                        new("model", "Modèle", "text", Placeholder: "Modèle configuré côté serveur ou client", MaxLength: 160),
                        new("goal", "Objectif de l’assistant", "textarea", Placeholder: "Analyser le ticket, proposer un plan ou résumer les échanges…", MaxLength: 12000),
                        new("contextSources", "Sources de contexte", "string-list", Description: "Une source ou un chemin autorisé par ligne.", MaxLength: 1024),
                        new("includeAttachments", "Inclure les pièces jointes validées", "boolean", Description: "Seuls les fichiers déjà accessibles à l’utilisateur peuvent être utilisés."),
                        new("outputMode", "Sortie attendue", "select", Options: ["Plan", "Résumé", "Checklist", "Commentaire", "Revue technique"]),
                        new("instructions", "Instructions du projet", "textarea", Placeholder: "Contraintes, style et règles à respecter…", MaxLength: 12000),
                        new("lastSummary", "Dernier résumé conservé", "textarea", Description: "Donnée partagée du ticket, jamais une clé API.", MaxLength: 20000)
                    ])
            ]),
            "https://github.com/MrMybal/CyTask"),
        new(
            1,
            UnrealPluginId,
            "Unreal Engine",
            "Ajoute aux tickets un contexte Unreal partagé avec le plugin de l’éditeur.",
            "0.2.0",
            "v1",
            "ui-extension",
            ["tasks:read", "tasks:plugin-data:write"],
            new PluginContributions(
            [
                new PluginTaskTabDefinition(
                    "unreal",
                    "Unreal",
                    "UE",
                    [
                        new("engineVersion", "Version du moteur", "text", Placeholder: "5.5", MaxLength: 80),
                        new("projectName", "Projet Unreal", "text", Placeholder: "NebulaStation", MaxLength: 160),
                        new("mapPath", "Map / niveau", "map-path", Placeholder: "/Game/Maps/Hangar", MaxLength: 1024),
                        new("assetPaths", "Assets concernés", "string-list", Description: "Un chemin Unreal par ligne.", Placeholder: "/Game/Characters/Hero", MaxLength: 1024),
                        new("targetPlatform", "Plateforme cible", "select", Options: ["Win64", "Linux", "Mac", "Android", "Toutes"]),
                        new("reviewBuild", "Build de revue", "text", Placeholder: "VerticalSlice-142", MaxLength: 240),
                        new("notes", "Notes Unreal", "textarea", Placeholder: "Contexte technique, étapes de reproduction…", MaxLength: 20000)
                    ])
            ]),
            "https://github.com/MrMybal/CyTask/tree/main/integrations/unreal/CyTask"),
        new(
            1,
            "dev.cytask.cyrevision",
            "CyRevision",
            "Relie tickets, branches, commits et révisions CyRevision avec transitions après fusion.",
            "0.1.0",
            "v1",
            "service-connector",
            ["tasks:read", "tasks:write", "tasks:plugin-data:write"],
            new PluginContributions(
            [
                new PluginTaskTabDefinition(
                    "cyrevision",
                    "CyRevision",
                    "CR",
                    [
                        new("repository", "Dépôt", "text", Placeholder: "studio/nebula-station", MaxLength: 240),
                        new("branch", "Branche", "text", Placeholder: "feature/NEB-42-hangar", MaxLength: 512),
                        new("revisionId", "Révision CyRevision", "text", Placeholder: "rev-0198…", MaxLength: 240),
                        new("commitSha", "Commit Git", "text", Placeholder: "a1b2c3d4", MaxLength: 128),
                        new("revisionUrl", "Lien de révision", "text", Placeholder: "cyrevision://revision/…", MaxLength: 2048),
                        new("changedFiles", "Fichiers modifiés", "string-list", Description: "Un chemin par ligne.", MaxLength: 2048),
                        new("syncMode", "Mode de synchronisation", "select", Options: ["Git", "Git LFS", "Syncthing", "CyStore", "Hybride"]),
                        new("summary", "Résumé de la révision", "textarea", Placeholder: "Contenu et raison de la modification…", MaxLength: 20000)
                    ])
            ]),
            "https://github.com/MrMybal/CyRevision")
    ];

    public IReadOnlyList<PluginManifest> List() => _plugins;

    public PluginManifest? Find(string pluginId) => _plugins.FirstOrDefault(
        plugin => string.Equals(plugin.Id, pluginId, StringComparison.Ordinal));
}
