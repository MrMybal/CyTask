#include "CyTaskNativeAuthorization.h"

#include "Async/Async.h"
#include "CyTaskApiClient.h"
#include "Dom/JsonObject.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/Base64.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "SocketSubsystem.h"
#include "Sockets.h"

THIRD_PARTY_INCLUDES_START
#include <openssl/sha.h>
THIRD_PARTY_INCLUDES_END

namespace
{
    const TCHAR* CallbackPath = TEXT("/cytask/oauth/callback");

    void FillRandomBytes(uint8* Destination, int32 Length)
    {
        int32 Written = 0;
        while (Written < Length)
        {
            const FGuid Guid = FGuid::NewGuid();
            const int32 CopyLength = FMath::Min<int32>(sizeof(FGuid), Length - Written);
            FMemory::Memcpy(Destination + Written, &Guid, CopyLength);
            Written += CopyLength;
        }
    }

    void SecureReset(FString& Value)
    {
        if (Value.GetAllocatedSize() > 0)
        {
            FMemory::Memzero(Value.GetCharArray().GetData(), Value.GetAllocatedSize());
        }
        Value.Reset();
    }

    void ResetPkce(FCyTaskPkceMaterial& Material)
    {
        SecureReset(Material.Verifier);
        SecureReset(Material.Challenge);
        SecureReset(Material.State);
    }

    bool IsBase64Url(const FString& Value, int32 ExpectedLength)
    {
        if (Value.Len() != ExpectedLength)
        {
            return false;
        }
        for (const TCHAR Character : Value)
        {
            if (!FChar::IsAlnum(Character) && Character != TEXT('-') && Character != TEXT('_'))
            {
                return false;
            }
        }
        return true;
    }

    bool HasHeaderTerminator(const TArray<uint8>& Bytes)
    {
        for (int32 Index = 3; Index < Bytes.Num(); ++Index)
        {
            if (Bytes[Index - 3] == '\r' && Bytes[Index - 2] == '\n'
                && Bytes[Index - 1] == '\r' && Bytes[Index] == '\n')
            {
                return true;
            }
        }
        return false;
    }
}

FCyTaskNativeAuthorization::~FCyTaskNativeAuthorization()
{
    Cancel();
    CloseSockets();
}

FString FCyTaskNativeAuthorization::Base64Url(const uint8* Data, uint32 Length)
{
    FString Encoded = FBase64::Encode(Data, Length);
    Encoded.ReplaceInline(TEXT("+"), TEXT("-"), ESearchCase::CaseSensitive);
    Encoded.ReplaceInline(TEXT("/"), TEXT("_"), ESearchCase::CaseSensitive);
    while (Encoded.EndsWith(TEXT("=")))
    {
        Encoded = Encoded.LeftChop(1);
    }
    return Encoded;
}

bool FCyTaskNativeAuthorization::CreatePkceMaterial(FCyTaskPkceMaterial& OutMaterial)
{
    uint8 VerifierBytes[32];
    uint8 StateBytes[24];
    FillRandomBytes(VerifierBytes, UE_ARRAY_COUNT(VerifierBytes));
    FillRandomBytes(StateBytes, UE_ARRAY_COUNT(StateBytes));
    OutMaterial.Verifier = Base64Url(VerifierBytes, UE_ARRAY_COUNT(VerifierBytes));
    OutMaterial.State = Base64Url(StateBytes, UE_ARRAY_COUNT(StateBytes));
    FMemory::Memzero(VerifierBytes, sizeof(VerifierBytes));
    FMemory::Memzero(StateBytes, sizeof(StateBytes));

    if (!CreateCodeChallenge(OutMaterial.Verifier, OutMaterial.Challenge))
    {
        ResetPkce(OutMaterial);
        return false;
    }

    return IsBase64Url(OutMaterial.Verifier, 43)
        && IsBase64Url(OutMaterial.Challenge, 43)
        && IsBase64Url(OutMaterial.State, 32);
}

bool FCyTaskNativeAuthorization::CreateCodeChallenge(
    const FString& Verifier,
    FString& OutChallenge)
{
    const FTCHARToUTF8 VerifierUtf8(*Verifier);
    uint8 Digest[SHA256_DIGEST_LENGTH];
    if (::SHA256(
        reinterpret_cast<const unsigned char*>(VerifierUtf8.Get()),
        static_cast<size_t>(VerifierUtf8.Length()),
        Digest) == nullptr)
    {
        OutChallenge.Reset();
        return false;
    }
    OutChallenge = Base64Url(Digest, UE_ARRAY_COUNT(Digest));
    FMemory::Memzero(Digest, sizeof(Digest));
    return true;
}

bool FCyTaskNativeAuthorization::Start(
    const FString& InServerUrl,
    FCompletion InCompletion,
    FString& OutError)
{
    if (ListenSocket != nullptr || TokenRequest.IsValid() || Completion)
    {
        OutError = TEXT("Une autorisation CyTask est déjà en cours.");
        return false;
    }

    if (!FCyTaskApiClient::ValidateServerUrl(InServerUrl, ServerUrl, OutError))
    {
        return false;
    }
    if (!CreatePkceMaterial(Pkce))
    {
        OutError = TEXT("Impossible de générer la preuve PKCE.");
        return false;
    }
    if (!StartLoopbackListener(OutError))
    {
        ResetPkce(Pkce);
        return false;
    }

    Completion = MoveTemp(InCompletion);
    bCancelRequested = false;
    bFinished = false;

    const FString AuthorizationUrl = ServerUrl
        + TEXT("/authorize?response_type=code&client_id=cytask-unreal&redirect_uri=")
        + FGenericPlatformHttp::UrlEncode(RedirectUri)
        + TEXT("&code_challenge=") + FGenericPlatformHttp::UrlEncode(Pkce.Challenge)
        + TEXT("&code_challenge_method=S256&state=") + FGenericPlatformHttp::UrlEncode(Pkce.State);
    FString LaunchError;
    FPlatformProcess::LaunchURL(*AuthorizationUrl, nullptr, &LaunchError);
    if (!LaunchError.IsEmpty())
    {
        CloseSockets();
        Completion = nullptr;
        ResetPkce(Pkce);
        OutError = TEXT("Impossible d'ouvrir le navigateur système : ") + LaunchError;
        return false;
    }

    const TSharedRef<FCyTaskNativeAuthorization> Self = AsShared();
    Async(EAsyncExecution::ThreadPool, [Self]() { Self->WaitForCallback(); });
    OutError.Reset();
    return true;
}

bool FCyTaskNativeAuthorization::StartLoopbackListener(FString& OutError)
{
    ISocketSubsystem* SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
    if (SocketSubsystem == nullptr)
    {
        OutError = TEXT("Sous-système réseau Unreal indisponible.");
        return false;
    }

    ListenSocket = SocketSubsystem->CreateSocket(NAME_Stream, TEXT("CyTask OAuth loopback"));
    if (ListenSocket == nullptr)
    {
        OutError = TEXT("Impossible de créer le listener OAuth local.");
        return false;
    }

    const TSharedRef<FInternetAddr> Address = SocketSubsystem->CreateInternetAddr();
    bool bAddressValid = false;
    Address->SetIp(TEXT("127.0.0.1"), bAddressValid);
    Address->SetPort(0);
    if (!bAddressValid || !ListenSocket->Bind(*Address) || !ListenSocket->Listen(1))
    {
        OutError = TEXT("Impossible d'écouter sur la boucle locale.");
        CloseSockets();
        return false;
    }

    const int32 Port = ListenSocket->GetPortNo();
    if (Port <= 0)
    {
        OutError = TEXT("Le système n'a pas attribué de port local.");
        CloseSockets();
        return false;
    }
    RedirectUri = FString::Printf(TEXT("http://127.0.0.1:%d%s"), Port, CallbackPath);
    return true;
}

void FCyTaskNativeAuthorization::WaitForCallback()
{
    ISocketSubsystem* SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
    const double Deadline = FPlatformTime::Seconds() + 120.0;
    while (!bCancelRequested && ListenSocket != nullptr && FPlatformTime::Seconds() < Deadline)
    {
        bool bPending = false;
        if (!ListenSocket->WaitForPendingConnection(bPending, FTimespan::FromMilliseconds(250)) || !bPending)
        {
            continue;
        }

        FSocket* Client = ListenSocket->Accept(TEXT("CyTask OAuth callback"));
        if (Client == nullptr)
        {
            continue;
        }

        TArray<uint8> Bytes;
        const double ReadDeadline = FPlatformTime::Seconds() + 3.0;
        while (Bytes.Num() < 8192 && FPlatformTime::Seconds() < ReadDeadline)
        {
            if (!Client->Wait(ESocketWaitConditions::WaitForRead, FTimespan::FromMilliseconds(250)))
            {
                continue;
            }
            uint8 Buffer[2048];
            int32 Read = 0;
            if (!Client->Recv(Buffer, UE_ARRAY_COUNT(Buffer), Read) || Read <= 0)
            {
                break;
            }
            Bytes.Append(Buffer, Read);
            if (HasHeaderTerminator(Bytes))
            {
                break;
            }
        }

        Bytes.Add(0);
        const FString RequestText = UTF8_TO_TCHAR(reinterpret_cast<const char*>(Bytes.GetData()));
        FString Code;
        const bool bValid = TryParseCallbackRequest(RequestText, Pkce.State, Code);
        SendBrowserResponse(Client, bValid);
        Client->Close();
        SocketSubsystem->DestroySocket(Client);

        if (bValid)
        {
            CloseSockets();
            const TSharedRef<FCyTaskNativeAuthorization> Self = AsShared();
            AsyncTask(ENamedThreads::GameThread, [Self, Code]() { Self->ExchangeCode(Code); });
            return;
        }
    }

    CloseSockets();
    if (!bCancelRequested)
    {
        const TSharedRef<FCyTaskNativeAuthorization> Self = AsShared();
        AsyncTask(ENamedThreads::GameThread, [Self]()
        {
            Self->Complete({ false, {}, 0, TEXT("L'autorisation a expiré.") });
        });
    }
}

bool FCyTaskNativeAuthorization::TryParseCallbackRequest(
    const FString& RequestText,
    const FString& ExpectedState,
    FString& OutCode)
{
    FString RequestLine;
    if (!RequestText.Split(TEXT("\r\n"), &RequestLine, nullptr))
    {
        return false;
    }

    TArray<FString> Parts;
    RequestLine.ParseIntoArrayWS(Parts);
    if (Parts.Num() != 3 || Parts[0] != TEXT("GET") || !Parts[2].StartsWith(TEXT("HTTP/1.")))
    {
        return false;
    }

    FString Path;
    FString Query;
    if (!Parts[1].Split(TEXT("?"), &Path, &Query) || Path != CallbackPath)
    {
        return false;
    }

    FString Code;
    FString State;
    bool bSawCode = false;
    bool bSawState = false;
    TArray<FString> Parameters;
    Query.ParseIntoArray(Parameters, TEXT("&"), false);
    for (const FString& Parameter : Parameters)
    {
        FString Key;
        FString Value;
        if (!Parameter.Split(TEXT("="), &Key, &Value))
        {
            return false;
        }
        Key = FGenericPlatformHttp::UrlDecode(Key);
        Value = FGenericPlatformHttp::UrlDecode(Value);
        if (Key == TEXT("code"))
        {
            if (bSawCode)
            {
                return false;
            }
            bSawCode = true;
            Code = MoveTemp(Value);
        }
        else if (Key == TEXT("state"))
        {
            if (bSawState)
            {
                return false;
            }
            bSawState = true;
            State = MoveTemp(Value);
        }
    }

    if (!bSawCode || !bSawState || !IsBase64Url(Code, 43) || State != ExpectedState)
    {
        return false;
    }
    OutCode = MoveTemp(Code);
    return true;
}

void FCyTaskNativeAuthorization::SendBrowserResponse(FSocket* Socket, bool bSucceeded)
{
    const FString Body = bSucceeded
        ? TEXT("<!doctype html><meta charset=utf-8><title>CyTask</title><h1>CyTask connected</h1><p>You can return to Unreal Engine.</p>")
        : TEXT("<!doctype html><meta charset=utf-8><title>CyTask</title><h1>Invalid callback</h1><p>Return to Unreal Engine and retry.</p>");
    const FTCHARToUTF8 BodyUtf8(*Body);
    const FString Headers = FString::Printf(
        TEXT("HTTP/1.1 %s\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: %d\r\n\r\n"),
        bSucceeded ? TEXT("200 OK") : TEXT("400 Bad Request"),
        BodyUtf8.Length());
    const FTCHARToUTF8 HeadersUtf8(*Headers);

    TArray<uint8> Payload;
    Payload.Append(reinterpret_cast<const uint8*>(HeadersUtf8.Get()), HeadersUtf8.Length());
    Payload.Append(reinterpret_cast<const uint8*>(BodyUtf8.Get()), BodyUtf8.Length());
    int32 SentTotal = 0;
    while (SentTotal < Payload.Num())
    {
        int32 Sent = 0;
        if (!Socket->Send(Payload.GetData() + SentTotal, Payload.Num() - SentTotal, Sent) || Sent <= 0)
        {
            break;
        }
        SentTotal += Sent;
    }
}

void FCyTaskNativeAuthorization::ExchangeCode(const FString& Code)
{
    if (bCancelRequested)
    {
        return;
    }

    TokenRequest = FHttpModule::Get().CreateRequest();
    TokenRequest->SetVerb(TEXT("POST"));
    TokenRequest->SetURL(ServerUrl + TEXT("/api/v1/oauth/token"));
    TokenRequest->SetHeader(TEXT("Accept"), TEXT("application/json"));
    TokenRequest->SetHeader(TEXT("Content-Type"), TEXT("application/x-www-form-urlencoded"));
    TokenRequest->SetContentAsString(
        TEXT("grant_type=authorization_code&client_id=cytask-unreal&code=")
        + FGenericPlatformHttp::UrlEncode(Code)
        + TEXT("&redirect_uri=") + FGenericPlatformHttp::UrlEncode(RedirectUri)
        + TEXT("&code_verifier=") + FGenericPlatformHttp::UrlEncode(Pkce.Verifier));

    const TWeakPtr<FCyTaskNativeAuthorization> WeakAuthorization = AsShared();
    TokenRequest->OnProcessRequestComplete().BindLambda(
        [WeakAuthorization](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
        {
            const TSharedPtr<FCyTaskNativeAuthorization> Authorization = WeakAuthorization.Pin();
            if (!Authorization.IsValid() || Authorization->bCancelRequested)
            {
                return;
            }

            const int32 StatusCode = Response.IsValid() ? Response->GetResponseCode() : 0;
            if (!bConnectedSuccessfully || StatusCode < 200 || StatusCode >= 300)
            {
                Authorization->Complete({
                    false, {}, 0,
                    StatusCode > 0
                        ? FString::Printf(TEXT("Échange PKCE refusé (HTTP %d)."), StatusCode)
                        : TEXT("Échange PKCE impossible.")
                });
                return;
            }

            TSharedPtr<FJsonObject> Json;
            const TSharedRef<TJsonReader<>> Reader =
                TJsonReaderFactory<>::Create(Response->GetContentAsString());
            FString AccessToken;
            double ExpiresIn = 0;
            if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid()
                || !Json->TryGetStringField(TEXT("access_token"), AccessToken)
                || !Json->TryGetNumberField(TEXT("expires_in"), ExpiresIn)
                || !AccessToken.StartsWith(TEXT("cyt_at_"))
                || !IsBase64Url(AccessToken.Mid(7), 43)
                || ExpiresIn < 1 || ExpiresIn > 86400)
            {
                Authorization->Complete({ false, {}, 0, TEXT("Réponse de jeton CyTask invalide.") });
                return;
            }

            Authorization->Complete({
                true,
                MoveTemp(AccessToken),
                static_cast<int32>(ExpiresIn),
                TEXT("Compte CyTask connecté.")
            });
        });

    if (!TokenRequest->ProcessRequest())
    {
        TokenRequest.Reset();
        Complete({ false, {}, 0, TEXT("La requête d'échange PKCE n'a pas pu démarrer.") });
    }
}

void FCyTaskNativeAuthorization::Complete(FCyTaskNativeAuthorizationResult Result)
{
    if (bFinished || bCancelRequested)
    {
        return;
    }
    bFinished = true;
    TokenRequest.Reset();
    ResetPkce(Pkce);
    RedirectUri.Reset();
    if (Completion)
    {
        FCompletion Callback = MoveTemp(Completion);
        Callback(Result);
    }
}

void FCyTaskNativeAuthorization::Cancel()
{
    bCancelRequested = true;
    if (TokenRequest.IsValid())
    {
        TokenRequest->CancelRequest();
        TokenRequest.Reset();
    }
    Completion = nullptr;
    ResetPkce(Pkce);
}

void FCyTaskNativeAuthorization::CloseSockets()
{
    if (ListenSocket == nullptr)
    {
        return;
    }
    ListenSocket->Close();
    if (ISocketSubsystem* SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM))
    {
        SocketSubsystem->DestroySocket(ListenSocket);
    }
    ListenSocket = nullptr;
}
