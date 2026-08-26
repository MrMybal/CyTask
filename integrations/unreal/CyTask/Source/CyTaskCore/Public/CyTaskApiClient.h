#pragma once

#include "CoreMinimal.h"

class IHttpRequest;
class IHttpResponse;

struct CYTASKCORE_API FCyTaskConnectionResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    FString Message;
};

struct CYTASKCORE_API FCyTaskIdentityResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    FString UserId;
    FString DisplayName;
    FString Email;
    FString Role;
    FString Message;
};

struct CYTASKCORE_API FCyTaskProjectSummary
{
    FString Id;
    FString Name;
    FString Key;
};

struct CYTASKCORE_API FCyTaskWorkItemSummary
{
    FString Id;
    FString ProjectId;
    FString Key;
    FString Title;
    FString Status;
    TArray<FString> AssigneeIds;
};

struct CYTASKCORE_API FCyTaskProjectsResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    TArray<FCyTaskProjectSummary> Projects;
    FString Message;
};

struct CYTASKCORE_API FCyTaskWorkItemsResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    TArray<FCyTaskWorkItemSummary> Tasks;
    FString Message;
};

struct CYTASKCORE_API FCyTaskUnrealData
{
    FString EngineVersion;
    FString ProjectName;
    FString MapPath;
    TArray<FString> AssetPaths;
    TArray<FString> FilePaths;
    FString TargetPlatform;
    FString ReviewBuild;
    FString Notes;
};

struct CYTASKCORE_API FCyTaskUnrealDataResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    FCyTaskUnrealData Data;
    int64 Revision = 0;
    FString Message;
};

struct CYTASKCORE_API FCyTaskWorkItemResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    FCyTaskWorkItemSummary Task;
    FString Message;
};

struct CYTASKCORE_API FCyTaskUnrealHistoryEntry
{
    FCyTaskUnrealData Data;
    int64 Revision = 0;
    FString UpdatedBy;
    FString UpdatedAt;
};

struct CYTASKCORE_API FCyTaskUnrealHistoryResult
{
    bool bSucceeded = false;
    int32 StatusCode = 0;
    TArray<FCyTaskUnrealHistoryEntry> Entries;
    FString Message;
};

class CYTASKCORE_API FCyTaskApiClient : public TSharedFromThis<FCyTaskApiClient>
{
public:
    using FConnectionCallback = TFunction<void(const FCyTaskConnectionResult&)>;
    using FIdentityCallback = TFunction<void(const FCyTaskIdentityResult&)>;
    using FProjectsCallback = TFunction<void(const FCyTaskProjectsResult&)>;
    using FWorkItemsCallback = TFunction<void(const FCyTaskWorkItemsResult&)>;
    using FWorkItemCallback = TFunction<void(const FCyTaskWorkItemResult&)>;
    using FUnrealDataCallback = TFunction<void(const FCyTaskUnrealDataResult&)>;
    using FUnrealHistoryCallback = TFunction<void(const FCyTaskUnrealHistoryResult&)>;

    ~FCyTaskApiClient();

    bool SetServerUrl(const FString& Candidate, FString& OutError);
    const FString& GetServerUrl() const { return ServerUrl; }

    void CheckReady(FConnectionCallback Callback) const;
    void GetCurrentIdentity(FIdentityCallback Callback) const;
    void ListProjects(FProjectsCallback Callback) const;
    void ListTasks(const FString& ProjectId, FWorkItemsCallback Callback) const;
    void CreateTask(const FString& ProjectId, const FString& Title, const FString& Description,
        const FString& AssigneeId, FWorkItemCallback Callback) const;
    void GetUnrealTaskData(const FString& TaskId, FUnrealDataCallback Callback) const;
    void GetUnrealTaskHistory(const FString& TaskId, FUnrealHistoryCallback Callback) const;
    void UpdateUnrealTaskData(
        const FString& TaskId,
        const FCyTaskUnrealData& Data,
        int64 ExpectedRevision,
        FUnrealDataCallback Callback) const;
    void RevokeAccessToken(FConnectionCallback Callback);

    void SetAccessToken(FString InAccessToken);
    void ClearAccessToken();
    bool HasAccessToken() const { return !AccessToken.IsEmpty(); }

    static bool ValidateServerUrl(const FString& Candidate, FString& OutNormalized, FString& OutError);

private:
    FString ServerUrl;
    FString AccessToken;
};
