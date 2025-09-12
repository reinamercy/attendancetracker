// app/hod/attendance.tsx — UI from UI CODE + logic from LOGIC CODE (responsive + safe back)
"use client"

import { DEPARTMENT } from "@/constants/app";
import { db } from "@/firebase";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation, useRouter } from "expo-router";
import { getAuth, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// canonical helpers
import {
  canonicalClassKey,
  extractSectionFromCanon,
  legacyCanonFromYearful,
  yearfulCanon,
} from "@/constants/classKey";

type YearFilter = "All" | "1" | "2" | "3" | "4";

type ClassDoc = {
  id: string;
  year?: number | null;
  dept?: string;
  section?: string;
};

type AttendanceDoc = {
  id?: string;
  CLASS?: string; // legacy
  CLASS_CANON?: string; // preferred
  CLASS_DISPLAY?: string; // pretty
  DATE: string;
  dept?: string;
  section?: string;
  year?: number | null;
  counts?: { present: number; absent: number; late?: number };
  lockUntil?: string;
  lockUntilTs?: Timestamp;
  isLocked?: boolean;
};

type ClassTile = {
  CANON: string; // yearful e.g. "CSE-C-Y3" (or legacy if no year)
  DISPLAY: string; // e.g., "CSE C"
  section: string;
  year: number | null;
  present: number;
  absent: number;
  late?: number;  
  totalStudents: number; // roster size
  attDocId?: string;
};

type AttendanceSchedule = {
  enabled: boolean;
  startHHMM: string; // "06:00"
  endHHMM: string; // "08:20"
};
const DEFAULT_SCHEDULE: AttendanceSchedule = {
  enabled: true,
  startHHMM: "06:00",
  endHHMM: "08:20",
};

/* ---- slightly darker year tones for tiles ---- */
const YEAR_TONE: Record<1 | 2 | 3 | 4, { bg: string; border: string; text: string }> = {
  1: { bg: "#DBEAFE", border: "#93C5FD", text: "#0C4A6E" }, // sky
  2: { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D" }, // green
  3: { bg: "#E9D5FF", border: "#C4B5FD", text: "#4C1D95" }, // purple
  4: { bg: "#FEF3C7", border: "#FCD34D", text: "#7C2D12" }, // amber
};

export default function HodAttendance() {
  const router = useRouter();
  const navigation: any = useNavigation();
  const { width } = useWindowDimensions();
  const isPhone = width < 600;

  // 🔙 safe back (native → web → fallback)
  const safeBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    if (Platform.OS === "web" && typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    router.replace("/hod/classes"); // fallback route (adjust if your HOD home differs)
  };

  const handleSignOut = async () => {
    try {
      await signOut(getAuth());
      router.replace("/"); // tweak if your login route is different
    } catch {
      Alert.alert("Sign out failed", "Please try again.");
    }
  };

  const [dateKey, setDateKey] = useState<string>(() => todayIstKey());
  const [year, setYear] = useState<YearFilter>("All");

  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [attRows, setAttRows] = useState<AttendanceDoc[]>([]);

  // lock modal
  const [lockOpen, setLockOpen] = useState(false);
  const [lockHHMM, setLockHHMM] = useState("15:00"); // default
  const [lockClass, setLockClass] = useState<ClassTile | null>(null);

  // 🔔 master schedule state
  const [schedule, setSchedule] = useState<AttendanceSchedule | null>(null);
  const [schedLoading, setSchedLoading] = useState(true);
  const [schedModalOpen, setSchedModalOpen] = useState(false);
  const [editStart, setEditStart] = useState("06:00");
  const [editEnd, setEditEnd] = useState("08:20");

  /* ---------------------- load classes (live) ---------------------- */
  useEffect(() => {
    setLoading(true);
    const qy = query(collection(db, "classes"), where("dept", "==", DEPARTMENT));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: ClassDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            year: data?.year ?? null,
            dept: data?.dept ?? DEPARTMENT,
            section: (data?.section ?? "").toString(),
          };
        });
        setClasses(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  /* ---------------------- load attendance rows for date (live) ---------------------- */
  useEffect(() => {
    setLoading(true);
    const qy = query(collection(db, "attendance"), where("DATE", "==", dateKey));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: AttendanceDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            CLASS: (data?.CLASS ?? "").toString(),
            CLASS_CANON: (data?.CLASS_CANON ?? "").toString(),
            CLASS_DISPLAY: (data?.CLASS_DISPLAY ?? "").toString(),
            DATE: (data?.DATE ?? "").toString(),
            dept: data?.dept ?? DEPARTMENT,
            section: (data?.section ?? "").toString(),
            year: typeof data?.year === "number" ? data.year : null,
            counts: data?.counts
  ? { present: data.counts.present || 0, absent: data.counts.absent || 0, late: data.counts.late || 0 }
  : { present: 0, absent: 0, late: 0 },

            lockUntil: (data?.lockUntil ?? "").toString(),
            lockUntilTs: data?.lockUntilTs,
            isLocked: !!data?.isLocked,
          };
        });
        setAttRows(rows);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [dateKey]);

  /* ---------------------- subscribe: master attendance schedule ---------------------- */
  useEffect(() => {
    const ref = doc(db, "settings", "attendanceSchedule");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as AttendanceSchedule | undefined;
        if (data && typeof data.startHHMM === "string" && typeof data.endHHMM === "string") {
          setSchedule({
            enabled: !!data.enabled,
            startHHMM: data.startHHMM || "06:00",
            endHHMM: data.endHHMM || "08:20",
          });
        } else {
          setSchedule(DEFAULT_SCHEDULE); // doc missing → show defaults (no write)
        }
        setSchedLoading(false);
      },
      (err) => {
        console.error("[schedule]", err);
        setSchedule(DEFAULT_SCHEDULE);
        setSchedLoading(false);
      }
    );
    return () => unsub();
  }, []);

  /* ---------------------- class year lookup (legacy canon -> year) ---------------------- */
  const yearByCanon = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of classes) {
      const canon = canonicalClassKey(makeKey(DEPARTMENT, c.section));
      m.set(canon, typeof c.year === "number" ? c.year : null);
    }
    return m;
  }, [classes]);

  /* ---------------------- attendance rows mapped (yearful -> row) ---------------------- */
  const attByCanon = useMemo(() => {
    const m = new Map<string, AttendanceDoc & { id?: string }>();

    for (const r of attRows) {
      // Get legacy like "CSE-C" from whatever is present
      const legacy = canonicalClassKey(
        (r.CLASS_CANON || r.CLASS_DISPLAY || r.CLASS || makeKey(r.dept || DEPARTMENT, r.section)) ||
          ""
      );

      // Prefer explicit row.year; else infer via class lookup
      const rowYear = typeof r.year === "number" ? r.year : yearByCanon.get(legacy) ?? null;

      // Build a yearful key if we have year; else keep legacy (back-compat)
      const yrCanon = yearfulCanon(
        DEPARTMENT,
        extractSectionFromCanon(legacy) || r.section || "",
        rowYear
      );
      const key = rowYear ? yrCanon : legacy;

      if (key) m.set(key, r);
    }
    return m;
  }, [attRows, yearByCanon]);

  /* ---------------------- class tiles (filtered by year) ---------------------- */
  const baseTiles = useMemo(() => {
    const wantYear = year === "All" ? null : Number(year);
    const filtered = classes.filter((c) => {
      if (c.dept !== DEPARTMENT) return false;
      if (wantYear === null) return true;
      return (c.year ?? null) === wantYear;
    });

    return filtered.map<ClassTile>((c) => {
      const legacyCanon = canonicalClassKey(makeKey(DEPARTMENT, c.section)); // "CSE-C"
      const canon = yearfulCanon(
        DEPARTMENT,
        c.section || extractSectionFromCanon(legacyCanon) || "",
        typeof c.year === "number" ? c.year : yearByCanon.get(legacyCanon) ?? null
      ); // "CSE-C-Y3" (or legacy if no year)

      const att = attByCanon.get(canon) || attByCanon.get(legacyCanon);
      const counts = att?.counts ?? { present: 0, absent: 0 };

      return {
        CANON: canon,
        DISPLAY: legacyCanon.replace("-", " "),
        section: (c.section || extractSectionFromCanon(legacyCanon) || "").toString(),
        year: typeof c.year === "number" ? c.year : yearByCanon.get(legacyCanon) ?? null,
        present: counts.present || 0,
        absent: counts.absent || 0,
        late: counts.late || 0,
        totalStudents: 0,
        attDocId: att?.id,
      };
    });
  }, [classes, attByCanon, year, yearByCanon]);

  // sort A..Z, then A1..Z1, etc.
  function sectionOrderKey(section: string) {
    const m = (section || "").toUpperCase().match(/^([A-Z]+)(\d*)$/);
    const letters = m?.[1] ?? section.toUpperCase();
    const num = m?.[2] ? parseInt(m[2], 10) : 0;
    return `${String(num).padStart(4, "0")}-${letters}`;
  }

  /* ---------------------- roster sizes (students per class) with fallbacks ---------------------- */
  const [tiles, setTiles] = useState<ClassTile[]>([]);
  const [totalStudentsSum, setTotalStudentsSum] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const results = await Promise.all(
          baseTiles.map(async (t) => {
            let count = 0;
            try {
              // 1) Try exact yearful key, e.g., "CSE-C-Y3"
              let snap = await getDocs(query(collection(db, "students"), where("CLASS_CANON", "==", t.CANON)));

              // 2) Fallback: legacy + same year (if students store year separately)
              if ((snap as any)?.empty) {
                const legacy = legacyCanonFromYearful(t.CANON); // "CSE-C-Y3" -> "CSE-C"
                if (legacy !== t.CANON && (t.year ?? null) !== null) {
                  try {
                    snap = await getDocs(
                      query(
                        collection(db, "students"),
                        where("CLASS_CANON", "==", legacy),
                        where("year", "==", t.year as number)
                      )
                    );
                  } catch { /* ignore */ }
                }
              }

              count = (snap as any)?.size ?? 0;
            } catch { /* ignore */ }

            return { ...t, totalStudents: count };
          })
        );

        results.sort((a, b) => sectionOrderKey(a.section).localeCompare(sectionOrderKey(b.section)));

        if (alive) {
          setTiles(results);
          setTotalStudentsSum(results.reduce((sum, r) => sum + (r.totalStudents || 0), 0));
        }
      } finally {
        // no-op
      }
    })();
    return () => { alive = false; };
  }, [baseTiles]);

  /* ---------------------- KPIs (logic from tiles) ---------------------- */
  const kpiPA = useMemo(() => {
    const wantYear = year === "All" ? null : Number(year);
    const list = baseTiles.filter((t) => wantYear === null || t.year === wantYear);
    let p = 0, a = 0;
    for (const t of list) {
      p += t.present || 0;
      a += t.absent || 0;
    }
    return { present: p, absent: a };
  }, [baseTiles, year]);
const kpiLate = useMemo(() => {
  const wantYear = year === "All" ? null : Number(year);
  const list = baseTiles.filter((t) => wantYear === null || t.year === wantYear);
  let l = 0;
  for (const t of list) l += t.late || 0;
  return l;
}, [baseTiles, year]);

  // Year-wise totals for stacked bars (derived from tiles; works with yearful mapping)
  const yearTotals = useMemo(() => {
    const work: Record<"1" | "2" | "3" | "4", { p: number; a: number }> = {
      "1": { p: 0, a: 0 },
      "2": { p: 0, a: 0 },
      "3": { p: 0, a: 0 },
      "4": { p: 0, a: 0 },
    };
    for (const t of baseTiles) {
      if (t.year === 1 || t.year === 2 || t.year === 3 || t.year === 4) {
        const key = String(t.year) as "1" | "2" | "3" | "4";
        work[key].p += t.present || 0;
        work[key].a += t.absent || 0;
      }
    }
    return work;
  }, [baseTiles]);

  /* ---------------------- schedule + lock handlers ---------------------- */
  function validHHMM(x: string) {
    if (!/^\d{2}:\d{2}$/.test(x)) return false;
    const [h, m] = x.split(":").map((n) => Number(n));
    return h >= 0 && h < 24 && m >= 0 && m < 60;
  }

  const toggleEnabled = async () => {
    if (!schedule) return;
    const ref = doc(db, "settings", "attendanceSchedule");
    await setDoc(ref, { enabled: !schedule.enabled, updatedAt: serverTimestamp() }, { merge: true });
  };

  const openSchedModal = () => {
    if (schedule) {
      setEditStart(schedule.startHHMM);
      setEditEnd(schedule.endHHMM);
    }
    setSchedModalOpen(true);
  };

  const saveSchedule = async () => {
    const s = (editStart || "").trim();
    const e = (editEnd || "").trim();
    if (!validHHMM(s) || !validHHMM(e)) {
      return Alert.alert("Invalid time", "Enter HH:MM in 24-hour format.");
    }
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) {
      return Alert.alert("Invalid range", "End time must be after start time.");
    }

    const ref = doc(db, "settings", "attendanceSchedule");
    await setDoc(ref, { enabled: true, startHHMM: s, endHHMM: e, updatedAt: serverTimestamp() }, { merge: true });
    setSchedModalOpen(false);
  };

  const openLockFor = (t: ClassTile) => {
    setLockClass(t);
    setLockHHMM("15:00");
    setLockOpen(true);
  };
  const closeLock = () => {
    setLockOpen(false);
    setLockClass(null);
  };

  const saveLock = async () => {
    if (!lockClass) return;
    const hhmm = (lockHHMM || "15:00").trim();
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return;

    const lockDate = new Date(`${dateKey}T${hhmm}:00+05:30`);
    const lockUntilTs = Timestamp.fromDate(lockDate);
    const lockUntil = `${dateKey}T${hhmm}:00+05:30`;

    // prefer yearful row; fallback to legacy with same section
    const att = attByCanon.get(lockClass.CANON) || attByCanon.get(legacyCanonFromYearful(lockClass.CANON));
    let docId = att?.id;

    if (!docId) {
      docId = `${lockClass.CANON}__${dateKey}`;
      await setDoc(
        doc(db, "attendance", docId),
        {
          CLASS_CANON: lockClass.CANON,
          CLASS_DISPLAY: lockClass.DISPLAY,
          CLASS: lockClass.CANON, // legacy compatibility
          DATE: dateKey,
          dept: DEPARTMENT,
          section: lockClass.section,
          year: lockClass.year ?? null,
          counts: { present: 0, absent: 0 },
        },
        { merge: true }
      );
    }

    await updateDoc(doc(db, "attendance", docId), {
      lockUntil,
      lockUntilTs,
      isLocked: Timestamp.now().toMillis() > lockUntilTs.toMillis(),
      updatedAt: Timestamp.now(),
    });

    await refetch(dateKey, setLoading, setAttRows);
    closeLock();
  };

  /* ---------------------- visuals derived ---------------------- */
  const marked = kpiPA.present + kpiPA.absent + kpiLate;
  const coveragePct = percent(marked, totalStudentsSum);
  const presentPct = percent(kpiPA.present, Math.max(1, marked));

  /* ---------------------- simple mount animation ---------------------- */
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);

  /* ---------------------- render ---------------------- */
  return (
  <SafeAreaView
    style={{ flex: 1, backgroundColor: "#f3f4f6" }}
    edges={["top", "left", "right"]}
  >
    <LinearGradient colors={["#f9fafb", "#f3f4f6"]} style={s.container}>
      {/* header */}
      <Animated.View
        style={[
          s.headerWrap,
          isPhone && { padding: 8 },
          { opacity: fadeIn, transform: [{ translateY: fadeIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
        ]}
      >
        <View style={[s.headerTop, isPhone && { marginBottom: 4 }]}>
          {/* Back */}
          <TouchableOpacity onPress={safeBack} style={[s.backBtn, isPhone && { paddingVertical: 6, paddingHorizontal: 10 }]}>
            <Feather name="arrow-left" size={16} color="#111827" />
          </TouchableOpacity>

          <Text style={[s.title, isPhone && { fontSize: 20, marginBottom: 0 }]}>HOD Attendance</Text>

          {/* Sign Out */}
          <TouchableOpacity onPress={handleSignOut} style={[s.signOutBtn, isPhone && { paddingVertical: 6, paddingHorizontal: 10 }]}>
            <Text style={[s.signOutTxt, isPhone && { fontSize: 13 }]}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <LinearGradient colors={["#60a5fa", "#34d399"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.header, isPhone && { padding: 12 }]}>
          <View style={[s.headerControls, isPhone && s.headerControlsPhone]}>
            <View style={[s.dateBadge, isPhone && s.dateBadgePhone]}>
              <Text style={s.dateLabel}>Date (IST)</Text>
              <Text style={s.dateValue}>{fmtDateKey(dateKey)}</Text>
            </View>

            <View style={[s.navBtns, isPhone && s.navBtnsPhone]}>
              <Pill onPress={() => setDateKey(shiftDate(dateKey, -1))} label="Prev" />
              <Pill onPress={() => setDateKey(todayIstKey())} label="Today" />
              <Pill onPress={() => setDateKey(shiftDate(dateKey, +1))} label="Next" />
              <Pill onPress={() => refetch(dateKey, setLoading, setAttRows)} label="Refresh" dark />
            </View>
          </View>

          {/* year chips */}
          {/* year chips — single line; scrolls on mobile if needed */}
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={[s.yearRowH, isPhone && { paddingVertical: 2 }]}
>
  {(["All", "1", "2", "3", "4"] as const).map((y) => (
    <TouchableOpacity
      key={y}
      onPress={() => setYear(y)}
      style={[s.yearBtn, year === y && s.yearBtnActive]}
    >
      <Text style={[s.yearText, year === y && s.yearTextActive]}>
        {y === "All" ? "All Years" : `${y} Year`}
      </Text>
    </TouchableOpacity>
  ))}
</ScrollView>

        </LinearGradient>
      </Animated.View>

      {/* ===== PAGE SCROLL START (enables full-page vertical scrolling) ===== */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {loading && (
          <View style={{ paddingVertical: 8 }}>
            <ActivityIndicator color="#2563eb" />
          </View>
        )}

        {/* KPIs */}
        <View style={[s.kpis, isPhone && { gap: 8, marginHorizontal: 8 }]}>
          <KPIGradient label="Total Students" value={totalStudentsSum} colors={["#dbeafe", "#bfdbfe"]} />
          <KPIGradient label="Present" value={kpiPA.present} colors={["#bbf7d0", "#a7f3d0"]} />
          <KPIGradient label="Absent" value={kpiPA.absent} colors={["#fecaca", "#fee2e2"]} />
          <KPIGradient label="Late" value={kpiLate} colors={["#fef9c3", "#fde68a"]} />
        </View>

        {/* coverage + present% */}
        <View style={[s.progressWrap, isPhone && { marginHorizontal: 8, padding: 10 }]}>
          <ProgressBar title="Coverage (marked / total)" value={marked} max={Math.max(1, totalStudentsSum)} accent="#38bdf8" />
          <ProgressBar title="Present Ratio (present / marked)" value={kpiPA.present} max={Math.max(1, marked)} accent="#22c55e" />
          <Text style={s.progressHint}>Coverage: {formatPct(coveragePct)} • Present: {formatPct(presentPct)}</Text>
        </View>

        {/* Master schedule banner */}
        <View style={[s.schedBar, isPhone && { marginHorizontal: 8, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
          <View style={s.schedLeft}>
            <Text style={s.schedTitle}>Schedule time (IST)</Text>
            <Text style={s.schedTime}>{schedLoading ? "Loading…" : `${schedule?.startHHMM ?? "06:00"} – ${schedule?.endHHMM ?? "08:20"}`}</Text>
            {!!schedule && !schedule.enabled && <Text style={s.schedNote}>Disabled — mentors can save anytime</Text>}
          </View>
          <View style={[s.schedRight, isPhone && { alignSelf: "flex-start" }]}>
            <TouchableOpacity style={s.toggleBtn} onPress={toggleEnabled} disabled={schedLoading || !schedule}>
              <Text style={s.toggleTxt}>{schedule?.enabled ? "Disable" : "Enable"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.changeBtn} onPress={openSchedModal} disabled={schedLoading}>
              <Text style={s.changeTxt}>Change Schedule</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Year Totals (All) */}
        {year === "All" && (
          <View style={[s.yearTotals, isPhone && { marginHorizontal: 8 }]}>
            <Text style={s.sectionTitle}>Year-wise P/A</Text>
            <View style={s.yearBars}>
              {(["1", "2", "3", "4"] as const).map((y) => {
                const p = yearTotals[y].p, a = yearTotals[y].a, tot = Math.max(1, p + a);
                return (
                  <View key={y} style={s.yearBarRow}>
                    <Text style={s.yearBadge}>Y{y}</Text>
                    <View style={s.stackedBar}>
                      <View style={[s.segmentP, { flex: p / tot }]} />
                      <View style={[s.segmentA, { flex: a / tot }]} />
                    </View>
                    <Text style={s.yearPA}>{p}/{a}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Class tiles */}
        <Text style={[s.sectionTitle, isPhone && { marginHorizontal: 8 }]}>
          {year === "All" ? "Select a year to view classes." : `Classes in ${year} Year`}
        </Text>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }} nestedScrollEnabled>
          <View style={[s.tiles, isPhone && { paddingHorizontal: 8, gap: 10 }]}>
            {tiles.map((t, idx) => {
              const tone = (t.year === 1 || t.year === 2 || t.year === 3 || t.year === 4)
                ? YEAR_TONE[t.year as 1 | 2 | 3 | 4]
                : undefined;

              return (
                <TileCard
                  key={t.CANON}
                  index={idx}
                  title={t.DISPLAY}
                  tone={tone}
                  badge={t.year ? `Y${t.year}` : undefined}
                  fullWidth={isPhone}
                  onPress={() => {
    const display = t.year ? `${t.DISPLAY} (Year ${t.year})` : t.DISPLAY;
    router.push({
      pathname: "/admin/attendance",
      params: {
        cls: display,          // for header text in Admin
        clsCanon: t.CANON,     // yearful canon used for loading
        year: t.year ? String(t.year) : "",  // optional
        // mentor: "HOD",      // optional; add if you want it in Admin header
      },
    });
  }}
                >
                  <Row label="Total Students" value={t.totalStudents} />
                  <Row label="Present" value={t.present} />
                  <Row label="Absent" value={t.absent} />
                  <Row label="Late" value={t.late ?? 0} />

                  <View style={{ marginTop: 8 }}>
                    <MiniBar value={t.present} max={Math.max(1, t.totalStudents)} leftLabel="Present %" accent="#60a5fa" />
                  </View>

                  <TouchableOpacity style={s.editLockBtn} onPress={() => openLockFor(t)}>
                    <Text style={s.editLockTxt}>Edit Lock</Text>
                  </TouchableOpacity>
                </TileCard>
              );
            })}

            {!tiles.length && (
              <View style={{ padding: 12 }}>
                <Text style={{ color: "#6b7280" }}>No classes found for this filter.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </ScrollView>
      {/* ===== PAGE SCROLL END ===== */}

      {/* Schedule modal */}
      <Modal visible={schedModalOpen} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Change Schedule (IST)</Text>
            <Text style={{ color: "#6b7280", marginBottom: 6 }}>This window controls when mentors can mark for today.</Text>

            <Text style={s.label}>Start (HH:MM)</Text>
            <TextInput placeholder="06:00" value={editStart} onChangeText={setEditStart} style={s.input} keyboardType="numeric" />

            <Text style={[s.label, { marginTop: 8 }]}>End (HH:MM)</Text>
            <TextInput placeholder="08:20" value={editEnd} onChangeText={setEditEnd} style={s.input} keyboardType="numeric" />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: "#111827" }]} onPress={saveSchedule}>
                <Text style={[s.smallBtnTxt, { color: "#fff" }]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.smallBtn} onPress={() => setSchedModalOpen(false)}>
                <Text style={s.smallBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Lock modal */}
      <Modal visible={lockOpen} transparent animationType="fade">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Edit Lock Time (IST)</Text>
            <Text style={{ color: "#6b7280", marginBottom: 6 }}>
              Class: <Text style={{ fontWeight: "700" }}>{lockClass?.DISPLAY}</Text> — Date: {fmtDateKey(dateKey)}
            </Text>
            <TextInput placeholder="HH:MM (e.g., 16:00)" value={lockHHMM} onChangeText={setLockHHMM} style={s.input} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: "#111827" }]} onPress={saveLock}>
                <Text style={[s.smallBtnTxt, { color: "#fff" }]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.smallBtn]} onPress={closeLock}>
                <Text style={s.smallBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  </SafeAreaView>
);
}

/* -------------------- UI atoms -------------------- */
function KPIGradient({ label, value, colors }: { label: string; value: any; colors: [string, string] | string[] }) {
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.kpiBox}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{String(value)}</Text>
    </LinearGradient>
  );
}

function Pill({ label, onPress, dark }: { label: string; onPress: () => void; dark?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.pill, dark && s.pillDark]}>
      <Text style={[s.pillTxt, dark && s.pillTxtDark]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={s.tileRow}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileValue}>{value}</Text>
    </View>
  );
}

function TileCard({
  title,
  children,
  index,
  tone,
  badge,
  fullWidth,
  onPress,          // ← add this
}: React.PropsWithChildren<{
  title: string;
  index: number;
  tone?: { bg: string; border: string; text: string };
  badge?: string;
  fullWidth?: boolean;
  onPress?: () => void;
}>) {

  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 300, delay: index * 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [index]);

  return (
    <Animated.View
  style={[
    s.tile,
    fullWidth ? { width: "100%" } : { width: 240 },
    tone && { backgroundColor: tone.bg, borderColor: tone.border },
    {
      opacity: t,
      transform: [
        { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
        { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
      ],
    },
  ]}
>
  <TouchableOpacity activeOpacity={0.9} onPress={onPress} disabled={!onPress}>
    {!!badge && (
      <View style={[s.badge, tone && { backgroundColor: tone.border }]}>
        <Text style={s.badgeTxt}>{badge}</Text>
      </View>
    )}
    <Text style={[s.tileTitle, tone && { color: tone.text }]}>{title}</Text>
    {children}
  </TouchableOpacity>
</Animated.View>

  );
}


function MiniBar({ value, max, leftLabel, accent }: { value: number; max: number; leftLabel: string; accent: string }) {
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: pct, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View>
      <View style={s.miniBarHeader}>
        <Text style={s.miniBarLabel}>{leftLabel}</Text>
        <Text style={s.miniBarPct}>{formatPct(pct)}</Text>
      </View>
      <View style={s.miniBarTrack}>
        <Animated.View style={[s.miniBarFill, { backgroundColor: accent, width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
      </View>
    </View>
  );
}

function ProgressBar({ title, value, max, accent }: { title: string; value: number; max: number; accent: string }) {
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View style={s.progressBox}>
      <View style={s.progressHeader}>
        <Text style={s.progressTitle}>{title}</Text>
        <Text style={s.progressPct}>{formatPct(pct)}</Text>
      </View>
      <View style={s.progressTrack}>
        <Animated.View style={[s.progressFill, { backgroundColor: accent, width: anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
      </View>
    </View>
  );
}

/* -------------------- date & key helpers -------------------- */
function todayIstKey() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function shiftDate(dateKey: string, deltaDays: number) {
  const d = new Date(dateKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
function fmtDateKey(dateKey: string) {
  const d = new Date(dateKey + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
}
function makeKey(dept?: string, section?: string) {
  const sec = (section || "").toString().trim();
  const dep = (dept || DEPARTMENT).toString().trim();
  return sec ? `${dep}-${sec}` : dep;
}

/* -------------------- on-demand refetch -------------------- */
async function refetch(dateKey: string, setLoading: (b: boolean) => void, setAttRows: (r: AttendanceDoc[]) => void) {
  setLoading(true);
  try {
    const qy = query(collection(db, "attendance"), where("DATE", "==", dateKey));
    const snap = await getDocs(qy);
    const rows: AttendanceDoc[] = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        CLASS: (data?.CLASS ?? "").toString(),
        CLASS_CANON: (data?.CLASS_CANON ?? "").toString(),
        CLASS_DISPLAY: (data?.CLASS_DISPLAY ?? "").toString(),
        DATE: (data?.DATE ?? "").toString(),
        dept: data?.dept ?? DEPARTMENT,
        section: (data?.section ?? "").toString(),
        year: typeof data?.year === "number" ? data.year : null,
        counts: data?.counts
  ? { present: data.counts.present || 0, absent: data.counts.absent || 0, late: data.counts.late || 0 }
  : { present: 0, absent: 0, late: 0 },

        lockUntil: (data?.lockUntil ?? "").toString(),
        lockUntilTs: data?.lockUntilTs,
        isLocked: !!data?.isLocked,
      };
    });
    setAttRows(rows);
  } finally {
    setLoading(false);
  }
}

/* -------------------- util -------------------- */
function percent(num: number, den: number) {
  if (den <= 0) return 0;
  return Math.max(0, Math.min(1, num / den));
}
function formatPct(p: number) {
  const v = isFinite(p) ? Math.round(p * 100) : 0;
  return `${v}%`;
}

/* -------------------- styles (LIGHT UI) -------------------- */
const s = StyleSheet.create({
  container: { flex: 1 },

  headerWrap: { padding: 12 },
  header: {
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  title: { fontSize: 22, fontWeight: "800", color: "#111827", marginBottom: 8, letterSpacing: 0.2, alignSelf: "center" },

  headerControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateBadge: {
    backgroundColor: "rgba(255,255,255,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  yearRowH: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  marginTop: 12,
  paddingRight: 4, // a bit of end padding for scroll
},

  dateLabel: { color: "#374151", fontSize: 12 },
  dateValue: { color: "#111827", fontWeight: "700", fontSize: 14 },

  navBtns: { flexDirection: "row", gap: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e5e7eb" },
  pillDark: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  pillTxt: { color: "#111827", fontWeight: "700", fontSize: 12 },
  pillTxtDark: { color: "#fff" },

  yearRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  yearBtn: { borderWidth: 1, borderColor: "#e5e7eb", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#ffffff" },
  yearBtnActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  yearText: { fontSize: 13, color: "#111827" },
  yearTextActive: { color: "#fff", fontWeight: "800" },

  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginHorizontal: 12, marginTop: 6 },
  kpiBox: { flex: 1, minWidth: 160, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb" },
  kpiLabel: { fontSize: 12, color: "#374151" },
  kpiValue: { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 4 },

  progressWrap: { marginHorizontal: 12, marginTop: 10, padding: 12, backgroundColor: "#ffffff", borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb" },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressTitle: { color: "#111827", fontWeight: "700" },
  progressPct: { color: "#111827", fontWeight: "800" },
  progressTrack: { height: 10, borderRadius: 999, backgroundColor: "#e5e7eb", overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 999 },
  progressBox: { marginBottom: 10 },
  progressHint: { color: "#374151", marginTop: 2, fontSize: 12 },

  // schedule bar
  schedBar: { marginHorizontal: 12, marginTop: 12, padding: 12, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f9fafb" },
  schedLeft: { gap: 2 },
  schedTitle: { fontSize: 12, color: "#6b7280" },
  schedTime: { fontSize: 16, fontWeight: "700", color: "#111827" },
  schedNote: { fontSize: 12, color: "#ef4444", marginTop: 2 },
  schedRight: { flexDirection: "row", gap: 8 },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#e5e7eb" },
  toggleTxt: { fontWeight: "700", color: "#111827" },
  changeBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#111827" },
  changeTxt: { fontWeight: "700", color: "#fff" },

  yearTotals: { marginHorizontal: 12, marginTop: 12, padding: 12 },
  sectionTitle: { color: "#111827", fontWeight: "800", marginHorizontal: 12, marginTop: 12 },
  yearBars: { marginTop: 8 },
  yearBarRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 4 },
  yearBadge: { width: 34, textAlign: "center", color: "#111827", fontWeight: "700", backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e5e7eb", paddingVertical: 4, borderRadius: 8 },
  stackedBar: { flex: 1, height: 10, borderRadius: 999, overflow: "hidden", backgroundColor: "#e5e7eb", flexDirection: "row" },

  segmentP: { backgroundColor: "#10b981", height: "100%" },
  segmentA: { backgroundColor: "#ef4444", height: "100%" },
  yearPA: { color: "#111827", width: 64, textAlign: "right", fontWeight: "700" },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 12, paddingBottom: 16 },
  tile: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    position: "relative",
  },
  tileTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8, color: "#111827" },
  tileRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  tileLabel: { color: "#374151" },
  tileValue: { fontWeight: "800", color: "#111827" },

  editLockBtn: { marginTop: 10, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, paddingVertical: 8, alignItems: "center", backgroundColor: "#f3f4f6" },
  editLockTxt: { color: "#111827", fontWeight: "800" },

  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },

  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#111827",
    backgroundColor: "#FFFFFF",
  },
  headerControlsPhone: {
  // still a ROW on phones; just tighter spacing
  gap: 8,
},

navBtnsPhone: {
  flex: 1,
  flexDirection: "row",
  justifyContent: "flex-end",
  flexWrap: "nowrap",
  gap: 8,
  minWidth: 0,
},

dateBadgePhone: {
  maxWidth: "52%",      // date can shrink, never pushes buttons out
  flexShrink: 1,
  minWidth: 0,
},


  signOutBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EF4444",
    backgroundColor: "#FFFFFF",
  },
  signOutTxt: { color: "#EF4444", fontWeight: "800" },

  miniBarHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  miniBarLabel: { color: "#374151", fontSize: 12, fontWeight: "600" },
  miniBarPct: { color: "#111827", fontSize: 12, fontWeight: "800" },
  miniBarTrack: { height: 8, borderRadius: 999, backgroundColor: "#e5e7eb", overflow: "hidden" },
  miniBarFill: { height: 8, borderRadius: 999 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center" },
  modal: { width: 360, maxWidth: "92%", backgroundColor: "#ffffff", padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb" },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8, color: "#111827" },
  input: { borderWidth: 1, borderColor: "#e5e7eb", padding: 10, borderRadius: 8, color: "#111827", backgroundColor: "#ffffff" },

  smallBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#ffffff" },
  smallBtnTxt: { fontSize: 12, fontWeight: "700", color: "#111827" },

  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.12)",
  },
  badgeTxt: { fontSize: 11, fontWeight: "800", color: "#111827" },
});
