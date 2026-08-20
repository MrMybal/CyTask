#pragma once

#include "CoreMinimal.h"
#include "CyTaskApiClient.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Views/SListView.h"

class FCyTaskNativeAuthorization;
class SEditableTextBox;
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
    FReply ValidateExampleRecipe();
    void RefreshProjects();
    void LoadSelectedProjectTasks();
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
    TSharedPtr<SListView<TSharedPtr<FCyTaskWorkItemSummary>>> TaskListView;
    TSharedPtr<STextBlock> TaskStatusText;
    TSharedPtr<STextBlock> RecipeStatusText;
    bool bAuthorizationPending = false;
};
