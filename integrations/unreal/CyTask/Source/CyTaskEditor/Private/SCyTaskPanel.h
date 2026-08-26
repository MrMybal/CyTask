#pragma once

#include "CoreMinimal.h"
#include "CyTaskApiClient.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Views/SListView.h"

class FCyTaskNativeAuthorization;
class SEditableTextBox;
class SMultiLineEditableTextBox;
class STextBlock;

class SCyTaskPanel final : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SCyTaskPanel) {}
    SLATE_END_ARGS()

    ~SCyTaskPanel();
    void Construct(const FArguments& InArgs);

private:
    FReply CheckConnection();
    FReply ConnectAccount();
    FReply DisconnectAccount();
    FReply RefreshProjectsClicked();
    FReply CaptureUnrealContext();
    FReply SaveUnrealContext();
    FReply ValidateExampleRecipe();
    void RefreshProjects();
    void LoadSelectedProjectTasks();
    void LoadSelectedTaskUnrealData();
    void OnTaskSelected(
        TSharedPtr<FCyTaskWorkItemSummary> Task,
        ESelectInfo::Type SelectionType);
    void OnProjectSelected(
        TSharedPtr<FCyTaskProjectSummary> Project,
        ESelectInfo::Type SelectionType);
    TSharedRef<SWidget> GenerateProjectWidget(
        TSharedPtr<FCyTaskProjectSummary> Project) const;
    TSharedRef<ITableRow> GenerateTaskRow(
        TSharedPtr<FCyTaskWorkItemSummary> Task,
        const TSharedRef<STableViewBase>& OwnerTable) const;

    TSharedPtr<FCyTaskApiClient> ApiClient;
    TSharedPtr<FCyTaskNativeAuthorization> NativeAuthorization;
    TSharedPtr<SEditableTextBox> ServerUrlTextBox;
    TSharedPtr<STextBlock> ConnectionStatusText;
    TArray<TSharedPtr<FCyTaskProjectSummary>> ProjectOptions;
    TSharedPtr<FCyTaskProjectSummary> SelectedProject;
    TSharedPtr<SComboBox<TSharedPtr<FCyTaskProjectSummary>>> ProjectComboBox;
    TSharedPtr<STextBlock> SelectedProjectText;
    TArray<TSharedPtr<FCyTaskWorkItemSummary>> TaskItems;
    TSharedPtr<FCyTaskWorkItemSummary> SelectedTask;
    TSharedPtr<SListView<TSharedPtr<FCyTaskWorkItemSummary>>> TaskListView;
    TSharedPtr<STextBlock> TaskStatusText;
    TSharedPtr<STextBlock> UnrealStatusText;
    TSharedPtr<SEditableTextBox> EngineVersionTextBox;
    TSharedPtr<SEditableTextBox> ProjectNameTextBox;
    TSharedPtr<SEditableTextBox> MapPathTextBox;
    TSharedPtr<SMultiLineEditableTextBox> AssetPathsTextBox;
    TSharedPtr<SEditableTextBox> TargetPlatformTextBox;
    TSharedPtr<SEditableTextBox> ReviewBuildTextBox;
    TSharedPtr<SMultiLineEditableTextBox> UnrealNotesTextBox;
    TSharedPtr<STextBlock> RecipeStatusText;
    int64 UnrealDataRevision = 0;
    bool bAuthorizationPending = false;
};
