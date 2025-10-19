// app/lib/audit.js
import { supabase } from './supabase';
import { useDeviceId } from './useDeviceId';

export async function writeAudit({ deviceId, action, target, metadata = {} }) {
  if (!deviceId) return;
  await supabase.rpc('rpc_write_audit', {
    p_device_id: deviceId,
    p_action: action,
    p_target: target,
    p_metadata: metadata
  });
}