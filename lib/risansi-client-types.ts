// The single source of truth for the client_type option set, shared by the
// Client 360 edit drawer and the visit report's Client Type page so the two
// never drift.
//
// Migration 0059 put a CHECK constraint on the column matching this list, after
// a bulk import wrote six values the dropdown had never offered (DIRECT MILL,
// GROUP, TRADER and blanks among them). Keep the two in step: adding an option
// here without adding it to the constraint means the form saves and the database
// refuses.
//
// 'Unclassified' is last because it is not a choice anyone should make casually
// — it is where the 1,022 clients that arrived with no type at all now sit,
// waiting to be classified properly.
export const CLIENT_TYPES: string[] = [
  'End User', 'OEM', 'EPC', 'Trader', 'Group (Mills)', 'Merchant Exporter', 'Unclassified',
];

// EPC and OEM are the two "channel" types we gather extra account intelligence
// for on a visit (focus industries, pump demand, tenders, competitor suppliers).
export const isEpcOem = (t: string | null | undefined): boolean => t === 'EPC' || t === 'OEM';
