import { Route, Routes } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./auth";
import Layout from "./components/Layout";
import AuditLog from "./pages/AuditLog";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Placeholder from "./pages/Placeholder";
import Users from "./pages/Users";
import { NAV_ITEMS } from "./nav";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route
            path="audit"
            element={
              <RequireAuth roles={["admin", "auditor"]}>
                <AuditLog />
              </RequireAuth>
            }
          />
          <Route
            path="admin/users"
            element={
              <RequireAuth roles={["admin"]}>
                <Users />
              </RequireAuth>
            }
          />
          {NAV_ITEMS.filter((n) => n.milestone).map((n) => (
            <Route
              key={n.path}
              path={n.path.slice(1)}
              element={<Placeholder title={n.label} milestone={n.milestone} />}
            />
          ))}
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
