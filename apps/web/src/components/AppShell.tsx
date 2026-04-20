// AppShell — shared layout for every authenticated route.
//
// Dark sidebar on the left groups navigation by purpose (Daily Ops, Library,
// Insights, Admin) so a kitchen manager can find the tool they need without
// scanning a flat button strip. Top bar shows restaurant context + user menu.
// Mobile: sidebar collapses behind a hamburger; content area becomes full-width.

import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, ClipboardCheck, PackageCheck, ShoppingCart, Trash2,
  ChefHat, Carrot, Truck, BarChart3, Settings as SettingsIcon, LogOut, Menu, X, ChevronDown, UserCircle2,
  type LucideIcon,
} from 'lucide-react';
import { logout } from '../auth/api.js';
import { useAuth } from '../auth/useAuth.js';
import { cn } from './ui/cn.js';

interface NavItem { to: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Daily Ops',
    items: [
      { to: '/prep/sheet',  label: 'Prep sheet',     icon: ClipboardList },
      { to: '/inventory',   label: 'Inventory',      icon: ClipboardCheck },
      { to: '/deliveries',  label: 'Deliveries',     icon: PackageCheck },
      { to: '/orders',      label: 'Orders',         icon: ShoppingCart },
      { to: '/prep/waste',  label: 'Waste log',      icon: Trash2 },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/recipes',     label: 'Recipes',        icon: ChefHat },
      { to: '/ingredients', label: 'Ingredients',    icon: Carrot },
      { to: '/suppliers',   label: 'Suppliers',      icon: Truck },
    ],
  },
  {
    label: 'Insights',
    items: [{ to: '/reports', label: 'Reports', icon: BarChart3 }],
  },
  {
    label: 'Admin',
    items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const session = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-surface-subtle">
      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-100 transform transition-transform duration-200',
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-800">
          <Link to="/" className="flex items-center gap-2.5 text-white hover:text-white">
            <div className="h-8 w-8 rounded-md bg-brand-600 flex items-center justify-center shadow-sm">
              <ChefHat className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">TP Manager</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Restaurant Ops</div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden rounded p-1 text-slate-300 hover:text-white hover:bg-slate-800 focus-ring"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="px-3 py-4 space-y-5 overflow-y-auto h-[calc(100vh-4rem)]">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => cn(
                        'group flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur border-b border-surface-border">
          <div className="flex h-full items-center justify-between gap-4 px-4 lg:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden rounded p-2 text-slate-600 hover:bg-surface-muted focus-ring"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="hidden sm:block text-xs text-slate-500 truncate">
                {currentCrumb(location.pathname)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {session && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen((v) => !v)}
                    onBlur={() => setTimeout(() => setUserMenuOpen(false), 120)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted focus-ring"
                  >
                    <div className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center">
                      <UserCircle2 className="h-5 w-5" />
                    </div>
                    <div className="hidden sm:block text-left leading-tight">
                      <div className="text-sm font-medium text-slate-900 truncate max-w-[180px]">
                        {session.user.email}
                      </div>
                      <div className="text-[11px] uppercase tracking-wider text-slate-500">
                        {session.user.role}
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-52 rounded-md border border-surface-border bg-white shadow-card-hover py-1">
                      <div className="px-3 py-2 border-b border-surface-border">
                        <div className="text-xs text-slate-500">Signed in as</div>
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {session.user.email}
                        </div>
                      </div>
                      <Link
                        to="/settings"
                        className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-surface-muted"
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <SettingsIcon className="h-4 w-4" />
                        Settings
                      </Link>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void logout().then(() => { window.location.href = '/login'; })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

// Small helper: find a friendly label for the active route so the topbar has
// a breadcrumb even if a page forgets to set one.
function currentCrumb(path: string): string {
  for (const g of GROUPS) {
    for (const item of g.items) {
      if (path === item.to || (item.to !== '/' && path.startsWith(item.to))) {
        return `${g.label} / ${item.label}`;
      }
    }
  }
  return '';
}
