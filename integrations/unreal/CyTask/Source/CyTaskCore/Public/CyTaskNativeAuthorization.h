#pragma once

#include "CoreMinimal.h"
#include "HAL/ThreadSafeBool.h"

class FSocket;
class IHttpRequest;

struct CYTASKCORE_API FCyTaskPkceMaterial
{
    FString Verifier;
    FString Challenge;
    FString State;
};

struct CYTASKCORE_API FCyTaskNativeAuthorizationResult
{
    bool bSucceeded = false;
    FString AccessToken;
    int32 ExpiresInSeconds = 0;
    FString Message;
};

class CYTASKCORE_API FCyTaskNativeAuthorization :
    public TSharedFromThis<FCyTaskNativeAuthorization>
{
public:
    using FCompletion = TFunction<void(const FCyTaskNativeAuthorizationResult&)>;

    ~FCyTaskNativeAuthorization();

    bool Start(const FString& ServerUrl, FCompletion Completion, FString& OutError);
    void Cancel();

    static bool CreatePkceMaterial(FCyTaskPkceMaterial& OutMaterial);
    static bool CreateCodeChallenge(const FString& Verifier, FString& OutChallenge);
    static bool TryParseCallbackRequest(
        const FString& RequestText,
        const FString& ExpectedState,
        FString& OutCode);

private:
    bool StartLoopbackListener(FString& OutError);
    void WaitForCallback();
    void ExchangeCode(const FString& Code);
    void Complete(FCyTaskNativeAuthorizationResult Result);
    void CloseSockets();

    static FString Base64Url(const uint8* Data, uint32 Length);
    static void SendBrowserResponse(FSocket* Socket, bool bSucceeded);

    FString ServerUrl;
    FString RedirectUri;
    FCyTaskPkceMaterial Pkce;
    FCompletion Completion;
    FSocket* ListenSocket = nullptr;
    TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> TokenRequest;
    FThreadSafeBool bCancelRequested = false;
    bool bFinished = false;
};
