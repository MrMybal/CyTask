#include "CyTaskApiClient.h"

#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
    void SecureReset(FString& Value)
    {
        if (Value.GetAllocatedSize() > 0)
        {
            FMemory::Memzero(Value.GetCharArray().GetData(), Value.GetAllocatedSize());
        }
        Value.Reset();
    }

    bool IsLoopbackAuthority(const FString& Authority)
    {
        return Authority.Equals(TEXT("localhost"), ESearchCase::IgnoreCase)
            || Authority.StartsWith(TEXT("localhost:"), ESearchCase::IgnoreCase)
            || Authority == TEXT("127.0.0.1")
            || Authority.StartsWith(TEXT("127.0.0.1:"))
            || Authority == TEXT("[::1]")
            || Authority.StartsWith(TEXT("[::1]:"));
    }

    bool IsGuid(const FString& Value)
    {
        FGuid Parsed;
        return FGuid::Parse(Value, Parsed);
    }

    bool HasExpectedStatus(const FString& Status)
    {
        return Status == TEXT("todo") || Status == TEXT("in_progress")
            || Status == TEXT("blocked") || Status == TEXT("done")
            || Status == TEXT("cancelled");
    }
}

FCyTaskApiClient::~FCyTaskApiClient()
{
    ClearAccessToken();
}

void FCyTaskApiClient::SetAccessToken(FString InAccessToken)
{
    ClearAccessToken();
    AccessToken = MoveTemp(InAccessToken);
}

void FCyTaskApiClient::ClearAccessToken()
{
    SecureReset(AccessToken);
}

bool FCyTaskApiClient::ValidateServerUrl(
    const FString& Candidate,
    FString& OutNormalized,
    FString& OutError)
{
    FString Value = Candidate.TrimStartAndEnd();
    while (Value.EndsWith(TEXT("/")))
    {
        Value = Value.LeftChop(1);
    }

    if (Value.IsEmpty())
    {
        OutError = TEXT("L'adresse du serveur est obligatoire.");
        return false;
    }

    for (const TCHAR Character : Value)
    {
        if (Character < TEXT(' '))
        {
            OutError = TEXT("L'adresse contient un caractère de contrôle interdit.");
            return false;
        }
    }

    const int32 SchemeEnd = Value.Find(TEXT("://"));
    if (SchemeEnd == INDEX_NONE)
    {
        OutError = TEXT("L'adresse doit utiliser HTTPS.");
        return false;
    }

    const FString Scheme = Value.Left(SchemeEnd);
    const FString AuthorityAndPath = SchemeEnd == INDEX_NONE ? Value : Value.Mid(SchemeEnd + 3);
    FString Authority;
    if (!AuthorityAndPath.Split(TEXT("/"), &Authority, nullptr))
    {
        Authority = AuthorityAndPath;
    }

    if (Authority.IsEmpty() || Authority.Contains(TEXT("@")) || Authority.Contains(TEXT("%"))
        || Authority.Contains(TEXT(" ")) || Authority.Contains(TEXT("\t")))
    {
        OutError = TEXT("L'adresse ne doit contenir ni identifiants ni autorité vide.");
        return false;
    }

    const bool bHttps = Scheme.Equals(TEXT("https"), ESearchCase::IgnoreCase);
    const bool bLoopbackHttp = Scheme.Equals(TEXT("http"), ESearchCase::IgnoreCase)
        && IsLoopbackAuthority(Authority);
    if (!bHttps && !bLoopbackHttp)
    {
        OutError = TEXT("HTTPS est obligatoire hors boucle locale.");
        return false;
    }

    if (Value.Contains(TEXT("?")) || Value.Contains(TEXT("#")) || Value.Contains(TEXT("\\")))
    {
        OutError = TEXT("Paramètres, fragments et antislashs sont interdits dans l'adresse serveur.");
        return false;
    }

    OutNormalized = MoveTemp(Value);
    OutError.Reset();
    return true;
}

bool FCyTaskApiClient::SetServerUrl(const FString& Candidate, FString& OutError)
{
    FString Normalized;
    if (!ValidateServerUrl(Candidate, Normalized, OutError))
    {
        return false;
    }

    ServerUrl = MoveTemp(Normalized);
    return true;
}

void FCyTaskApiClient::CheckReady(FConnectionCallback Callback) const
{
    if (ServerUrl.IsEmpty())
    {
        Callback({ false, 0, TEXT("Configurez d'abord l'adresse du serveur.") });
        return;
    }

    const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("GET"));
    Request->SetURL(ServerUrl + TEXT("/health/ready"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->OnProcessRequestComplete().BindLambda(
        [Callback](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
        {
            FCyTaskConnectionResult Result;
            Result.StatusCode = Response.IsValid() ? Response->GetResponseCode() : 0;
            Result.bSucceeded = bConnectedSuccessfully && Result.StatusCode >= 200 && Result.StatusCode < 300;
            Result.Message = Result.bSucceeded
                ? TEXT("Serveur CyTask prêt.")
                : Result.StatusCode > 0
                    ? FString::Printf(TEXT("Le serveur a répondu avec le code HTTP %d."), Result.StatusCode)
                    : TEXT("Connexion au serveur impossible.");
            Callback(Result);
        });

    if (!Request->ProcessRequest())
    {
        Callback({ false, 0, TEXT("La requête HTTP n'a pas pu être démarrée.") });
    }
}

void FCyTaskApiClient::GetCurrentIdentity(FIdentityCallback Callback) const
{
    if (ServerUrl.IsEmpty() || AccessToken.IsEmpty())
    {
        Callback({ false, 0, {}, {}, {}, TEXT("Compte CyTask non connecté.") });
        return;
    }

    const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("GET"));
    Request->SetURL(ServerUrl + TEXT("/api/v1/me"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + AccessToken);
    Request->OnProcessRequestComplete().BindLambda(
        [Callback](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
        {
            FCyTaskIdentityResult Result;
            Result.StatusCode = Response.IsValid() ? Response->GetResponseCode() : 0;
            if (!bConnectedSuccessfully || Result.StatusCode < 200 || Result.StatusCode >= 300)
            {
                Result.Message = Result.StatusCode > 0
                    ? FString::Printf(TEXT("Identité refusée (HTTP %d)."), Result.StatusCode)
                    : TEXT("Connexion au serveur impossible.");
                Callback(Result);
                return;
            }

            TSharedPtr<FJsonObject> Json;
            const TSharedRef<TJsonReader<>> Reader =
                TJsonReaderFactory<>::Create(Response->GetContentAsString());
            if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid()
                || !Json->TryGetStringField(TEXT("displayName"), Result.DisplayName)
                || !Json->TryGetStringField(TEXT("email"), Result.Email)
                || !Json->TryGetStringField(TEXT("role"), Result.Role))
            {
                Result.Message = TEXT("Réponse d'identité CyTask invalide.");
                Callback(Result);
                return;
            }

            Result.bSucceeded = true;
            Result.Message = FString::Printf(
                TEXT("Connecté en tant que %s (%s)."), *Result.DisplayName, *Result.Role);
            Callback(Result);
        });

    if (!Request->ProcessRequest())
    {
        Callback({ false, 0, {}, {}, {}, TEXT("La requête d'identité n'a pas pu être démarrée.") });
    }
}

void FCyTaskApiClient::ListProjects(FProjectsCallback Callback) const
{
    if (ServerUrl.IsEmpty() || AccessToken.IsEmpty())
    {
        Callback({ false, 0, {}, TEXT("Compte CyTask non connecté.") });
        return;
    }

    const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("GET"));
    Request->SetURL(ServerUrl + TEXT("/api/v1/projects"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + AccessToken);
    Request->OnProcessRequestComplete().BindLambda(
        [Callback](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
        {
            FCyTaskProjectsResult Result;
            Result.StatusCode = Response.IsValid() ? Response->GetResponseCode() : 0;
            if (!bConnectedSuccessfully || Result.StatusCode < 200 || Result.StatusCode >= 300)
            {
                Result.Message = Result.StatusCode > 0
                    ? FString::Printf(TEXT("Chargement des projets refusé (HTTP %d)."), Result.StatusCode)
                    : TEXT("Connexion au serveur impossible.");
                Callback(Result);
                return;
            }

            TArray<TSharedPtr<FJsonValue>> JsonProjects;
            const TSharedRef<TJsonReader<>> Reader =
                TJsonReaderFactory<>::Create(Response->GetContentAsString());
            if (!FJsonSerializer::Deserialize(Reader, JsonProjects))
            {
                Result.Message = TEXT("Réponse de projets CyTask invalide.");
                Callback(Result);
                return;
            }

            Result.Projects.Reserve(JsonProjects.Num());
            for (const TSharedPtr<FJsonValue>& JsonValue : JsonProjects)
            {
                const TSharedPtr<FJsonObject> Json = JsonValue.IsValid() ? JsonValue->AsObject() : nullptr;
                FCyTaskProjectSummary Project;
                if (!Json.IsValid()
                    || !Json->TryGetStringField(TEXT("id"), Project.Id)
                    || !Json->TryGetStringField(TEXT("name"), Project.Name)
                    || !Json->TryGetStringField(TEXT("key"), Project.Key)
                    || !IsGuid(Project.Id) || Project.Name.IsEmpty() || Project.Key.IsEmpty())
                {
                    Result.Projects.Reset();
                    Result.Message = TEXT("Un projet reçu du serveur est invalide.");
                    Callback(Result);
                    return;
                }
                Result.Projects.Add(MoveTemp(Project));
            }

            Result.bSucceeded = true;
            Result.Message = FString::Printf(TEXT("%d projet(s) chargé(s)."), Result.Projects.Num());
            Callback(Result);
        });

    if (!Request->ProcessRequest())
    {
        Callback({ false, 0, {}, TEXT("La requête de projets n'a pas pu être démarrée.") });
    }
}

void FCyTaskApiClient::ListTasks(const FString& ProjectId, FWorkItemsCallback Callback) const
{
    if (ServerUrl.IsEmpty() || AccessToken.IsEmpty() || !IsGuid(ProjectId))
    {
        Callback({ false, 0, {}, TEXT("Projet invalide ou compte CyTask non connecté.") });
        return;
    }

    const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("GET"));
    Request->SetURL(ServerUrl + TEXT("/api/v1/projects/") + ProjectId + TEXT("/tasks"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + AccessToken);
    Request->OnProcessRequestComplete().BindLambda(
        [Callback](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
        {
            FCyTaskWorkItemsResult Result;
            Result.StatusCode = Response.IsValid() ? Response->GetResponseCode() : 0;
            if (!bConnectedSuccessfully || Result.StatusCode < 200 || Result.StatusCode >= 300)
            {
                Result.Message = Result.StatusCode > 0
                    ? FString::Printf(TEXT("Chargement des tâches refusé (HTTP %d)."), Result.StatusCode)
                    : TEXT("Connexion au serveur impossible.");
                Callback(Result);
                return;
            }

            TArray<TSharedPtr<FJsonValue>> JsonTasks;
            const TSharedRef<TJsonReader<>> Reader =
                TJsonReaderFactory<>::Create(Response->GetContentAsString());
            if (!FJsonSerializer::Deserialize(Reader, JsonTasks))
            {
                Result.Message = TEXT("Réponse de tâches CyTask invalide.");
                Callback(Result);
                return;
            }

            Result.Tasks.Reserve(JsonTasks.Num());
            for (const TSharedPtr<FJsonValue>& JsonValue : JsonTasks)
            {
                const TSharedPtr<FJsonObject> Json = JsonValue.IsValid() ? JsonValue->AsObject() : nullptr;
                FCyTaskWorkItemSummary Task;
                if (!Json.IsValid()
                    || !Json->TryGetStringField(TEXT("id"), Task.Id)
                    || !Json->TryGetStringField(TEXT("projectId"), Task.ProjectId)
                    || !Json->TryGetStringField(TEXT("key"), Task.Key)
                    || !Json->TryGetStringField(TEXT("title"), Task.Title)
                    || !Json->TryGetStringField(TEXT("status"), Task.Status)
                    || !IsGuid(Task.Id) || !IsGuid(Task.ProjectId)
                    || Task.Key.IsEmpty() || Task.Title.IsEmpty() || !HasExpectedStatus(Task.Status))
                {
                    Result.Tasks.Reset();
                    Result.Message = TEXT("Une tâche reçue du serveur est invalide.");
                    Callback(Result);
                    return;
                }
                Result.Tasks.Add(MoveTemp(Task));
            }

            Result.bSucceeded = true;
            Result.Message = FString::Printf(TEXT("%d tâche(s) chargée(s)."), Result.Tasks.Num());
            Callback(Result);
        });

    if (!Request->ProcessRequest())
    {
        Callback({ false, 0, {}, TEXT("La requête de tâches n'a pas pu être démarrée.") });
    }
}

void FCyTaskApiClient::RevokeAccessToken(FConnectionCallback Callback)
{
    if (ServerUrl.IsEmpty() || AccessToken.IsEmpty())
    {
        ClearAccessToken();
        Callback({ true, 0, TEXT("Aucun jeton CyTask actif.") });
        return;
    }

    const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("DELETE"));
    Request->SetURL(ServerUrl + TEXT("/api/v1/oauth/token"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + AccessToken);
    ClearAccessToken();
    Request->OnProcessRequestComplete().BindLambda(
        [Callback](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
        {
            FCyTaskConnectionResult Result;
            Result.StatusCode = Response.IsValid() ? Response->GetResponseCode() : 0;
            Result.bSucceeded = bConnectedSuccessfully
                && Result.StatusCode >= 200 && Result.StatusCode < 300;
            Result.Message = Result.bSucceeded
                ? TEXT("Jeton CyTask révoqué sur le serveur.")
                : Result.StatusCode > 0
                    ? FString::Printf(TEXT("Révocation refusée (HTTP %d). Le jeton local a été effacé."), Result.StatusCode)
                    : TEXT("Serveur injoignable. Le jeton local a été effacé.");
            Callback(Result);
        });

    if (!Request->ProcessRequest())
    {
        Callback({ false, 0, TEXT("Révocation non démarrée. Le jeton local a été effacé.") });
    }
}
