import { api, type ProjectResource } from "./api";
import { sha256 } from "./sha256";

export async function uploadProjectFile(
  projectId: string,
  folderLabelId: string | null,
  file: File,
  onProgress?: (label: string, percent: number) => void
): Promise<ProjectResource> {
  onProgress?.("Calcul de l’empreinte…", 0);
  const fingerprint = await sha256(file, (bytesRead) => {
    onProgress?.("Calcul de l’empreinte…", Math.round(bytesRead / file.size * 100));
  });
  const upload = await api.createResourceUpload(projectId, {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    sha256: fingerprint,
    folderLabelId
  });
  let sent = upload.chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
  let index = upload.chunks.length;
  while (sent < file.size) {
    const chunk = file.slice(sent, Math.min(sent + upload.chunkSizeBytes, file.size));
    await api.uploadResourceChunk(upload.id, index, chunk, await sha256(chunk));
    sent += chunk.size;
    index += 1;
    onProgress?.("Envoi sécurisé…", Math.round(sent / file.size * 100));
  }
  onProgress?.("Vérification serveur…", 100);
  return api.completeResourceUpload(upload.id);
}
