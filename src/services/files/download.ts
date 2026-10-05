function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 문자열을 파일로 내려받게 한다. 브라우저 전용(URL.createObjectURL). */
export function downloadTextFile(filename: string, text: string, mimeType = 'application/json'): void {
  downloadBlob(filename, new Blob([text], { type: mimeType }));
}

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 바이트(xlsx 등 이진 산출물)를 파일로 내려받게 한다. */
export function downloadBinaryFile(filename: string, bytes: Uint8Array, mimeType = XLSX_MIME_TYPE): void {
  // `bytes`의 buffer 타입이 일반 ArrayBuffer인지 보장되지 않아(fflate의
  // zipSync 반환형) BlobPart에 바로 안 맞는다 — 고정 ArrayBuffer로 복사한다.
  downloadBlob(filename, new Blob([new Uint8Array(bytes)], { type: mimeType }));
}
