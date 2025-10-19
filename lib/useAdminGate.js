// app/lib/useAdminGate.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useDeviceId } from './useDeviceId';

export function useAdminGate() {
  const deviceId = useDeviceId();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('Booting');
  const lastCheckedRef = useRef(0);

  const check = useCallback(async () => {
    if (!deviceId) {
      setLoading(false);
      setAllowed(false);
      setReason('No device ID yet');
      return false;
    }

    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setAllowed(false);
        setReason('No session');
        return false;
      }

      // server-side truth: owner flag + device allow-list
      const { data: ok, error } = await supabase.rpc('rpc_is_admin_allowed', { p_device_id: deviceId });
      if (error) {
        setAllowed(false);
        setReason('Allow check failed');
        return false;
      }

      setAllowed(Boolean(ok));
      setReason(Boolean(ok) ? 'ok' : 'Not owner or device not allowed');
      return Boolean(ok);
    } finally {
      lastCheckedRef.current = Date.now();
      setLoading(false);
    }
  }, [deviceId]);

  // Initial + device change
  useEffect(() => { check(); }, [check]);

  // Re-check when app returns to foreground (keeps it sticky after restarts)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => { try { sub.remove(); } catch {} };
  }, [check]);

  // Re-check on auth changes
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => { try { sub.subscription.unsubscribe(); } catch {} };
  }, [check]);

  return useMemo(() => ({
    loading,
    allowed,
    reason,
    deviceId,
    lastChecked: lastCheckedRef.current,
    refresh: check, // expose manual refresh for screens that toggle
  }), [loading, allowed, reason, deviceId, check]);
}