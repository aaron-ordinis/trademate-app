// components/SharedCalendar.js
import React, { useMemo, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

/** --- theme --- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const ORANGE = "#f59e0b";
const GREEN = "#16a34a";

/** optional debug logs toggle */
const LOG = false;
const TAG = "[calendar]";

/** status helpers */
const normalizeStatus = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^open$/, "scheduled");
const STATUS_COLOR = { scheduled: BRAND, in_progress: ORANGE, complete: GREEN };

/** date utils */
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const pad = (n) => String(n).padStart(2, "0");
const toYMD = (d) =>
  d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

const atMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

const monthMatrix = (anyDate) => {
  const first = new Date(anyDate.getFullYear(), anyDate.getMonth(), 1);
  const firstWeekday = (first.getDay() + 6) % 7; // Mon=0
  const start = new Date(first);
  start.setDate(first.getDate() - firstWeekday);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      row.push(d);
    }
    weeks.push(row);
  }
  return weeks;
};

const addWorkingDays = (startDate, days, includeWeekends) => {
  const s = atMidnight(startDate);
  if (days <= 1) return s;
  let remaining = days - 1;
  const cur = new Date(s);
  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    if (includeWeekends || !isWeekend(cur)) remaining--;
  }
  return cur;
};

/** Jobs→day map (DOTS), respecting include_weekends, using Y-M-D keys */
const buildJobsByDayKey = (jobs = []) => {
  const m = new Map();
  for (const j of jobs) {
    const s0 = j.start_date ? atMidnight(new Date(j.start_date)) : null;
    const e0 = j.end_date ? atMidnight(new Date(j.end_date)) : s0;
    if (!s0) continue;
    const inc = !!j.include_weekends;
    const cur = new Date(s0);
    while (cur <= e0) {
      if (inc || !isWeekend(cur)) {
        const k = toYMD(cur);
        const arr = m.get(k) || [];
        arr.push(j);
        m.set(k, arr);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return m;
};

/**
 * Build week micro-bands for jobs, splitting at weekends if include_weekends=false.
 * For each job, we create a 7-bool array (Mon..Sun) of "active" columns and compress
 * it into contiguous [startCol,endCol] segments. Then we lane-pack those segments (≤3 lanes).
 */
function buildWeekRanges(weekDays, jobs) {
  const ranges = [];
  const laneEnds = []; // last endCol used per lane

  for (const j of jobs) {
    const js = j.start_date ? atMidnight(new Date(j.start_date)) : null;
    const je = j.end_date ? atMidnight(new Date(j.end_date)) : js;
    if (!js) continue;
    const inc = !!j.include_weekends;

    // 1) mark active columns for this job in this week
    const active = new Array(7).fill(false);
    for (let col = 0; col < 7; col++) {
      const d = atMidnight(weekDays[col]);
      const within = d >= js && d <= je;
      active[col] = within && (inc || !isWeekend(d));
    }

    // 2) compress to contiguous segments
    let startCol = null;
    for (let col = 0; col < 7; col++) {
      const last = col === 6;
      if (active[col] && startCol === null) startCol = col;

      if (
        startCol !== null &&
        (!active[col] || last)
      ) {
        const endCol = (!active[col] && !last) ? col - 1 : (active[col] ? col : col - 1);
        if (endCol >= startCol) {
          // 3) lane packing (up to 3)
          let lane = 0;
          for (; lane < laneEnds.length; lane++) if (laneEnds[lane] < startCol) break;
          laneEnds[lane] = endCol;

          const color = STATUS_COLOR[normalizeStatus(j.status)] || STATUS_COLOR.scheduled;
          ranges.push({ startCol, endCol, lane, color });
        }
        startCol = null;
      }
    }
  }

  const laneCount = Math.min(3, Math.max(1, laneEnds.length || 1));
  return { ranges, laneCount };
}

/** dot color priority (in_progress > complete > scheduled) */
const badgeColorForJobs = (arr = []) => {
  const hasInProg = arr.some((j) => normalizeStatus(j.status) === "in_progress");
  const hasDone = arr.some((j) => normalizeStatus(j.status) === "complete");
  if (hasInProg) return STATUS_COLOR.in_progress;
  if (hasDone) return STATUS_COLOR.complete;
  return STATUS_COLOR.scheduled;
};

/** Component */
export default function SharedCalendar({
  month,
  onChangeMonth,
  selectedDate,
  onSelectDate,
  jobs = [],
  span, // { start, days, includeWeekends } optional
  blockStarts = false,
  onDayLongPress,
}) {
  const grid = useMemo(() => monthMatrix(month), [month]);
  const jobsByDayKey = useMemo(() => buildJobsByDayKey(jobs), [jobs]);

  // span segments for a given week (also weekend-aware)
  const spanSegmentsForWeek = (week) => {
    if (!span || !span.start || !span.days) return [];
    const s = atMidnight(span.start);
    const e = addWorkingDays(s, Math.max(1, Math.floor(span.days || 1)), !!span.includeWeekends);

    const active = new Array(7).fill(false);
    for (let col = 0; col < 7; col++) {
      const d = atMidnight(week[col]);
      active[col] = d >= s && d <= e && (span.includeWeekends || !isWeekend(d));
    }

    const segs = [];
    let st = null;
    for (let col = 0; col < 7; col++) {
      const last = col === 6;
      if (active[col] && st === null) st = col;
      if ((st !== null && !active[col]) || (st !== null && last)) {
        const end = (!active[col] && !last) ? col - 1 : col;
        if (end >= st) segs.push([st, end]);
        st = null;
      }
    }
    return segs;
  };

  const haptic = useRef(null);
  React.useEffect(() => {
    (async () => {
      try {
        const m = await import("expo-haptics");
        haptic.current = m;
      } catch {}
    })();
  }, []);
  const buzz = () => haptic.current?.selectionAsync?.();

  return (
    <View>
      {/* Month header */}
      <View style={st.calHeader}>
        <TouchableOpacity
          style={st.navBtn}
          onPress={() => {
            const d = new Date(month);
            d.setMonth(d.getMonth() - 1);
            onChangeMonth && onChangeMonth(d);
            LOG && console.log(TAG, "nav.prev", d.toISOString());
            buzz();
          }}
          activeOpacity={0.85}
          accessibilityLabel="Previous month"
        >
          <ChevronLeft size={18} color={TEXT} />
        </TouchableOpacity>
        <Text style={st.calTitle}>
          {month.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <TouchableOpacity
          style={st.navBtn}
          onPress={() => {
            const d = new Date(month);
            d.setMonth(d.getMonth() + 1);
            onChangeMonth && onChangeMonth(d);
            LOG && console.log(TAG, "nav.next", d.toISOString());
            buzz();
          }}
          activeOpacity={0.85}
          accessibilityLabel="Next month"
        >
          <ChevronRight size={18} color={TEXT} />
        </TouchableOpacity>
      </View>

      {/* Week header */}
      <View style={st.weekHeader}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <Text key={d} style={st.weekHeadText}>
            {d}
          </Text>
        ))}
      </View>

      {/* Weeks */}
      <View style={{ gap: 2 }}>
        {grid.map((week, wi) => {
          // Week job bands (respect weekend splits)
          const weekJobs = jobs.filter((j) => {
            const s0 = j.start_date ? atMidnight(new Date(j.start_date)) : null;
            const e0 = j.end_date ? atMidnight(new Date(j.end_date)) : s0;
            if (!s0) return false;
            const w0 = atMidnight(week[0]);
            const w6 = atMidnight(week[6]);
            return e0 >= w0 && s0 <= w6;
          });
          const { ranges, laneCount } = buildWeekRanges(week, weekJobs);
          const rowH = 44 + (laneCount - 1) * 8;

          const segs = spanSegmentsForWeek(week);
          const pct = (c) => (c * 100) / 7;

          return (
            <View key={"w-" + wi} style={[st.weekRow, { height: rowH }]}>
              {/* job bands */}
              <View style={st.bandsLayer} pointerEvents="none">
                {ranges.map((r, i) => {
                  if (r.lane > 2) return null;
                  const left = r.startCol * (100 / 7);
                  const width = (r.endCol - r.startCol + 1) * (100 / 7);
                  return (
                    <View
                      key={i}
                      style={[
                        st.jobBand,
                        {
                          left: left + "%",
                          width: width + "%",
                          top: 36 + r.lane * 8,
                          backgroundColor: r.color,
                          opacity: 0.18,
                        },
                      ]}
                    />
                  );
                })}
              </View>

              {/* optional selection span */}
              {span &&
                segs.map(([c0, c1], ix) => (
                  <View
                    key={ix}
                    pointerEvents="none"
                    style={[
                      {
                        position: "absolute",
                        top: 6,                    // padding from top
                        bottom: 6,                 // padding from bottom
                        left: pct(c0) + "%",
                        width: pct(c1 - c0 + 1) + "%",
                        backgroundColor: BRAND,
                        opacity: 0.12,             // subtle look
                        borderRadius: 12,          // rounded corners
                        borderWidth: 1.5,          // subtle border
                        borderColor: BRAND + "40", // semi-transparent border
                        marginHorizontal: 2,
                      },
                      Platform.select({
                        ios: {
                          shadowColor: BRAND,
                          shadowOpacity: 0.2,
                          shadowRadius: 4,
                          shadowOffset: { width: 0, height: 1 },
                        },
                        android: {
                          elevation: 2,
                        },
                      }),
                    ]}
                  >
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "50%",
                        backgroundColor: "rgba(255, 255, 255, 0.15)",
                        borderTopLeftRadius: 11,
                        borderTopRightRadius: 11,
                      }}
                    />
                  </View>
                ))}

              {/* day cells */}
              {week.map((day, di) => {
                const inMonth = day.getMonth() === month.getMonth();
                const isSel = selectedDate && sameDay(day, selectedDate);
                const isToday = sameDay(day, new Date());
                const key = toYMD(day);
                const jobsOnDay = jobsByDayKey.get(key) || [];

                const blocked =
                  !!(blockStarts &&
                  span &&
                  span.days &&
                  span.start &&
                  jobsOnDay.length > 0);

                return (
                  <TouchableOpacity
                    key={di}
                    style={st.dayCell}
                    activeOpacity={blocked ? 1 : 0.9}
                    disabled={blocked}
                    onPress={() => {
                      LOG && console.log(TAG, "day.press", key, { blocked, jobs: jobsOnDay.length });
                      onSelectDate && onSelectDate(atMidnight(day));
                    }}
                    onLongPress={() => onDayLongPress && onDayLongPress(day, jobsOnDay)}
                    accessibilityLabel={"Day " + day.getDate()}
                    accessibilityHint={blocked ? "Start date blocked" : "Select date"}
                  >
                    <View
                      style={[
                        st.dayNumWrap,
                        isSel && {
                          borderColor: BRAND + "80",
                          backgroundColor: BRAND + "12",
                        },
                        isToday && st.dayToday,
                        blocked && {
                          opacity: 0.38,
                          backgroundColor: "#f3f4f6",
                        },
                        !inMonth && { opacity: 0.45 },
                      ]}
                    >
                      <Text style={st.dayNum}>{day.getDate()}</Text>
                      {jobsOnDay.length > 0 && (
                        <View
                          style={[
                            st.badge,
                            { backgroundColor: badgeColorForJobs(jobsOnDay) },
                          ]}
                        >
                          <Text style={st.badgeText}>{jobsOnDay.length}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  calHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  calTitle: { color: TEXT, fontWeight: "900", fontSize: 18 },
  navBtn: {
    height: 34,
    width: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f4fa",
    borderWidth: 1,
    borderColor: BORDER,
  },
  weekHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: BORDER,
    paddingBottom: 6,
    marginBottom: 2,
  },
  weekHeadText: {
    flex: 1,
    textAlign: "center",
    color: MUTED,
    fontWeight: "900",
    fontSize: 12,
  },

  weekRow: { position: "relative", flexDirection: "row", marginBottom: 2 },
  bandsLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  jobBand: { position: "absolute", height: 4, borderRadius: 6 },

  dayCell: { flex: 1, alignItems: "center" },
  dayNumWrap: {
    marginTop: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  dayNum: { color: TEXT, fontWeight: "800", fontSize: 14 },
  dayToday: { borderColor: BRAND + "55" },

  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
});