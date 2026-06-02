'use client';

import AssignVisitDrawer from './AssignVisitDrawer';
import type { DrawerRep } from './AssignVisitDrawer';

// Thin client island — the drawer manages its own open/close state
// and renders its own trigger button.
export function AssignVisitButton({ reps }: { reps: DrawerRep[] }) {
  return <AssignVisitDrawer reps={reps} />;
}
