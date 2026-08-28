export {};

declare global {
  interface Window {
    cyAnnotaDesktop?: {
      chooseSaveFile(input: {
        name: string;
      }): Promise<{ canceled: boolean; token?: string }>;
      beginSaveFile(input: {
        token: string;
      }): Promise<{ started: boolean }>;
      writeSaveChunk(input: {
        token: string;
        base64: string;
      }): Promise<{ written: number }>;
      finishSaveFile(input: {
        token: string;
      }): Promise<{ saved: boolean; bytesWritten: number }>;
      abortSaveFile(input: {
        token: string;
      }): Promise<{ aborted: boolean }>;
      showErrorMessage(input: {
        title: string;
        message: string;
        detail: string;
      }): Promise<{ shown: boolean }>;
    };
  }
}