/** 문자열을 파일로 내려받게 한다. 브라우저 전용(URL.createObjectURL). */
export function downloadTextFile(filename: string, text: string, mimeType = 'application/json'): void {
  const blob = new Blob([text], { type: mimeType });
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
