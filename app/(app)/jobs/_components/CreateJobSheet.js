import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  Platform,
  TextInput,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays, CheckSquare, Square, X as XIcon } from 'lucide-react-native';
import { addWorkingDays, toLocalMidnight } from '../../../../services/date-utils';
import { createFromQuote } from '../../../../services/jobs';
import { supabase } from '../../../../lib/supabase';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';

export default function CreateJobSheet({
  visible,
  onClose,
  quote,
  onCreated,
  defaultIncludeWeekends = false,
  profileHoursPerDay = 10,
}) {
  const [startDate, setStartDate] = useState(toLocalMidnight(new Date()));
  const [showPicker, setShowPicker] = useState(false);
  const [includeWeekends, setIncludeWeekends] = useState(!!defaultIncludeWeekends);
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggested, setSuggested] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setError('');
    setDays(1);
    setIncludeWeekends(!!defaultIncludeWeekends);
    setStartDate(toLocalMidnight(new Date()));
  }, [visible, defaultIncludeWeekends]);

  const endDate = useMemo(
    () => addWorkingDays(startDate, Math.max(1, Math.floor(days || 1)), includeWeekends),
    [startDate, days, includeWeekends]
  );

  // --- Edge Function call for quote PDF copy ---
  const addQuoteDocument = async (jobId) => {
    try {
      const { data, error } = await supabase.functions.invoke('copy-quote-pdf', {
        body: { jobId, quoteId: quote?.id },
      });

      if (error) {
        console.warn('[CreateJobSheet] copy-quote-pdf failed:', error.message || error);
        setError((prev) => prev || 'Job created, but attaching the quote PDF failed.');
        return;
      }

      console.log('[CreateJobSheet] copy-quote-pdf ok:', data);
    } catch (e) {
      console.warn('[CreateJobSheet] addQuoteDocument invoke error:', e?.message || e);
      setError((prev) => prev || 'Job created, but attaching the quote PDF failed.');
    }
  };

  const onConfirm = async () => {
    if (!quote?.id) {
      setError('Missing quote');
      return;
    }
    const st = toLocalMidnight(startDate);
    const dur = Math.max(1, Math.floor(Number(days) || 1));

    try {
      setBusy(true);
      setError('');

      const res = await createFromQuote({
        supabase,
        quoteId: quote.id,
        startDate: st,
        includeWeekends,
        overrideDays: dur,
        profileHoursPerDay,
      });

      if (res?.error) {
        setError(res.error);
        return;
      }

      if (res?.job?.id) {
        await addQuoteDocument(res.job.id);
      }

      if (typeof onCreated === 'function') onCreated(res.job);
      onClose && onClose();
    } catch (e) {
      setError(e?.message || 'Could not create job.');
    } finally {
      setBusy(false);
    }
  };

  const onChangeDate = (_e, d) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (d) setStartDate(toLocalMidnight(d));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>Create Job</Text>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} disabled={busy}>
            <XIcon size={18} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Start Date */}
        <Text style={styles.label}>Start date</Text>
        <View style={{ position: 'relative', marginBottom: 8 }}>
          <TextInput
            value={startDate.toLocaleDateString()}
            editable={false}
            style={[styles.input, { paddingRight: 40 }]}
          />
          <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.inputIconBtn} disabled={busy}>
            <CalendarDays size={18} color={MUTED} />
          </TouchableOpacity>
        </View>
        {showPicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={onChangeDate}
            maximumDate={new Date(2199, 11, 31)}
          />
        )}

        {/* Duration days */}
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Duration (days)</Text>
        </View>
        <TextInput
          value={String(days)}
          onChangeText={(t) => {
            const n = Math.max(1, Math.floor(Number(String(t).replace(/[^0-9]/g, '')) || 1));
            setDays(n);
          }}
          keyboardType="number-pad"
          style={styles.input}
          placeholder="e.g. 2"
          placeholderTextColor={MUTED}
          editable={!busy}
        />

        {/* Include weekends toggle */}
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => !busy && setIncludeWeekends((v) => !v)}
          activeOpacity={0.8}
        >
          {includeWeekends ? (
            <CheckSquare size={20} color={BRAND} />
          ) : (
            <Square size={20} color={MUTED} />
          )}
          <Text style={styles.toggleText}>Include weekends (default off)</Text>
        </TouchableOpacity>

        {/* End date preview */}
        <View style={styles.previewBox}>
          <Text style={styles.previewText}>
            End date:&nbsp;
            <Text style={{ fontWeight: '900' }}>{endDate.toLocaleDateString()}</Text>
          </Text>
          <Text style={[styles.previewText, { color: MUTED }]}>
            {includeWeekends ? 'Calendar days' : 'Working days (Mon–Fri)'}
          </Text>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#eef2f7' }]} onPress={onClose} disabled={busy}>
            <Text style={[styles.btnText, { color: TEXT }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: BRAND, flex: 1, opacity: busy ? 0.7 : 1 }]}
            onPress={onConfirm}
            disabled={busy}
          >
            <Text style={[styles.btnText, { color: '#fff' }]}>{busy ? 'Creating…' : 'Create Job'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: BORDER, marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { color: TEXT, fontWeight: '900', fontSize: 18 },
  iconBtn: {
    height: 34,
    width: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
  },
  label: { color: MUTED, fontWeight: '800', marginTop: 8, marginBottom: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    backgroundColor: '#f6f7f9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT,
  },
  inputIconBtn: {
    position: 'absolute',
    right: 8,
    top: 8,
    height: 28,
    width: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: BORDER,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  toggleText: { color: TEXT, fontWeight: '800' },
  previewBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: BORDER,
  },
  previewText: { color: TEXT, fontWeight: '700' },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { fontWeight: '800' },
  errorText: { color: '#e11d48', marginTop: 8, fontWeight: '800' },
});