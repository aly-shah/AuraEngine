import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { prefetchRoutes } from '../lib/routePrefetchMap';

/**
 * Map of current pathname → routes that are most likely visited next.
 * Keeps the list short so we don't waste bandwidth on cold starts.
 */
const idlePrefetchTargets: Record<string, string[]> = {
  '/': ['/auth', '/features', '/pricing', '/signup'],
  '/features': ['/', '/pricing', '/signup'],
  '/pricing': ['/signup', '/features', '/auth'],
  '/blog': ['/features', '/pricing'],
  '/about': ['/contact', '/features'],
  '/contact': ['/about', '/pricing'],
  '/auth': ['/portal', '/signup', '/reset-password'],
  '/signup': ['/auth'],
  '/portal': ['/portal/leads', '/portal/ai', '/portal/content', '/portal/analytics'],
  '/portal/leads': ['/portal', '/portal/intelligence'],
  '/portal/ai': ['/portal', '/portal/content', '/portal/content-studio'],
  '/portal/content': ['/portal', '/portal/content-studio', '/portal/blog'],
  '/portal/analytics': ['/portal', '/portal/leads', '/portal/automation'],
  '/admin': ['/admin/users', '/admin/ai', '/admin/health'],
  '/admin/users': ['/admin', '/admin/leads', '/admin/audit'],
};

export function useIdlePrefetch(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    const targets = idlePrefetchTargets[pathname];
    if (!targets || targets.length === 0) return;

    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => prefetchRoutes(targets), { timeout: 3000 });
      return () => cancelIdleCallback(id);
    } else {
      // Fallback for Safari: use setTimeout
      const id = setTimeout(() => prefetchRoutes(targets), 1500);
      return () => clearTimeout(id);
    }
  }, [pathname]);
}
