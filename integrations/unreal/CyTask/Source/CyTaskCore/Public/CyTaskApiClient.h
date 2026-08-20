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

class CYTASKCORE_API FCyTaskApiClient : public TSharedFromThis<FCyTaskApiClient>
{
public:
    using FConnectionCallback = TFunction<void(const FCyTaskConnectionResult&)>;
    using FIdentityCallback = TFunction<void(const FCyTaskIdentityResult&)>;
    using FProjectsCallback = TFunction<void(const FCyTaskProjectsResult&)>;
    using FWorkItemsCallback = TFunction<void(const FCyTaskWorkItemsResult&)>;

    ~FCyTaskApiClient();

    bool SetServerUrl(const FString& Candidate, FString& OutError);
    const FString& GetServerUrl() const { return ServerUrl; }

    void CheckReady(FConnectionCallback Callback) const;
    void GetCurrentIdentity(FIdentityCallback Callback) const;
    void ListProjects(FProjectsCallback Callback) const;
    void ListTasks(const FString& ProjectId, FWorkItemsCallback Callback) const;
    void RevokeAccessToken(FConnectionCallback Callback);

    void SetAccessToken(FString InAccessToken);
    void ClearAccessToken();
    bool HasAccessToken() const { return !AccessToken.IsEmpty(); }

    static bool ValidateServerUrl(const FString& Candidate, FString& OutNormalized, FString& OutError);

private:
    FString ServerUrl;
    FString AccessToken;
};
