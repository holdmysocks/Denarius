import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { restoreSession } from "@/api/auth";

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const { isAuthenticated, refreshToken } = useAuthStore();
  const [loading, setLoading] = useState(!isAuthenticated && !!refreshToken);

  useEffect(() => {
    if (!isAuthenticated && refreshToken) {
      restoreSession().finally(() => setLoading(false));
    }
  }, [isAuthenticated, refreshToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
