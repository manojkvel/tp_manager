// TASK-037 — /settings index.
//
// Landing page that links to each catalogue editor. Surfaces the admin
// surface area at a glance so owners don't have to hunt through nav.

import { Link } from 'react-router-dom';
import {
  MapPin, Utensils, Trash2, UtensilsCrossed, Users, Database, Link2,
  ChevronRight, type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.js';

interface Tile {
  to: string;
  title: string;
  hint: string;
  icon: LucideIcon;
}

const TILES: Tile[] = [
  { to: '/settings/users',         title: 'Users',            hint: 'Invite staff, assign roles, reset passwords',  icon: Users },
  { to: '/settings/stations',      title: 'Kitchen stations', hint: 'Define prep stations for recipe assignment',   icon: UtensilsCrossed },
  { to: '/settings/locations',     title: 'Storage locations',hint: 'Walk-in, dry storage, freezer — for inventory', icon: MapPin },
  { to: '/settings/utensils',      title: 'Portion utensils', hint: 'Scoops, ladles, dredges — portion control',     icon: Utensils },
  { to: '/settings/waste-reasons', title: 'Waste reasons',    hint: 'Reason codes for logging discarded product',    icon: Trash2 },
  { to: '/settings/aloha-mapping', title: 'Aloha POS mapping',hint: 'Map POS items to internal menu recipes',        icon: Link2 },
  { to: '/settings/migration',     title: 'Data migration',   hint: 'Review recent legacy-import batches',           icon: Database },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage catalogues, users, and integrations for your restaurant."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="group rounded-lg bg-white border border-surface-border shadow-card hover:shadow-card-hover hover:border-brand-300 transition-all p-5 flex items-start gap-4"
          >
            <div className="h-10 w-10 rounded-md bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <t.icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{t.title}</h3>
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-brand-600 shrink-0" />
              </div>
              <p className="mt-1 text-xs text-slate-500">{t.hint}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
