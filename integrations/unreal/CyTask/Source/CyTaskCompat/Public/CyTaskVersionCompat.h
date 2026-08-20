#pragma once

#include "Runtime/Launch/Resources/Version.h"

#define CYTASK_UE_VERSION_ENCODE(Major, Minor) (((Major) * 100) + (Minor))
#define CYTASK_UE_VERSION CYTASK_UE_VERSION_ENCODE(ENGINE_MAJOR_VERSION, ENGINE_MINOR_VERSION)
#define CYTASK_UE_VERSION_AT_LEAST(Major, Minor) \
    (CYTASK_UE_VERSION >= CYTASK_UE_VERSION_ENCODE((Major), (Minor)))

static_assert(
    CYTASK_UE_VERSION >= CYTASK_UE_VERSION_ENCODE(4, 27),
    "CyTask requires Unreal Engine 4.27 or newer.");

namespace CyTaskCompat
{
    inline bool IsSupportedEngineVersion()
    {
        return ENGINE_MAJOR_VERSION == 4
            ? ENGINE_MINOR_VERSION == 27
            : ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION <= 8;
    }

    inline FString GetEngineVersionLabel()
    {
        return FString::Printf(TEXT("%d.%d"), ENGINE_MAJOR_VERSION, ENGINE_MINOR_VERSION);
    }
}
