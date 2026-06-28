import React from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import JSZip from 'jszip';
import type { PdfReportData } from '@/components/pdf/ServiceRecordDocument';

type PdfEntry = {
  data: PdfReportData;
  fileName: string;
};

const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export async function downloadReportZip(entries: PdfEntry[], zipBaseName: string): Promise<void> {
  if (entries.length === 0) return;

  const [{ pdf }, { ServiceRecordDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/pdf/ServiceRecordDocument'),
  ]);

  if (entries.length === 1) {
    const document = React.createElement(ServiceRecordDocument, { reports: [entries[0].data] }) as React.ReactElement<DocumentProps>;
    const blob = await pdf(document).toBlob();
    triggerDownload(blob, entries[0].fileName);
    return;
  }

  const zip = new JSZip();
  for (const entry of entries) {
    const document = React.createElement(ServiceRecordDocument, { reports: [entry.data] }) as React.ReactElement<DocumentProps>;
    const blob = await pdf(document).toBlob();
    zip.file(entry.fileName, blob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, `${zipBaseName}.zip`);
}

export function buildReportFileName(
  clientName: string,
  serviceTypeName: string | null,
  startAt: string,
  endAt: string
): string {
  const dateStr = new Date(startAt).toISOString().slice(0, 10).replace(/-/g, '');
  const startTime = formatTime(startAt);
  const endTime = formatTime(endAt);
  const typeLabel = serviceTypeName ? `_${serviceTypeName}` : '';
  return `${clientName}${typeLabel}_${dateStr}_${startTime}-${endTime}.pdf`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
