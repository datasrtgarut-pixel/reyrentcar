import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export interface ReportExportRow {
  [key: string]: string | number;
}

export function exportToExcel(
  filename: string,
  sheetName: string,
  rows: ReportExportRow[]
): void {
  const safeRows = rows.length > 0 ? rows : [{ Keterangan: 'Belum ada data pada periode ini' }];
  const worksheet = XLSX.utils.json_to_sheet(safeRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export function exportToPdf(
  filename: string,
  title: string,
  subtitle: string,
  headers: string[],
  bodyRows: (string | number)[][]
): void {
  const docPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Luxury Black & Gold PDF Header
  docPdf.setFillColor(11, 11, 13);
  docPdf.rect(0, 0, 297, 26, 'F');
  docPdf.setTextColor(212, 175, 55);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(16);
  docPdf.text('REY RENT CAR', 14, 11);

  docPdf.setTextColor(248, 247, 244);
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(9);
  docPdf.text('SMART ATTENDANCE – REALTIME EMPLOYEE MONITORING', 14, 17);

  docPdf.setTextColor(212, 175, 55);
  docPdf.setFontSize(11);
  docPdf.text(title, 283, 11, { align: 'right' });
  docPdf.setTextColor(200, 200, 205);
  docPdf.setFontSize(8.5);
  docPdf.text(subtitle, 283, 17, { align: 'right' });

  autoTable(docPdf, {
    startY: 32,
    head: [headers],
    body: bodyRows.length > 0 ? bodyRows : [headers.map((_, i) => (i === 0 ? 'Tidak ada data' : '-'))],
    theme: 'grid',
    headStyles: {
      fillColor: [24, 24, 29],
      textColor: [212, 175, 55],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      textColor: [30, 30, 35],
    },
    alternateRowStyles: {
      fillColor: [248, 247, 244],
    },
  });

  docPdf.save(`${filename}.pdf`);
}

export function printReportView(): void {
  window.print();
}
