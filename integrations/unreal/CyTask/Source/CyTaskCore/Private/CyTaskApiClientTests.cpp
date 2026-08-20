#if WITH_DEV_AUTOMATION_TESTS

#include "CyTaskApiClient.h"
#include "CyTaskNativeAuthorization.h"
#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCyTaskServerUrlSecurityTest,
    "CyTask.Core.ServerUrl.Security",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCyTaskServerUrlSecurityTest::RunTest(const FString& Parameters)
{
    FString Normalized;
    FString Error;

    TestTrue(
        TEXT("HTTPS public accepté"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT(" https://tasks.example.org/ "), Normalized, Error));
    TestEqual(TEXT("URL normalisée"), Normalized, FString(TEXT("https://tasks.example.org")));

    TestTrue(
        TEXT("HTTP loopback accepté pour le développement"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT("http://127.0.0.1:5080"), Normalized, Error));
    TestFalse(
        TEXT("HTTP distant refusé"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT("http://tasks.example.org"), Normalized, Error));
    TestFalse(
        TEXT("Faux domaine localhost refusé"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT("http://localhost.evil.example"), Normalized, Error));
    TestFalse(
        TEXT("Fausse IPv4 loopback refusée"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT("http://127.0.0.1.evil.example"), Normalized, Error));
    TestFalse(
        TEXT("Identifiants dans l'URL refusés"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT("https://user:secret@tasks.example.org"), Normalized, Error));
    TestFalse(
        TEXT("Paramètres dans l'URL refusés"),
        FCyTaskApiClient::ValidateServerUrl(
            TEXT("https://tasks.example.org?token=secret"), Normalized, Error));

    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCyTaskPkceTest,
    "CyTask.Core.NativeAuthorization.PKCE",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCyTaskPkceTest::RunTest(const FString& Parameters)
{
    FString Challenge;
    TestTrue(
        TEXT("Vecteur PKCE calculable"),
        FCyTaskNativeAuthorization::CreateCodeChallenge(
            TEXT("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), Challenge));
    TestEqual(
        TEXT("Vecteur S256 RFC 7636"),
        Challenge,
        FString(TEXT("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")));

    FCyTaskPkceMaterial Material;
    TestTrue(TEXT("Matériel aléatoire généré"), FCyTaskNativeAuthorization::CreatePkceMaterial(Material));
    TestEqual(TEXT("Verifier sur 43 caractères"), Material.Verifier.Len(), 43);
    TestEqual(TEXT("Challenge sur 43 caractères"), Material.Challenge.Len(), 43);
    TestEqual(TEXT("State sur 32 caractères"), Material.State.Len(), 32);

    const FString Code = FString::ChrN(43, TEXT('C'));
    const FString State = FString::ChrN(32, TEXT('S'));
    const FString Request = FString::Printf(
        TEXT("GET /cytask/oauth/callback?code=%s&state=%s HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        *Code,
        *State);
    FString ParsedCode;
    TestTrue(
        TEXT("Callback exact accepté"),
        FCyTaskNativeAuthorization::TryParseCallbackRequest(Request, State, ParsedCode));
    TestEqual(TEXT("Code extrait"), ParsedCode, Code);
    TestFalse(
        TEXT("State incorrect refusé"),
        FCyTaskNativeAuthorization::TryParseCallbackRequest(
            Request, FString::ChrN(32, TEXT('X')), ParsedCode));
    TestFalse(
        TEXT("Chemin callback incorrect refusé"),
        FCyTaskNativeAuthorization::TryParseCallbackRequest(
            Request.Replace(TEXT("/cytask/oauth/callback"), TEXT("/other")), State, ParsedCode));
    return true;
}

#endif
