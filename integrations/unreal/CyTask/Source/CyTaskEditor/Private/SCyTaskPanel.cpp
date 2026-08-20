#include "SCyTaskPanel.h"

#include "Async/Async.h"
#include "CyTaskApiClient.h"
#include "CyTaskAssetRecipe.h"
#include "CyTaskNativeAuthorization.h"
#include "CyTaskVersionCompat.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Views/SListView.h"
#include "Widgets/Views/STableRow.h"

#define LOCTEXT_NAMESPACE "CyTaskPanel"

void SCyTaskPanel::Construct(const FArguments& InArgs)
{
    ApiClient = MakeShared<FCyTaskApiClient>();
    NativeAuthorization = MakeShared<FCyTaskNativeAuthorization>();

    ChildSlot
    [
        SNew(SBorder)
        .Padding(16.0f)
        [
            SNew(SScrollBox)
            + SScrollBox::Slot()
            [
                SNew(SVerticalBox)
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 4.0f)
                [
                    SNew(STextBlock)
                    .Font(FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 18))
                    .Text(LOCTEXT("Title", "CyTask"))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 16.0f)
                [
                    SNew(STextBlock)
                    .AutoWrapText(true)
                    .Text(FText::Format(
                        LOCTEXT("Subtitle", "Connexion sécurisée au serveur — Unreal Engine {0}"),
                        FText::FromString(CyTaskCompat::GetEngineVersionLabel())))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 6.0f)
                [
                    SNew(STextBlock)
                    .Text(LOCTEXT("ServerLabel", "Adresse du serveur"))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SAssignNew(ServerUrlTextBox, SEditableTextBox)
                    .Text(FText::FromString(TEXT("https://cytask.local")))
                    .HintText(LOCTEXT("ServerHint", "https://tasks.example.com"))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(SButton)
                    .Text(LOCTEXT("CheckConnection", "Tester la disponibilité"))
                    .OnClicked(this, &SCyTaskPanel::CheckConnection)
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SAssignNew(ConnectionStatusText, STextBlock)
                    .AutoWrapText(true)
                    .Text(LOCTEXT(
                        "NoCredentials",
                        "Compte non connecté. L'authentification s'ouvre dans le navigateur système."))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(SButton)
                    .Text(LOCTEXT("ConnectAccount", "Connecter mon compte"))
                    .OnClicked(this, &SCyTaskPanel::ConnectAccount)
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(SButton)
                    .Text(LOCTEXT("DisconnectAccount", "Déconnecter ce compte"))
                    .OnClicked(this, &SCyTaskPanel::DisconnectAccount)
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 20.0f)
                [
                    SNew(STextBlock)
                    .AutoWrapText(true)
                    .Text(LOCTEXT(
                        "TokenLifetime",
                        "Le jeton Bearer reste uniquement en mémoire et est effacé à la fermeture du panneau ou de l'éditeur."))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 4.0f)
                [
                    SNew(STextBlock)
                    .Font(FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 14))
                    .Text(LOCTEXT("TasksTitle", "Projets et tâches"))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(STextBlock)
                    .AutoWrapText(true)
                    .Text(LOCTEXT(
                        "TasksExplanation",
                        "Sélectionnez un projet pour consulter ses tâches directement dans l'éditeur."))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(SHorizontalBox)
                    + SHorizontalBox::Slot()
                    .FillWidth(1.0f)
                    .Padding(0.0f, 0.0f, 8.0f, 0.0f)
                    [
                        SAssignNew(ProjectComboBox, SComboBox<TSharedPtr<FCyTaskProjectSummary>>)
                        .OptionsSource(&ProjectOptions)
                        .OnGenerateWidget(this, &SCyTaskPanel::GenerateProjectWidget)
                        .OnSelectionChanged(this, &SCyTaskPanel::OnProjectSelected)
                        [
                            SAssignNew(SelectedProjectText, STextBlock)
                            .Text(LOCTEXT("NoProjectSelected", "Aucun projet"))
                        ]
                    ]
                    + SHorizontalBox::Slot()
                    .AutoWidth()
                    [
                        SNew(SButton)
                        .Text(LOCTEXT("RefreshProjects", "Actualiser"))
                        .OnClicked(this, &SCyTaskPanel::RefreshProjectsClicked)
                    ]
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SAssignNew(TaskStatusText, STextBlock)
                    .AutoWrapText(true)
                    .Text(LOCTEXT("TasksIdle", "Connectez un compte pour charger les tâches."))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 20.0f)
                [
                    SNew(SBox)
                    .HeightOverride(280.0f)
                    [
                        SAssignNew(TaskListView, SListView<TSharedPtr<FCyTaskWorkItemSummary>>)
                        .ListItemsSource(&TaskItems)
                        .SelectionMode(ESelectionMode::Single)
                        .OnGenerateRow(this, &SCyTaskPanel::GenerateTaskRow)
                    ]
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 4.0f)
                [
                    SNew(STextBlock)
                    .Font(FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 14))
                    .Text(LOCTEXT("RecipeTitle", "Recettes d'assets"))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(STextBlock)
                    .AutoWrapText(true)
                    .Text(LOCTEXT(
                        "RecipeExplanation",
                        "Le parseur local refuse les actions inconnues, les champs supplémentaires et les chemins hors /Game ou /Plugins."))
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(0.0f, 0.0f, 0.0f, 8.0f)
                [
                    SNew(SButton)
                    .Text(LOCTEXT("ValidateRecipe", "Tester la recette d'exemple"))
                    .OnClicked(this, &SCyTaskPanel::ValidateExampleRecipe)
                ]
                + SVerticalBox::Slot()
                .AutoHeight()
                [
                    SAssignNew(RecipeStatusText, STextBlock)
                    .AutoWrapText(true)
                    .Text(LOCTEXT("RecipeIdle", "Aucune recette chargée."))
                ]
            ]
        ]
    ];
}

SCyTaskPanel::~SCyTaskPanel()
{
    if (NativeAuthorization.IsValid())
    {
        NativeAuthorization->Cancel();
    }
    if (ApiClient.IsValid())
    {
        ApiClient->ClearAccessToken();
    }
}

FReply SCyTaskPanel::CheckConnection()
{
    FString Error;
    if (!ApiClient->SetServerUrl(ServerUrlTextBox->GetText().ToString(), Error))
    {
        ConnectionStatusText->SetText(FText::FromString(Error));
        return FReply::Handled();
    }

    ConnectionStatusText->SetText(LOCTEXT("Checking", "Connexion en cours…"));
    const TWeakPtr<SCyTaskPanel> WeakPanel = StaticCastSharedRef<SCyTaskPanel>(AsShared());
    ApiClient->CheckReady(
        [WeakPanel](const FCyTaskConnectionResult& Result)
        {
            const FString Message = Result.Message;
            AsyncTask(ENamedThreads::GameThread, [WeakPanel, Message]()
            {
                const TSharedPtr<SCyTaskPanel> Panel = WeakPanel.Pin();
                if (Panel.IsValid() && Panel->ConnectionStatusText.IsValid())
                {
                    Panel->ConnectionStatusText->SetText(FText::FromString(Message));
                }
            });
        });
    return FReply::Handled();
}

FReply SCyTaskPanel::ConnectAccount()
{
    if (bAuthorizationPending)
    {
        ConnectionStatusText->SetText(LOCTEXT(
            "AuthorizationAlreadyPending",
            "Une autorisation est déjà en attente dans le navigateur."));
        return FReply::Handled();
    }

    FString Error;
    if (!ApiClient->SetServerUrl(ServerUrlTextBox->GetText().ToString(), Error))
    {
        ConnectionStatusText->SetText(FText::FromString(Error));
        return FReply::Handled();
    }

    ApiClient->ClearAccessToken();
    bAuthorizationPending = true;
    ConnectionStatusText->SetText(LOCTEXT(
        "OpeningBrowser",
        "Ouverture du navigateur système. Autorisez CyTask puis revenez dans Unreal Engine…"));

    const TWeakPtr<SCyTaskPanel> WeakPanel = StaticCastSharedRef<SCyTaskPanel>(AsShared());
    const bool bStarted = NativeAuthorization->Start(
        ApiClient->GetServerUrl(),
        [WeakPanel](const FCyTaskNativeAuthorizationResult& AuthorizationResult)
        {
            const TSharedPtr<SCyTaskPanel> Panel = WeakPanel.Pin();
            if (!Panel.IsValid())
            {
                return;
            }

            Panel->bAuthorizationPending = false;
            if (!AuthorizationResult.bSucceeded)
            {
                Panel->ConnectionStatusText->SetText(FText::FromString(AuthorizationResult.Message));
                return;
            }

            Panel->ApiClient->SetAccessToken(AuthorizationResult.AccessToken);
            Panel->ConnectionStatusText->SetText(LOCTEXT(
                "IdentityCheck",
                "Autorisation reçue. Vérification de l'identité…"));
            Panel->ApiClient->GetCurrentIdentity(
                [WeakPanel](const FCyTaskIdentityResult& IdentityResult)
                {
                    const FString Message = IdentityResult.Message;
                    const bool bSucceeded = IdentityResult.bSucceeded;
                    AsyncTask(ENamedThreads::GameThread, [WeakPanel, Message, bSucceeded]()
                    {
                        const TSharedPtr<SCyTaskPanel> InnerPanel = WeakPanel.Pin();
                        if (!InnerPanel.IsValid())
                        {
                            return;
                        }
                        if (!bSucceeded)
                        {
                            InnerPanel->ApiClient->ClearAccessToken();
                        }
                        InnerPanel->ConnectionStatusText->SetText(FText::FromString(Message));
                        if (bSucceeded)
                        {
                            InnerPanel->RefreshProjects();
                        }
                    });
                });
        },
        Error);

    if (!bStarted)
    {
        bAuthorizationPending = false;
        ConnectionStatusText->SetText(FText::FromString(Error));
    }
    return FReply::Handled();
}

FReply SCyTaskPanel::DisconnectAccount()
{
    if (NativeAuthorization.IsValid())
    {
        NativeAuthorization->Cancel();
        NativeAuthorization = MakeShared<FCyTaskNativeAuthorization>();
    }
    bAuthorizationPending = false;
    const TWeakPtr<SCyTaskPanel> WeakPanel = StaticCastSharedRef<SCyTaskPanel>(AsShared());
    ApiClient->RevokeAccessToken(
        [WeakPanel](const FCyTaskConnectionResult& Result)
        {
            const FString Message = Result.Message;
            AsyncTask(ENamedThreads::GameThread, [WeakPanel, Message]()
            {
                const TSharedPtr<SCyTaskPanel> Panel = WeakPanel.Pin();
                if (Panel.IsValid())
                {
                    Panel->ConnectionStatusText->SetText(FText::FromString(Message));
                }
            });
        });
    ProjectOptions.Reset();
    SelectedProject.Reset();
    TaskItems.Reset();
    ProjectComboBox->ClearSelection();
    ProjectComboBox->RefreshOptions();
    SelectedProjectText->SetText(LOCTEXT("NoProjectAfterDisconnect", "Aucun projet"));
    TaskListView->RequestListRefresh();
    TaskStatusText->SetText(LOCTEXT("TasksDisconnected", "Connectez un compte pour charger les tâches."));
    ConnectionStatusText->SetText(LOCTEXT(
        "Disconnecting",
        "Compte déconnecté localement. Révocation du jeton sur le serveur…"));
    return FReply::Handled();
}

FReply SCyTaskPanel::RefreshProjectsClicked()
{
    RefreshProjects();
    return FReply::Handled();
}

void SCyTaskPanel::RefreshProjects()
{
    if (!ApiClient->HasAccessToken())
    {
        TaskStatusText->SetText(LOCTEXT("ProjectsNeedAccount", "Connectez d'abord un compte CyTask."));
        return;
    }

    TaskStatusText->SetText(LOCTEXT("LoadingProjects", "Chargement des projets…"));
    const TWeakPtr<SCyTaskPanel> WeakPanel = StaticCastSharedRef<SCyTaskPanel>(AsShared());
    ApiClient->ListProjects(
        [WeakPanel](const FCyTaskProjectsResult& Result)
        {
            const FCyTaskProjectsResult ResultCopy = Result;
            AsyncTask(ENamedThreads::GameThread, [WeakPanel, ResultCopy]()
            {
                const TSharedPtr<SCyTaskPanel> Panel = WeakPanel.Pin();
                if (!Panel.IsValid())
                {
                    return;
                }
                if (!ResultCopy.bSucceeded)
                {
                    Panel->TaskStatusText->SetText(FText::FromString(ResultCopy.Message));
                    return;
                }

                Panel->ProjectOptions.Reset(ResultCopy.Projects.Num());
                for (const FCyTaskProjectSummary& Project : ResultCopy.Projects)
                {
                    Panel->ProjectOptions.Add(MakeShared<FCyTaskProjectSummary>(Project));
                }
                Panel->ProjectComboBox->RefreshOptions();
                if (Panel->ProjectOptions.Num() == 0)
                {
                    Panel->SelectedProject.Reset();
                    Panel->TaskItems.Reset();
                    Panel->ProjectComboBox->ClearSelection();
                    Panel->SelectedProjectText->SetText(LOCTEXT("NoProjects", "Aucun projet"));
                    Panel->TaskListView->RequestListRefresh();
                    Panel->TaskStatusText->SetText(LOCTEXT("NoProjectsMessage", "Aucun projet disponible."));
                    return;
                }

                Panel->ProjectComboBox->SetSelectedItem(Panel->ProjectOptions[0]);
            });
        });
}

void SCyTaskPanel::OnProjectSelected(
    TSharedPtr<FCyTaskProjectSummary> Project,
    ESelectInfo::Type SelectionType)
{
    SelectedProject = MoveTemp(Project);
    if (!SelectedProject.IsValid())
    {
        SelectedProjectText->SetText(LOCTEXT("NoProjectSelection", "Aucun projet"));
        return;
    }

    SelectedProjectText->SetText(FText::FromString(
        FString::Printf(TEXT("%s — %s"), *SelectedProject->Key, *SelectedProject->Name)));
    LoadSelectedProjectTasks();
}

TSharedRef<SWidget> SCyTaskPanel::GenerateProjectWidget(
    TSharedPtr<FCyTaskProjectSummary> Project) const
{
    const FString Label = Project.IsValid()
        ? FString::Printf(TEXT("%s — %s"), *Project->Key, *Project->Name)
        : FString(TEXT("Projet invalide"));
    return SNew(STextBlock).Text(FText::FromString(Label));
}

void SCyTaskPanel::LoadSelectedProjectTasks()
{
    if (!SelectedProject.IsValid())
    {
        return;
    }

    const FString RequestedProjectId = SelectedProject->Id;
    TaskStatusText->SetText(LOCTEXT("LoadingTasks", "Chargement des tâches…"));
    const TWeakPtr<SCyTaskPanel> WeakPanel = StaticCastSharedRef<SCyTaskPanel>(AsShared());
    ApiClient->ListTasks(
        RequestedProjectId,
        [WeakPanel, RequestedProjectId](const FCyTaskWorkItemsResult& Result)
        {
            const FCyTaskWorkItemsResult ResultCopy = Result;
            AsyncTask(ENamedThreads::GameThread, [WeakPanel, RequestedProjectId, ResultCopy]()
            {
                const TSharedPtr<SCyTaskPanel> Panel = WeakPanel.Pin();
                if (!Panel.IsValid() || !Panel->SelectedProject.IsValid()
                    || Panel->SelectedProject->Id != RequestedProjectId)
                {
                    return;
                }
                if (!ResultCopy.bSucceeded)
                {
                    Panel->TaskStatusText->SetText(FText::FromString(ResultCopy.Message));
                    return;
                }

                Panel->TaskItems.Reset(ResultCopy.Tasks.Num());
                for (const FCyTaskWorkItemSummary& Task : ResultCopy.Tasks)
                {
                    Panel->TaskItems.Add(MakeShared<FCyTaskWorkItemSummary>(Task));
                }
                Panel->TaskListView->RequestListRefresh();
                Panel->TaskStatusText->SetText(FText::FromString(ResultCopy.Message));
            });
        });
}

TSharedRef<ITableRow> SCyTaskPanel::GenerateTaskRow(
    TSharedPtr<FCyTaskWorkItemSummary> Task,
    const TSharedRef<STableViewBase>& OwnerTable) const
{
    const FString Key = Task.IsValid() ? Task->Key : TEXT("?");
    const FString Title = Task.IsValid() ? Task->Title : TEXT("Tâche invalide");
    const FString Status = Task.IsValid() ? Task->Status : TEXT("unknown");
    return SNew(STableRow<TSharedPtr<FCyTaskWorkItemSummary>>, OwnerTable)
        .Padding(4.0f)
        [
            SNew(SHorizontalBox)
            + SHorizontalBox::Slot()
            .AutoWidth()
            .Padding(0.0f, 0.0f, 10.0f, 0.0f)
            [
                SNew(STextBlock)
                .Font(FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 10))
                .Text(FText::FromString(Key))
            ]
            + SHorizontalBox::Slot()
            .FillWidth(1.0f)
            [
                SNew(STextBlock)
                .AutoWrapText(true)
                .Text(FText::FromString(Title))
            ]
            + SHorizontalBox::Slot()
            .AutoWidth()
            .Padding(10.0f, 0.0f, 0.0f, 0.0f)
            [
                SNew(STextBlock)
                .Text(FText::FromString(Status))
            ]
        ];
}

FReply SCyTaskPanel::ValidateExampleRecipe()
{
    const FString Example = TEXT(R"CYTASK({
        "schemaVersion": 1,
        "recipeId": "0198c8c5-8129-7d0e-9673-8dd3ba16ed4b",
        "taskId": "0198c8c4-e1ff-7a63-b4e6-b8de8fdd293e",
        "revision": 1,
        "idempotencyKey": "0198c8c5-8129-7d0e-9673-8dd3ba16ed4b:1",
        "title": "Préparer un dossier",
        "engine": { "minimum": "4.27", "maximum": "5.8" },
        "steps": [{ "kind": "create-folder", "path": "/Game/CyTaskPreview" }]
    })CYTASK");

    FCyTaskAssetRecipe Recipe;
    FCyTaskAssetRecipeValidation Validation;
    const bool bValid = FCyTaskAssetRecipeParser::ParseAndValidate(Example, Recipe, Validation);
    RecipeStatusText->SetText(bValid
        ? FText::Format(
            LOCTEXT("RecipeValid", "Recette valide — {0} chemin affecté, aucune modification exécutée."),
            FText::AsNumber(Validation.AffectedPaths.Num()))
        : FText::FromString(FString::Join(Validation.Errors, TEXT("\n"))));
    return FReply::Handled();
}

#undef LOCTEXT_NAMESPACE
