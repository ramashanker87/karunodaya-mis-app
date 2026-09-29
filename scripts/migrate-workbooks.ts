import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

type SheetInventory = {
  name: string;
  classification: 'source-candidate' | 'calculated-view' | 'review';
  rowCount: number;
  headers: string[];
  formulaCells: number;
  statusValues: string[];
  dropOutStatusValues: string[];
  llpLabelInDigitalWorkbook: boolean;
};

const args = process.argv.slice(2);
const paths = args.filter((arg) => !arg.startsWith('--'));
const outputFlag = args.find((arg) => arg.startsWith('--out='));
const outDir = resolve(outputFlag?.slice('--out='.length) || 'migration-review');
if (args.includes('--apply')) {
  throw new Error('Import is disabled until the four workbook schemas and identity crosswalk are reviewed. Run --dry-run first.');
}
if (!paths.length) {
  throw new Error('Provide the four workbook paths: npm run migrate:dry-run -- file1.xlsx file2.xlsx file3.xlsx file4.xlsx');
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('formula' in value) return String(value.result ?? '');
    if ('text' in value) return value.text;
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function classify(name: string): SheetInventory['classification'] {
  if (/dashboard|monthly|month.?wise|centre.?wise|center.?wise|class.?wise|summary|report/i.test(name)) return 'calculated-view';
  if (/data.?entry|reflection|attendance|activity|student|registry|enrol|visit|distribution/i.test(name)) return 'source-candidate';
  return 'review';
}

const workbooks = [];
for (const path of paths) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const sheets: SheetInventory[] = [];
  for (const sheet of book.worksheets) {
    const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
    const statusIndex = headers.findIndex((value) => /^status$/i.test(value));
    const dropIndex = headers.findIndex((value) => /^drop[ -]?out status$/i.test(value));
    const statusValues = new Set<string>();
    const dropOutStatusValues = new Set<string>();
    let formulaCells = 0;
    let label = /digital/i.test(basename(path)) && /llp|literacy and library/i.test(sheet.name);
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.SharedFormula) formulaCells++;
        if (/digital/i.test(basename(path)) && /llp|literacy and library/i.test(cellText(cell.value))) label = true;
      });
      if (rowNumber === 1) return;
      if (statusIndex >= 0) statusValues.add(cellText(row.getCell(statusIndex + 1).value));
      if (dropIndex >= 0) dropOutStatusValues.add(cellText(row.getCell(dropIndex + 1).value));
    });
    sheets.push({ name: sheet.name, classification: classify(sheet.name), rowCount: Math.max(0, sheet.rowCount - 1), headers, formulaCells, statusValues: [...statusValues].filter(Boolean).sort(), dropOutStatusValues: [...dropOutStatusValues].filter(Boolean).sort(), llpLabelInDigitalWorkbook: label });
  }
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path));
  workbooks.push({ file: basename(path), sha256: createHash('sha256').update(bytes).digest('hex'), sheets });
}

const review = {
  mode: 'dry-run',
  generatedAt: new Date().toISOString(),
  warning: 'No records were imported. Sheet classification is heuristic; inspect every source candidate and calculated view before approving a field map.',
  workbooks,
  reconciliation: {
    sourceCandidates: workbooks.flatMap((book) => book.sheets.filter((sheet) => sheet.classification === 'source-candidate').map((sheet) => `${book.file}:${sheet.name}`)),
    calculatedViewsExcludedFromImport: workbooks.flatMap((book) => book.sheets.filter((sheet) => sheet.classification === 'calculated-view').map((sheet) => `${book.file}:${sheet.name}`)),
    digitalLlpLabels: workbooks.flatMap((book) => book.sheets.filter((sheet) => sheet.llpLabelInDigitalWorkbook).map((sheet) => `${book.file}:${sheet.name}`)),
    statusAndDropOutStatusNeedSeparateMapping: workbooks.flatMap((book) => book.sheets.filter((sheet) => sheet.statusValues.length || sheet.dropOutStatusValues.length).map((sheet) => ({ source: `${book.file}:${sheet.name}`, status: sheet.statusValues, dropOutStatus: sheet.dropOutStatusValues }))),
    identityCrosswalk: 'Pending: assign stable generated IDs to deduplicated students, locations, staff and source events. Names and row numbers must not be used as identities.',
    formulaReview: 'Calculated sheet formulas were counted, never executed or imported.',
  },
};
await mkdir(outDir, { recursive: true });
const outputPath = resolve(outDir, 'reconciliation.json');
await writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`);
process.stdout.write(`Dry-run inventory written to ${outputPath}\n`);
