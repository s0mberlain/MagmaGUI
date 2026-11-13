import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Placeholder from "./pages/Placeholder";
import { NAV_ITEMS } from "./nav";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        {NAV_ITEMS.filter((n) => n.path !== "/").map((n) => (
          <Route
            key={n.path}
            path={n.path.slice(1)}
            element={<Placeholder title={n.label} milestone={n.milestone} />}
          />
        ))}
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  );
}
