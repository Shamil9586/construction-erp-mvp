import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { ExecutiveDashboard } from "./pages/ExecutiveDashboard";
import { ObjectsList } from "./pages/ObjectsList";
import { ObjectDetail } from "./pages/ObjectDetail";
import { Contractors } from "./pages/Contractors";
import { ContractorDetail } from "./pages/ContractorDetail";
import { InspectionsQueue } from "./pages/InspectionsQueue";

/**
 * Маршрутизация MVP (ТЗ п.40, п.42-43). Полный список экранов из ТЗ шире
 * (напр. отдельные разделы ПТО/СДО/Финансы как самостоятельные страницы),
 * но в MVP они реализованы как вкладки внутри карточки объекта
 * (ObjectDetail), что соответствует духу "1-2 минуты на понимание" для
 * генерального директора — все данные по объекту в одном месте.
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ExecutiveDashboard />} />
        <Route path="/objects" element={<ObjectsList />} />
        <Route path="/objects/:id" element={<ObjectDetail />} />
        <Route path="/contractors" element={<Contractors />} />
        <Route path="/contractors/:id" element={<ContractorDetail />} />
        <Route path="/inspections" element={<InspectionsQueue />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
