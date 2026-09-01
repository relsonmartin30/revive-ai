import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AmbientBackground } from "./components/AmbientBackground";
import { DemoBanner } from "./components/DemoBanner";
import { PageTransition } from "./components/PageTransition";
import { Sidebar } from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import ImportLogs from "./pages/ImportLogs";
import ImpactPage from "./pages/Impact";
import IssuerHealthPage from "./pages/IssuerHealth";
import TransactionDetail from "./pages/TransactionDetail";
import TransactionList from "./pages/TransactionList";

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <BrowserRouter>
      <AmbientBackground />
      <div className="app-shell relative flex min-h-screen">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
        />

        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <DemoBanner />
          <main className="relative flex-1 overflow-y-auto px-6 py-8 lg:px-10">
            <div className="mx-auto max-w-6xl">
              <Routes>
                <Route element={<PageTransition />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/impact" element={<ImpactPage />} />
                  <Route path="/issuer-health" element={<IssuerHealthPage />} />
                  <Route path="/import" element={<ImportLogs />} />
                  <Route path="/transactions" element={<TransactionList />} />
                  <Route path="/transactions/:id" element={<TransactionDetail />} />
                </Route>
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
