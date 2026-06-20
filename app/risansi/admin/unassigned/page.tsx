import { redirect } from 'next/navigation';

// Unassigned Clients is now the "Clients → Tours" tab on the System Admin hub.
export default function UnassignedAdminPage() {
  redirect('/risansi/admin/reps?tab=clients');
}
