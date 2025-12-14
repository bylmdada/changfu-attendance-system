'use client';

import { useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import SystemNavbar from './SystemNavbar';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
}

interface AuthenticatedLayoutProps {
  children: ReactNode;
  backUrl?: string;
  backLabel?: string;
}

export default function AuthenticatedLayout({ 
  children, 
  backUrl, 
  backLabel 
}: AuthenticatedLayoutProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        if (userData?.user) {
          setUser(userData.user);
        } else if (userData?.id) {
          setUser(userData);
        }
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error('Auth check error:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl={backUrl} backLabel={backLabel} />
      <main>
        {children}
      </main>
    </div>
  );
}
