#include "CyTaskEditorModule.h"

#include "CyTaskVersionCompat.h"
#include "Framework/Commands/UIAction.h"
#include "Framework/Docking/TabManager.h"
#include "SCyTaskPanel.h"
#include "Textures/SlateIcon.h"
#include "ToolMenus.h"
#include "Widgets/Docking/SDockTab.h"

#define LOCTEXT_NAMESPACE "CyTaskEditor"

namespace
{
    const FName CyTaskTabName(TEXT("CyTask"));
}

void FCyTaskEditorModule::StartupModule()
{
    if (!CyTaskCompat::IsSupportedEngineVersion())
    {
        UE_LOG(
            LogTemp,
            Warning,
            TEXT("CyTask: Unreal Engine %s n'appartient pas à la matrice validée 4.27-5.8."),
            *CyTaskCompat::GetEngineVersionLabel());
    }

    FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
        CyTaskTabName,
        FOnSpawnTab::CreateRaw(this, &FCyTaskEditorModule::SpawnPanel))
        .SetDisplayName(LOCTEXT("TabTitle", "CyTask"))
        .SetTooltipText(LOCTEXT("TabTooltip", "Ouvrir le panneau CyTask"))
        .SetMenuType(ETabSpawnerMenuType::Hidden);

    UToolMenus::RegisterStartupCallback(
        FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FCyTaskEditorModule::RegisterMenus));
}

void FCyTaskEditorModule::ShutdownModule()
{
    UToolMenus::UnRegisterStartupCallback(this);
    UToolMenus::UnregisterOwner(this);
    FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(CyTaskTabName);
}

void FCyTaskEditorModule::RegisterMenus()
{
    FToolMenuOwnerScoped OwnerScoped(this);
    UToolMenu* Menu = UToolMenus::Get()->ExtendMenu(TEXT("LevelEditor.MainMenu.Window"));
    FToolMenuSection& Section = Menu->FindOrAddSection(TEXT("WindowLayout"));
    Section.AddMenuEntry(
        TEXT("CyTask.OpenPanel"),
        LOCTEXT("OpenPanel", "CyTask"),
        LOCTEXT("OpenPanelTooltip", "Ouvrir les tâches et recettes CyTask"),
        FSlateIcon(),
        FUIAction(FExecuteAction::CreateRaw(this, &FCyTaskEditorModule::OpenPanel)));
}

void FCyTaskEditorModule::OpenPanel()
{
    FGlobalTabmanager::Get()->TryInvokeTab(CyTaskTabName);
}

TSharedRef<SDockTab> FCyTaskEditorModule::SpawnPanel(const FSpawnTabArgs& Args)
{
    return SNew(SDockTab)
        .TabRole(ETabRole::NomadTab)
        [
            SNew(SCyTaskPanel)
        ];
}

IMPLEMENT_MODULE(FCyTaskEditorModule, CyTaskEditor)

#undef LOCTEXT_NAMESPACE
