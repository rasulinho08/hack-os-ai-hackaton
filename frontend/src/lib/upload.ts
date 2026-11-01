/**
 * One file sent to an upload endpoint as the raw request body (the API's
 * convention: Content-Type is the file's type, X-File-Name its name), with
 * the share already sent reported as it goes — fetch cannot tell that, so
 * this uses XMLHttpRequest.
 *
 * Resolves with the envelope's `data`; a refusal becomes an ApiError with
 * the API's code (FILE_TOO_LARGE, STORAGE_FULL…), like every other request.
 */

import { ApiError, type ApiFieldError } from "@/lib/api";

export function sendFile(url: string, blob: Blob, name: string, onProgress?: (fraction: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(name));
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onerror = () => reject(new ApiError("The upload did not reach the server.", 0));
    xhr.onabort = () => reject(new ApiError("The upload was stopped.", 0));
    xhr.onload = () => {
      let json: { success?: boolean; message?: string; data?: unknown; errors?: ApiFieldError[]; code?: string } | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = null;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !json?.success) {
        reject(new ApiError(json?.message || `Upload failed (${xhr.status})`, xhr.status, Array.isArray(json?.errors) ? json!.errors : [], json?.code, json?.message));
        return;
      }
      onProgress?.(1);
      resolve(json.data);
    };
    xhr.send(blob);
  });
}
