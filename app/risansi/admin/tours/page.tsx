import { redirect } from 'next/navigation';

// Tour Mapping is now a tab on the consolidated System Admin hub.
export default function ToursAdminPage() {
  redirect('/risansi/admin/reps?tab=tours');
}
