import { createElectronPlatform, type NativeApi } from './electron'
import type { Platform } from './types'
import { createWebPlatform } from './web'
import { createEmbeddedPlatform } from './embedded'

export function detectPlatform(): Platform {
  const api = (window as unknown as { cymdNative?: NativeApi }).cymdNative
  return api ? createElectronPlatform(api) : createEmbeddedPlatform() ?? createWebPlatform()
}

export type { Platform } from './types'
