/** Owns both the temporary anchor and Object URL, including failed clicks. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser consume the click before releasing the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
