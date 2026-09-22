import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { restoreSession } from "@/api/auth";

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  // The refresh token is an HttpOnly cookie the app cannot see, so always try
  // to restore the session before deciding the user must sign in.
  const [loading, setLoading] = useState(!isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      restoreSession().finally(() => setLoading(false));
    }
  }, [isAuthenticated]);

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
