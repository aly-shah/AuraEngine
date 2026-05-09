import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '../../types';
import {
  SupportSession,
  TargetProfile,
  startSupportSession,
  endSupportSession,
  getActiveSession,
  getTargetProfile,
} from '../../lib/support';
import { logSupportAction } from '../../lib/supportAudit';
import { canEnterSupport } from '../../lib/permissions';

interface SupportContextValue {
  /** The logged-in admin's user ID (available even without an active session) */
  adminId: string | null;
  /** Currently active support session (null if none) */
  activeSession: SupportSession | null;
  /** Profile of the user being viewed/impersonated */
  viewingAsUser: TargetProfile | null;
  /** Whether impersonation (read-only UI context switch) is active */
  isImpersonating: boolean;
  /** Start a new support session for a target user */
  startSession: (targetUserId: string, reason: string, accessLevel?: 'read_only' | 'debug') => Promise<void>;
  /** End the current support session */
  endSession: () => Promise<void>;
  /** Switch UI context to view as target user (read-only) */
  impersonateUser: (targetUserId: string) => Promise<void>;
  /** Exit impersonation */
  stopImpersonation: () => void;
  /** Convenience wrapper around logSupportAction that fills session/admin IDs */
  logAction: (action: string, resourceType?: string, resourceId?: string, details?: Record<string, unknown>) => Promise<void>;
}

const SupportContext = createContext<SupportContextValue | null>(null);

export function useSupport(): SupportContextValue {
  const ctx = useContext(SupportContext);
  if (!ctx) throw new Error('useSupport must be used within SupportProvider');
  return ctx;
}

interface Props {
  user: User | null;
  children: React.ReactNode;
}

export const SupportProvider: React.FC<Props> = ({ user, children }) => {
  const [activeSession, setActiveSession] = useState<SupportSession | null>(null);
  const [viewingAsUser, setViewingAsUser] = useState<TargetProfile | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSuperAdmin = canEnterSupport(user);
  const supportEnabled = import.meta.env.VITE_SUPPORT_MODE_ENABLED === 'true';

  // Schedule auto-expiry
  const scheduleExpiry = useCallback((session: SupportSession) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const msLeft = new Date(session.expires_at).getTime() - Date.now();
    if (msLeft <= 0) {
      setActiveSession(null);
      setViewingAsUser(null);
      setIsImpersonating(false);
      return;
    }
    expiryTimer.current = setTimeout(() => {
      setActiveSession(null);
      setViewingAsUser(null);
      setIsImpersonating(false);
    }, msLeft);
  }, []);

  // Restore active session on mount
  useEffect(() => {
    if (!isSuperAdmin || !supportEnabled || !user) return;
    getActiveSession(user.id)
      .then((session) => {
        if (session) {
          setActiveSession(session);
          scheduleExpiry(session);
          getTargetProfile(session.target_user_id).then((p) => {
            if (p) setViewingAsUser(p);
          }).catch(e => console.warn('[Support] profile load failed:', e));
        }
      })
      .catch(e => {
        // Table may not exist yet or RLS blocks
        console.warn('[Support] session check failed:', e);
      });
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [user, isSuperAdmin, supportEnabled, scheduleExpiry]);

  const startSession = useCallback(async (targetUserId: string, reason: string, accessLevel: 'read_only' | 'debug' = 'read_only') => {
    if (!user) return;
    // End any existing session first
    if (activeSession) {
      await endSupportSession(activeSession.id, user.id, activeSession.target_user_id);
    }
    const session = await startSupportSession(user.id, targetUserId, reason, accessLevel);
    setActiveSession(session);
    scheduleExpiry(session);
    const profile = await getTargetProfile(targetUserId);
    setViewingAsUser(profile);
    setIsImpersonating(false);
  }, [user, activeSession, scheduleExpiry]);

  const endSessionCb = useCallback(async () => {
    if (!activeSession || !user) return;
    await endSupportSession(activeSession.id, user.id, activeSession.target_user_id);
    setActiveSession(null);
    setViewingAsUser(null);
    setIsImpersonating(false);
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
  }, [activeSession, user]);

  const impersonateUser = useCallback(async (targetUserId: string) => {
    if (!user || !activeSession) return;
    const profile = await getTargetProfile(targetUserId);
    if (profile) {
      setViewingAsUser(profile);
      setIsImpersonating(true);
      await logSupportAction({
        session_id: activeSession.id,
        admin_id: user.id,
        target_user_id: targetUserId,
        action: 'start_impersonation',
      });
    }
  }, [user, activeSession]);

  const stopImpersonation = useCallback(() => {
    setIsImpersonating(false);
    if (activeSession && user) {
      logSupportAction({
        session_id: activeSession.id,
        admin_id: user.id,
        target_user_id: activeSession.target_user_id,
        action: 'stop_impersonation',
      });
    }
  }, [activeSession, user]);

  const logAction = useCallback(async (action: string, resourceType?: string, resourceId?: string, details?: Record<string, unknown>) => {
    if (!user || !activeSession) return;
    await logSupportAction({
      session_id: activeSession.id,
      admin_id: user.id,
      target_user_id: activeSession.target_user_id,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
    });
  }, [user, activeSession]);

  const value: SupportContextValue = {
    adminId: user?.id ?? null,
    activeSession,
    viewingAsUser,
    isImpersonating,
    startSession,
    endSession: endSessionCb,
    impersonateUser,
    stopImpersonation,
    logAction,
  };

  return (
    <SupportContext.Provider value={value}>
      {children}
    </SupportContext.Provider>
  );
};
