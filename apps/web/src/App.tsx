import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage.js';
import ForgotPasswordPage from './pages/ForgotPasswordPage.js';
import IngredientsPage from './pages/IngredientsPage.js';
import IngredientDetailPage from './pages/IngredientDetailPage.js';
import SuppliersPage from './pages/SuppliersPage.js';
import SupplierDetailPage from './pages/SupplierDetailPage.js';
import RecipesPage from './pages/RecipesPage.js';
import RecipeDetailPage from './pages/RecipeDetailPage.js';
import StationViewPage from './pages/StationViewPage.js';
import SettingsPage from './pages/SettingsPage.js';
import LocationsSettingsPage from './pages/settings/LocationsSettingsPage.js';
import UtensilsSettingsPage from './pages/settings/UtensilsSettingsPage.js';
import WasteReasonsSettingsPage from './pages/settings/WasteReasonsSettingsPage.js';
import StationsSettingsPage from './pages/settings/StationsSettingsPage.js';
import UsersSettingsPage from './pages/settings/UsersSettingsPage.js';
import PrepSheetPage from './pages/PrepSheetPage.js';
import InventoryPage from './pages/InventoryPage.js';
import DeliveriesPage from './pages/DeliveriesPage.js';
import OrdersPage from './pages/OrdersPage.js';
import WastePage from './pages/WastePage.js';
import MigrationReviewPage from './pages/MigrationReviewPage.js';
import ReportsPage from './pages/ReportsPage.js';
import AvTVariancePage from './pages/AvTVariancePage.js';
import PriceCreepPage from './pages/PriceCreepPage.js';
import WasteAttributionPage from './pages/WasteAttributionPage.js';
import DeadStockPage from './pages/DeadStockPage.js';
import MenuContributionPage from './pages/MenuContributionPage.js';
import PrepThroughputPage from './pages/PrepThroughputPage.js';
import PrepItemsPage from './pages/PrepItemsPage.js';
import AlohaMappingPage from './pages/AlohaMappingPage.js';
import DashboardPage from './pages/DashboardPage.js';
import ForecastAccuracyPage from './pages/ForecastAccuracyPage.js';
import ForecastOverridesPage from './pages/ForecastOverridesPage.js';
import RequireAuth from './auth/RequireAuth.js';
import AppShell from './components/AppShell.js';

// Shared layout wrapper so every authenticated page inherits the AppShell
// chrome without each page having to import it. StationViewPage is an
// exception — it renders the printable station sheet raw (no nav chrome).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/recipes/station/:station" element={<RequireAuth><StationViewPage /></RequireAuth>} />

        <Route path="/" element={<Shell><DashboardPage /></Shell>} />
        <Route path="/reports" element={<Shell><ReportsPage /></Shell>} />
        <Route path="/reports/avt" element={<Shell><AvTVariancePage /></Shell>} />
        <Route path="/reports/price-creep" element={<Shell><PriceCreepPage /></Shell>} />
        <Route path="/reports/waste-loss" element={<Shell><WasteAttributionPage /></Shell>} />
        <Route path="/reports/dead-stock" element={<Shell><DeadStockPage /></Shell>} />
        <Route path="/reports/menu-contribution" element={<Shell><MenuContributionPage /></Shell>} />
        <Route path="/reports/prep-throughput" element={<Shell><PrepThroughputPage /></Shell>} />
        <Route path="/reports/forecast-accuracy" element={<Shell><ForecastAccuracyPage /></Shell>} />
        <Route path="/reports/forecast-overrides" element={<Shell><ForecastOverridesPage /></Shell>} />
        <Route path="/settings/aloha-mapping" element={<Shell><AlohaMappingPage /></Shell>} />
        <Route path="/ingredients" element={<Shell><IngredientsPage /></Shell>} />
        <Route path="/ingredients/:id" element={<Shell><IngredientDetailPage /></Shell>} />
        <Route path="/suppliers" element={<Shell><SuppliersPage /></Shell>} />
        <Route path="/suppliers/:id" element={<Shell><SupplierDetailPage /></Shell>} />
        <Route path="/recipes" element={<Shell><RecipesPage /></Shell>} />
        <Route path="/recipes/:id" element={<Shell><RecipeDetailPage /></Shell>} />
        <Route path="/settings" element={<Shell><SettingsPage /></Shell>} />
        <Route path="/settings/locations" element={<Shell><LocationsSettingsPage /></Shell>} />
        <Route path="/settings/utensils" element={<Shell><UtensilsSettingsPage /></Shell>} />
        <Route path="/settings/waste-reasons" element={<Shell><WasteReasonsSettingsPage /></Shell>} />
        <Route path="/settings/stations" element={<Shell><StationsSettingsPage /></Shell>} />
        <Route path="/settings/users" element={<Shell><UsersSettingsPage /></Shell>} />
        <Route path="/prep/sheet" element={<Shell><PrepSheetPage /></Shell>} />
        <Route path="/prep/items" element={<Shell><PrepItemsPage /></Shell>} />
        <Route path="/prep/waste" element={<Shell><WastePage /></Shell>} />
        <Route path="/inventory" element={<Shell><InventoryPage /></Shell>} />
        <Route path="/deliveries" element={<Shell><DeliveriesPage /></Shell>} />
        <Route path="/orders" element={<Shell><OrdersPage /></Shell>} />
        <Route path="/settings/migration" element={<Shell><MigrationReviewPage /></Shell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
