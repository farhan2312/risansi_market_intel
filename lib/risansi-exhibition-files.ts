/**
 * Invoice file validation, shared by the expense server action and the
 * upload/download route so the two can never disagree on what is acceptable.
 *
 * A file must satisfy ALL THREE of: declared mime type, filename extension, and
 * the leading magic bytes. Checking only the mime, or only the name, lets a file
 * called invoice.pdf that actually contains HTML through — and a stored page that
 * executes in a colleague's browser is stored XSS. This is a security control,
 * not defensive boilerplate.
 */

export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** PDF plus the two formats a phone camera produces, since receipts at an
 *  exhibition are far more often photographed than scanned. */
const KINDS = [
  { ext: /\.pdf$/i,   mime: /pdf/i,   magic: [0x25, 0x50, 0x44, 0x46], out: 'application/pdf' },
  { ext: /\.jpe?g$/i, mime: /jpe?g/i, magic: [0xFF, 0xD8, 0xFF],       out: 'image/jpeg' },
  { ext: /\.png$/i,   mime: /png/i,   magic: [0x89, 0x50, 0x4E, 0x47], out: 'image/png' },
] as const;

/** The only content types ever sent back on download. Never echo what was
 *  stored — a bad row must not be able to make us serve something executable. */
export const SERVEABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export interface InvoiceCheck {
  ok: boolean;
  mime?: string;
  error?: string;
}

/**
 * Validate an uploaded invoice. `head` is the first few bytes of the file.
 * Returns the canonical mime to store, or a message fit to show a user.
 */
export function checkInvoice(fileName: string, declaredMime: string, size: number, head: Uint8Array): InvoiceCheck {
  if (size === 0)                 return { ok: false, error: 'That file is empty.' };
  if (size > MAX_INVOICE_BYTES)   return { ok: false, error: 'File is larger than 10 MB.' };

  const kind = KINDS.find(k =>
    k.ext.test(fileName) &&
    k.mime.test(declaredMime) &&
    k.magic.every((b, i) => head[i] === b));

  return kind
    ? { ok: true, mime: kind.out }
    : { ok: false, error: 'Attach a PDF, JPG or PNG. The file has to genuinely be that type.' };
}

/** What the file inputs advertise. Kept here so the picker and the validator
 *  cannot drift apart. */
export const INVOICE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const CAMERA_ACCEPT  = 'image/*';
