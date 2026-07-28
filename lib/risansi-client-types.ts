// The single source of truth for the client_type option set, shared by the
// Client 360 edit drawer and the visit report's Client Type page so the two
// never drift. client_type is a plain text column, so this is just the picklist.
export const CLIENT_TYPES: string[] = ['End User', 'OEM', 'EPC', 'Trader', 'Group (Mills)', 'Merchant Exporter'];

// EPC and OEM are the two "channel" types we gather extra account intelligence
// for on a visit (focus industries, pump demand, tenders, competitor suppliers).
export const isEpcOem = (t: string | null | undefined): boolean => t === 'EPC' || t === 'OEM';
