// Generates public/pump_upload_template.xlsx — the download template for the
// admin "Pump Ingestion" page. Re-run after changing the columns.
//   node scripts/make-pump-template.mjs
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'pump_upload_template.xlsx');

const headers = [
  'Client Code', 'Client Name', 'Model', 'Quantity', 'SR No', 'EC No',
  'EC Date', 'SO Date', 'Liquid', 'Capacity', 'Head', 'Supplier',
];

// One illustrative row. The Client Code here is a placeholder — replace it with
// real client codes. (An unknown code is safely skipped on upload.)
const example = [
  'ABCD01X001', 'Example Sugar Mill Pvt Ltd', 'PCP MX-80', 1, 'SR-2026-0001', 'EC-2026-0001',
  '2026-06-15', '2026-05-20', 'Spent Wash', '50 m3/hr', '30 m', 'Risansi Industries Ltd',
];

const ws = XLSX.utils.aoa_to_sheet([headers, example]);
ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length + 2, i === 1 || i === 11 ? 24 : 12) }));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Pumps');
XLSX.writeFile(wb, OUT);
console.log('Wrote', OUT);
