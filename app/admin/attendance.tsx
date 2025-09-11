// app/admin/attendance.tsx
import { Buffer } from "buffer";
(global as any).Buffer = Buffer;

import Checkbox from "expo-checkbox";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { getAuth, signOut } from "firebase/auth";
import XLSX from "xlsx-js-style";

import dayjs from "dayjs";
import { Calendar } from "react-native-calendars";

import { CORRECTION_CUTOFF_HOUR, DEPARTMENT } from "@/constants/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";

// 🔑 Canonical helpers (year-aware)
import {
  canonicalClassKey,
  classDisplayFromCanon,
  extractSectionFromCanon,
  legacyCanonFromYearful,
  yearfulCanon,
} from "../../constants/classKey";

/* ---------------------- THEME ---------------------- */
const NAVY = "#000080";
const NAVY_SOFT = "#E6E8FF";
const NAVY_BORDER = "#B3B8FF";
const MUTED_BG = "#F5F7FF";

// Gradients
// lighter shades (like HOD)
const PRESENT_GRAD = ["#bbf7d0", "#86efac"] as const; // light green
const ABSENT_GRAD  = ["#fecaca", "#fca5a5"] as const; // light red
const TOTAL_GRAD   = ["#e9d5ff", "#bae6fd"] as const; // soft purple -> soft sky
const LATE_GRAD    = ["#fef9c3", "#fde68a"] as const; // soft yellow

const BTN_GRAD = [NAVY, "#4c4cff"] as const; // navy -> bright blue
const DL_GRAD = ["#0ea5e9", "#38bdf8"] as const; // sky
const BG_GRAD = ["#EEF2FF", "#F5FBFF"] as const; // page bg

const norm = (x: any) => (x ?? "").toString().trim().toUpperCase();
// Natural compare for roll numbers like "23CS103"
const splitTokens = (s: string) => (s || '').match(/\d+|[A-Za-z]+|[^A-Za-z0-9]+/g) ?? [];
const natCmp = (a: string, b: string) => {
  const A = splitTokens(a.toUpperCase());
  const B = splitTokens(b.toUpperCase());
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i] ?? ''; const y = B[i] ?? '';
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      const dx = Number(x), dy = Number(y);
      if (dx !== dy) return dx - dy;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
};

/* ---------------------- helpers ---------------------- */
const sectionFromCanon = (canon: string) => extractSectionFromCanon(canon) || "";

const fetchClassMeta = async (clsCanon: string) => {
  try {
    const section = sectionFromCanon(clsCanon);
    const qy = query(
      collection(db, "classes"),
      where("dept", "==", DEPARTMENT),
      where("section", "==", section)
    );
    const snap = await getDocs(qy);
    if (!snap.empty) {
      const d = snap.docs[0].data() as any;
      return {
        year: typeof d.year === "number" ? d.year : null,
        section: (d.section ?? section)?.toString(),
      };
    }
  } catch {}
  return { year: null, section: sectionFromCanon(clsCanon) };
};

const decodeMark = (mark: any) => {
  if (!mark) return { present: false, absent: false, late: false };
  if (typeof mark === "string") {
    return { present: mark === "P", absent: mark === "A", late: mark === "L" };
  }
  return { present: !!mark.present, absent: !!mark.absent, late: !!mark.late };
};


const computeCounts = (arr: { present: boolean; absent: boolean; late?: boolean }[]) => {
  let present = 0, absent = 0, late = 0;
  for (const s of arr) {
    if (s.present) present++;
    else if (s.absent) absent++;
    else if (s.late) late++;
  }
  return { present, absent, late };
};


const istDateAt = (dateKey: string, hour: number, minute = 0) =>
  new Date(
    `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`
  );

// 🔔 Master window types/helpers
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

const parseHHMM = (x: string) => {
  const [h, m] = (x || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const getNowISTMinutes = () => {
  const nowIST = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  return nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
};
const todayIstKey = () => {
  const nowIST = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  return nowIST.toISOString().slice(0, 10);
};

/* --------------------------------------------------------- */

interface Student {
  key: string;
  NAME: string;
  ROLLNO: string;
  EMAIL: string;
  CLASS: string; // display label
  CLASS_CANON?: string; // normalized key
  present: boolean;
  absent: boolean;
  late: boolean;
  mentor?: string;
}

// keep types happy by declaring after Student
const dedupeByRoll = (arr: Student[]) => {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const r = norm(s.ROLLNO);
    if (!r || seen.has(r)) return false;
    seen.add(r);
    return true;
  });
};

export default function AdminAttendance() {
  // route params
  const params = useLocalSearchParams() as {
    cls?: string | string[]; // e.g. "CSE-C (Year 1)" or "CSE-C"
    clsCanon?: string | string[]; // "CSE-C" or "CSE-C-Y1"
    year?: string | string[]; // numeric as string
    mentor?: string | string[];
  };
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? "";

  const CLS_DISPLAY_RAW = one(params.cls).trim(); // UI label as passed
  const CLS_CANON_PARAM = one(params.clsCanon).trim(); // may be legacy or yearful
  const YEAR_PARAM = one(params.year).trim();
  const MENTOR = one(params.mentor).trim();

  // derive YEAR from param or title "(Year x)"
  const yearFromTitle = (() => {
    const m = CLS_DISPLAY_RAW.match(/\(Year\s*(\d)\)/i);
    return m ? Number(m[1]) : null;
  })();
  const YEAR_INT: number | null = YEAR_PARAM ? Number(YEAR_PARAM) : yearFromTitle;

  // SECTION from base canon
  const SECTION =
    extractSectionFromCanon(
      canonicalClassKey(CLS_CANON_PARAM || CLS_DISPLAY_RAW.split(" (Year")[0])
    ) || "";

  // Build yearful canon if we know year, else legacy
  const CLS_CANON = YEAR_INT
    ? yearfulCanon(DEPARTMENT, SECTION, YEAR_INT) // "CSE-C-Y1"
    : canonicalClassKey(CLS_CANON_PARAM || CLS_DISPLAY_RAW); // "CSE-C" (legacy)

  const LEGACY_CANON = legacyCanonFromYearful(CLS_CANON); // "CSE-C"
  const CLS_DISPLAY = classDisplayFromCanon(LEGACY_CANON, YEAR_INT ?? undefined); // pretty label

  const router = useRouter();

  const [students, setStudents] = useState<Student[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRoll, setNewRoll] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [success, setSuccess] = useState(false);
const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [selectedDate, setSelectedDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [savingDay, setSavingDay] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  // 🔔 Master window state
  const [schedule, setSchedule] = useState<AttendanceSchedule | null>(null);
  const [schedLoading, setSchedLoading] = useState(true);

  // Select-all header flags (derived each render)
const allPresent = useMemo(() => students.length > 0 && students.every(s => s.present), [students]);
const allAbsent  = useMemo(() => students.length > 0 && students.every(s => s.absent),  [students]);
const allLate    = useMemo(() => students.length > 0 && students.every(s => s.late),    [students]);


  // layout
  const { width } = useWindowDimensions();
  const isWide = width >= 900; // side-by-side threshold

  // Subscribe to master schedule
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
          setSchedule(DEFAULT_SCHEDULE);
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

  // Window status (only matters for *today* in IST)
  const isTodayIST = useMemo(() => selectedDate === todayIstKey(), [selectedDate]);
  const windowStatus = useMemo(() => {
    if (!schedule || !schedule.enabled) return { open: true, label: "Disabled" };
    if (!isTodayIST) return { open: true, label: "Not today" };
    const nowMin = getNowISTMinutes();
    const startMin = parseHHMM(schedule.startHHMM);
    const endMin = parseHHMM(schedule.endHHMM);
    const open = nowMin >= startMin && nowMin <= endMin;
    return { open, label: `${schedule.startHHMM}–${schedule.endHHMM} IST` };
  }, [schedule, isTodayIST]);

  // is it past today's correction cutoff?
  const afterLockIST = useMemo(() => {
    if (!isTodayIST) return false;
    const lockDate = istDateAt(selectedDate, CORRECTION_CUTOFF_HOUR, 0);
    return new Date() > lockDate;
  }, [isTodayIST, selectedDate]);

  // final: can we edit attendance right now?
  const canEditAttendance = useMemo(() => {
    if (!isTodayIST) return false; // 🚫 not today = read-only
    if (afterLockIST) return false; // 🚫 after correction cutoff
    if (!schedule || !schedule.enabled) return true; // ✅ window disabled = free to edit today
    return windowStatus.open; // ✅ within master window
  }, [isTodayIST, afterLockIST, schedule, windowStatus]);

  const pad2 = (n: number) => String(n).padStart(2, "0");

  // Load roster + attendance for the selected date (year-aware)
  useEffect(() => {
    const load = async () => {
      // 1) roster — prefer yearful, then legacy+same year, then legacy display
      let baseStudents: Student[] = [];
      try {
        // yearful
        let snap = await getDocs(
          query(collection(db, "students"), where("CLASS_CANON", "==", CLS_CANON))
        );

        // fallback: legacy + same year (if we know year)
        if (snap.empty && YEAR_INT != null) {
          try {
            snap = await getDocs(
              query(
                collection(db, "students"),
                where("CLASS_CANON", "==", LEGACY_CANON),
                where("year", "==", YEAR_INT)
              )
            );
          } catch {}
        }

        // fallback: purely legacy display match (very old)
        if (snap.empty) {
          const q1 = query(collection(db, "students"), where("CLASS", "==", CLS_DISPLAY_RAW));
          snap = await getDocs(q1);
        }

        baseStudents = snap.docs.map((d) => {
          const dat = d.data() as any;
          return {
            ...dat,
            ROLLNO: norm(dat.ROLLNO),
            NAME: (dat.NAME ?? "").toString().trim(),
            EMAIL: (dat.EMAIL ?? "").toString().trim(),
            CLASS: (dat.CLASS ?? CLS_DISPLAY).toString().trim(),
            CLASS_CANON: (dat.CLASS_CANON ?? CLS_CANON).toString(),
            key: d.id,
            present: !!dat.present,
            absent: !!dat.absent,
            late: !!dat.late,
          } as Student;
        });
      } catch {}

      // 2) per-day marks — prefer yearful doc id, fallback to legacy
      const idCanon = `${CLS_CANON}__${selectedDate}`;
      const idLegacy = `${LEGACY_CANON}__${selectedDate}`;
      let snap = await getDoc(doc(db, "attendance", idCanon));
      if (!snap.exists()) {
        const snapLegacy = await getDoc(doc(db, "attendance", idLegacy));
        if (snapLegacy.exists()) snap = snapLegacy;
      }

      if (!snap.exists()) {
  setStudents(dedupeByRoll(baseStudents).map((s) => ({ ...s, present: false, absent: false, late: false })));
  return;
}


      const data = snap.data() as any;
      const marks = data?.marks || {};
      const base = dedupeByRoll(baseStudents);

      setStudents(
        base.map((s) => {
          const byRoll = marks[norm(s.ROLLNO)];
          const decoded = decodeMark(byRoll);
          return { ...s, present: decoded.present, absent: decoded.absent, late: decoded.late };
        })
      );
    };

    load();
  }, [selectedDate, CLS_CANON, LEGACY_CANON, CLS_DISPLAY, CLS_DISPLAY_RAW, YEAR_INT]);

  // Save roster (year-aware cleanup + write)
  const saveStudents = async () => {
    const studentsCol = collection(db, "students");

    // wipe old roster of this class (handles legacy + year as number/string + display variants)
    const qYearful = query(studentsCol, where("CLASS_CANON", "==", CLS_CANON));
    const qLegacyAny = query(studentsCol, where("CLASS_CANON", "==", LEGACY_CANON));
    const qLegacyNum =
      YEAR_INT != null
        ? query(studentsCol, where("CLASS_CANON", "==", LEGACY_CANON), where("year", "==", YEAR_INT))
        : null;
    const qLegacyStr =
      YEAR_INT != null
        ? query(studentsCol, where("CLASS_CANON", "==", LEGACY_CANON), where("year", "==", String(YEAR_INT)))
        : null;
    const qDisplay = query(studentsCol, where("CLASS", "==", CLS_DISPLAY));
    const qDisplayRaw = query(studentsCol, where("CLASS", "==", CLS_DISPLAY_RAW));

    const snaps = await Promise.all([
      getDocs(qYearful),
      getDocs(qLegacyAny),
      qLegacyNum ? getDocs(qLegacyNum) : Promise.resolve({ docs: [] } as any),
      qLegacyStr ? getDocs(qLegacyStr) : Promise.resolve({ docs: [] } as any),
      getDocs(qDisplay),
      getDocs(qDisplayRaw),
    ]);

    // delete all matches (dedupe by id)
    const toDelete = new Map<string, any>();
    snaps.forEach((s) => (s as any).docs?.forEach((d: any) => toDelete.set(d.id, d)));
    for (const [id] of toDelete) {
      await deleteDoc(doc(db, "students", id));
    }

    // write fresh roster with yearful + display (sanitized list)
    const clean = dedupeByRoll(students);
    for (let stu of clean) {
      const { key, ...data } = stu;
      await addDoc(studentsCol, {
        NAME: (data.NAME ?? "").toString().trim(),
        ROLLNO: norm(data.ROLLNO),
        EMAIL: (data.EMAIL ?? "").toString().trim(),
        CLASS: CLS_DISPLAY, // label with (Year x)
        CLASS_CANON: CLS_CANON, // 🔑 yearful join key
        year: YEAR_INT ?? null, // numeric year
        mentor: MENTOR,
      });
    }

    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      router.replace({ pathname: "/admin/dashboard", params: { mentor: MENTOR } });
    }, 1200);
  };

  // Save per-day attendance (yearful doc id + legacy cleanup)
  const saveAttendanceForDate = async () => {
    if (!CLS_CANON) return;

    // Hard block for non-today dates (read-only UX)
    if (!isTodayIST) {
      return Alert.alert(
        "Read-only",
        "You can only edit today's attendance. Use the calendar to switch back to today."
      );
    }

    // Master window guard (for today)
    if (schedule?.enabled && isTodayIST && !windowStatus.open) {
      return Alert.alert(
        "Attendance window is closed",
        `Allowed only between ${schedule.startHHMM}–${schedule.endHHMM} (IST) for today.`
      );
    }

    // client-side lock check
    const lockDate = istDateAt(selectedDate, CORRECTION_CUTOFF_HOUR, 0);
    if (new Date() > lockDate) {
      return Alert.alert(
        "Locked",
        `Edits closed for ${selectedDate} (after ${String(CORRECTION_CUTOFF_HOUR).padStart(
          2,
          "0"
        )}:00 IST). Ask HOD to extend lock time.`
      );
    }

    setSavingDay(true);
    try {
      // marks
const marks: Record<string, { present: boolean; absent: boolean; late: boolean } | "P" | "A" | "L"> = {};
for (const s of students) {
  const r = norm(s.ROLLNO);
  if (!r) continue;
  marks[r] = { present: !!s.present, absent: !!s.absent, late: !!s.late };
}

const { present, absent, late } = computeCounts(students);

      // meta (ensure section + year)
      const meta = await fetchClassMeta(CLS_CANON);
      const section = SECTION || meta.section || sectionFromCanon(CLS_CANON);
      const year = YEAR_INT ?? meta.year;

      // lock fields
      const lockUntilIso = `${selectedDate}T${String(CORRECTION_CUTOFF_HOUR).padStart(
        2,
        "0"
      )}:00:00+05:30`;
      const lockUntilTs = Timestamp.fromDate(lockDate);

      // prefer yearful doc id; keep legacy cleanup
      const idCanon = `${CLS_CANON}__${selectedDate}`;
      const idLegacy = `${LEGACY_CANON}__${selectedDate}`;
      const refCanon = doc(db, "attendance", idCanon);

      await setDoc(
        refCanon,
        {
          CLASS_CANON: CLS_CANON,
          CLASS_DISPLAY: CLS_DISPLAY,
          CLASS: CLS_CANON,
          DATE: selectedDate,
          dept: DEPARTMENT,
          section,
          year,
          mentor: MENTOR,
          updatedAt: serverTimestamp(),
          lockUntil: lockUntilIso,
          lockUntilTs,
          isLocked: false,
          counts: { present, absent, late },
          marks,
        },
        { merge: true }
      );

      // delete legacy dup if exists
      const legacySnap = await getDoc(doc(db, "attendance", idLegacy));
      if (legacySnap.exists() && idLegacy !== idCanon) {
        try {
          await deleteDoc(doc(db, "attendance", idLegacy));
        } catch {}
      }

      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1000);
    } catch (e) {
      console.error(e);
      Alert.alert("Save failed", "Could not save attendance for this date.");
    } finally {
      setSavingDay(false);
    }
  };

  // Excel export (unchanged)
const downloadAttendanceExcel = () => {
  if (!students.length) {
    Alert.alert("No data", "No students to export.");
    return;
  }

  const rows: any[][] = [["SNO", "NAME", "ROLLNO", "EMAIL", "CLASS", "DATE", "Present", "Absent", "Late"]];
  students.forEach((s, idx) => {
    rows.push([
      idx + 1,
      s.NAME,
      s.ROLLNO,
      s.EMAIL,
      s.CLASS,
      selectedDate,
      s.present ? "P" : "",
      s.absent ? "A" : "",
      s.late ? "L" : "",
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  (ws as any)["!cols"] = [
    { wch: 5 },  { wch: 22 }, { wch: 12 }, { wch: 26 }, { wch: 10 },
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];

  const header = ["A1","B1","C1","D1","E1","F1","G1","H1","I1"];
  header.forEach((addr) => {
    if ((ws as any)[addr]) {
      (ws as any)[addr].s = {
        font: { bold: true },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
  });

  students.forEach((s, idx) => {
    const r = idx + 2;
    const presentAddr = `G${r}`;
    const absentAddr  = `H${r}`;
    const lateAddr    = `I${r}`;

    if ((ws as any)[presentAddr] && s.present) {
      (ws as any)[presentAddr].s = {
        fill: { patternType: "solid", fgColor: { rgb: "92D050" } },
        font: { color: { rgb: "FFFFFF" }, bold: true },
        alignment: { horizontal: "center" },
      };
    }
    if ((ws as any)[absentAddr] && s.absent) {
      (ws as any)[absentAddr].s = {
        fill: { patternType: "solid", fgColor: { rgb: "FF0000" } },
        font: { color: { rgb: "FFFFFF" }, bold: true },
        alignment: { horizontal: "center" },
      };
    }
    if ((ws as any)[lateAddr] && s.late) {
      (ws as any)[lateAddr].s = {
        fill: { patternType: "solid", fgColor: { rgb: "FFD966" } }, // yellow
        font: { color: { rgb: "000000" }, bold: true },
        alignment: { horizontal: "center" },
      };
    }
  });

  XLSX.utils.book_append_sheet(wb, ws, "Attendance");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  if (Platform.OS === "web") {
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${LEGACY_CANON || "class"}_${selectedDate}_attendance.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    Alert.alert("Download", "Web download ready. For native, we can add FileSystem + Share next.");
  }
};


  // Import Excel (native/web) — de-duped
  const importExcelNative = async () => {
    const res = (await DocumentPicker.getDocumentAsync({
      type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      copyToCacheDirectory: true,
    })) as any;
    if (res.type === "cancel") return;
    const name = res.name ?? "";
    if (!name.toLowerCase().endsWith(".xlsx")) {
      return Alert.alert("Invalid file", "Please select a .xlsx file");
    }
    try {
      const uri: string = res.uri;
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const wb = XLSX.read(b64, { type: "base64" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(ws);
      const list: Student[] = data.map((d, i) => ({
        key: `${Date.now()}-${i}`,
        NAME: d.NAME ?? "",
        ROLLNO: norm(d.ROLLNO ?? ""),
        EMAIL: d.EMAIL ?? "",
        CLASS: CLS_DISPLAY,
        CLASS_CANON: CLS_CANON,
        present: false,
        absent: false,
        late: false,
        mentor: MENTOR,
      }));
      setStudents(dedupeByRoll(list));
    } catch {
      Alert.alert("Parse error", "Could not parse this file.");
    }
  };

  const handleWebFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return Alert.alert("Invalid file", "Please select a .xlsx file");
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = (ev.target?.result as string).split(",")[1];
      try {
        const wb = XLSX.read(b64, { type: "base64" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any>(ws);
        const list: Student[] = data.map((d, i) => ({
          key: `${Date.now()}-${i}`,
          NAME: d.NAME ?? "",
          ROLLNO: norm(d.ROLLNO ?? ""),
          EMAIL: d.EMAIL ?? "",
          CLASS: CLS_DISPLAY,
          CLASS_CANON: CLS_CANON,
          present: false,
          absent: false,
          late: false,
          mentor: MENTOR,
        }));
        setStudents(dedupeByRoll(list));
      } catch {
        Alert.alert("Parse error", "Could not parse this file.");
      }
    };
    reader.readAsDataURL(file);
  };

  const toggle = (key: string, field: "present" | "absent" | "late") =>
  setStudents((prev) =>
    prev.map((s) =>
      s.key === key
        ? field === "present"
          ? { ...s, present: !s.present, absent: false, late: false }
          : field === "absent"
          ? { ...s, present: false, absent: !s.absent, late: false }
          : { ...s, present: false, absent: false, late: !s.late }
        : s
    )
  );
const selectAll = (field: "present" | "absent" | "late") => {
  if (!canEditAttendance) return;
  setStudents((prev) => {
    const every = prev.length > 0 && prev.every((s) => s[field]);
    return prev.map((s) =>
      field === "present"
        ? { ...s, present: !every, absent: false, late: false }
        : field === "absent"
        ? { ...s, present: false, absent: !every, late: false }
        : { ...s, present: false, absent: false, late: !every }
    );
  });
};


  const deleteStudent = (key: string) => setStudents((prev) => prev.filter((s) => s.key !== key));

  const confirmAddStudent = () => {
    if (!newName.trim() || !newRoll.trim() || !newEmail.trim()) return;

    // prevent duplicate roll numbers
    if (students.some((s) => norm(s.ROLLNO) === norm(newRoll))) {
      Alert.alert("Duplicate", "That roll number already exists.");
      return;
    }

    const student: Student = {
      key: `${Date.now()}`,
      NAME: newName.trim(),
      ROLLNO: norm(newRoll),
      EMAIL: newEmail.trim(),
      CLASS: CLS_DISPLAY,
      CLASS_CANON: CLS_CANON,
      present: false,
      absent: false,
      late: false,
      mentor: MENTOR,
    };

    setStudents((prev) => dedupeByRoll([...prev, student]));
    setNewName("");
    setNewRoll("");
    setNewEmail("");
    setShowAddModal(false);
  };

  const COLUMNS = ["SNO", "NAME", "ROLLNO", "EMAIL", "CLASS", "Present", "Absent", "Late", "Delete"];

  // derived UI-only counts
  const presentCount = students.filter((s) => s.present).length;
  const absentCount = students.filter((s) => s.absent).length;
  const lateCount = students.filter((s) => s.late).length;

const sortedStudents = useMemo(() => {
  const arr = [...students];
  arr.sort((s1, s2) => {
    const cmp = natCmp(s1.ROLLNO, s2.ROLLNO);
    return sortDir === "asc" ? cmp : -cmp;
  });
  return arr;
}, [students, sortDir]);

  // prettier calendar: navy theme + dot on today + selected day fill
  const markedDates = useMemo(() => {
    const m: any = {
      [selectedDate]: { selected: true, selectedColor: NAVY },
    };
    const td = todayIstKey();
    if (td !== selectedDate) {
      m[td] = { marked: true, dotColor: NAVY };
    }
    return m;
  }, [selectedDate]);

  const doSignOut = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
    } catch {}
    router.replace({ pathname: "/admin/login" });
  };

  /* ------------------------- UI (scroll enabled) ------------------------- */
  return (
    <SafeAreaView style={s.container}>
      <LinearGradient colors={BG_GRAD} style={StyleSheet.absoluteFillObject} pointerEvents="none" />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }}>
        {/* HEADER CARD */}
        <View style={s.card}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            {/* Left cluster: Back + Title */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 }}>
              <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Go Back">
                <MaterialCommunityIcons name="arrow-left" size={18} color={NAVY} />
              </TouchableOpacity>
              <View style={s.iconBadge}>
  <MaterialCommunityIcons name="account-group" size={20} color="#fff" />
</View>

              <View style={{ minWidth: 120 }}>
                <Text style={s.headerTitle}>Class: {CLS_DISPLAY}</Text>
                <Text style={s.headerSub}>Mentor: {MENTOR}</Text>
              </View>
            </View>

            {/* Right cluster: Import / Today / Sign out */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {Platform.OS === "web" ? (
                <>
                  <input id="filepicker" type="file" accept=".xlsx" style={{ display: "none" }} onChange={handleWebFile} />
                  <TouchableOpacity
                    style={s.outlineBtn}
                    onPress={() => (document.getElementById("filepicker") as HTMLInputElement)!.click()}
                  >
                    <Text style={s.outlineBtnTxt}>Import Excel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={s.outlineBtn} onPress={importExcelNative}>
                  <Text style={s.outlineBtnTxt}>Import Excel</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={s.outlineBtn} onPress={() => setSelectedDate(dayjs().format("YYYY-MM-DD"))}>
                <Text style={s.outlineBtnTxt}>Today</Text>
              </TouchableOpacity>

              {/* 🔴 Sign Out */}
              <TouchableOpacity style={s.dangerBtn} onPress={doSignOut}>
                <Text style={s.dangerBtnTxt}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* CALENDAR + STATS (50/50 on wide) */}
        <View style={[s.card, isWide ? s.rowSplit : undefined]}>
          {/* Calendar half */}
          <View style={[isWide ? s.col70 : s.stack, { paddingRight: isWide ? 10 : 0 }]}>
            <Text style={s.sectionTitle}>{dayjs(selectedDate).format("MMMM YYYY")}</Text>

            <View style={s.statusRow}>
              <View style={[s.pill, windowStatus.open ? s.pillOpen : s.pillClosed]}>
                <Text style={s.pillTxt}>
                  {windowStatus.open ? "Window Open" : "Window Closed"} • {windowStatus.label}
                </Text>
              </View>
              {!isTodayIST && (
                <View style={[s.pill, s.pillInfo]}>
                  <Text style={s.pillTxt}>Viewing past/future date • Read-only</Text>
                </View>
              )}
            </View>

            <View style={{ width: "100%" }}>
              <Calendar
                markedDates={markedDates}
                onDayPress={(d) => setSelectedDate(dayjs(d.dateString).format("YYYY-MM-DD"))}
                enableSwipeMonths
                style={s.calendarBoxFull}          // 👈 fills this half
                theme={{
                  calendarBackground: "#fff",
                  textSectionTitleColor: "#334155",
                  monthTextColor: NAVY,
                  textMonthFontWeight: "800",
                  arrowColor: NAVY,
                  todayTextColor: NAVY,
                  dayTextColor: "#0f172a",
                  textDisabledColor: "#cbd5e1",
                  selectedDayBackgroundColor: NAVY,
                  selectedDayTextColor: "#ffffff",
                  textDayFontSize: 14,
                  textMonthFontSize: 18,
                  textDayHeaderFontSize: 12,
                }}
              />
            </View>

            <TouchableOpacity
              disabled={!canEditAttendance || schedLoading || savingDay}
              onPress={saveAttendanceForDate}
              style={{
                borderRadius: 10,
                overflow: "hidden",
                marginTop: 10,
                alignSelf: "flex-end",
                opacity: !canEditAttendance || schedLoading || savingDay ? 0.6 : 1,
              }}
            >
              <LinearGradient colors={BTN_GRAD} style={s.btnGrad}>
                <Text style={s.btnGradTxt}>
                  {schedLoading
                    ? "Checking window…"
                    : !isTodayIST
                    ? "Viewing (read-only: not today)"
                    : afterLockIST
                    ? `Locked after ${pad2(CORRECTION_CUTOFF_HOUR)}:00 IST`
                    : schedule?.enabled && !windowStatus.open
                    ? `Window Closed (${schedule.startHHMM}–${schedule.endHHMM} IST)`
                    : `Save Attendance (${selectedDate})`}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Stats half — now vertical stack (Present, Absent, Total one below another) */}
          <View style={[isWide ? s.col30 : s.stack, { paddingLeft: isWide ? 10 : 0 }]}>
            <View style={s.statsColumn}>
              <View style={s.statCard}>
                <LinearGradient colors={PRESENT_GRAD} style={s.statGrad} />
                <Text style={s.statTitle}>Present</Text>
                <Text style={s.statValue}>{presentCount}</Text>
              </View>
              <View style={s.statCard}>
                <LinearGradient colors={ABSENT_GRAD} style={s.statGrad} />
                <Text style={s.statTitle}>Absent</Text>
                <Text style={s.statValue}>{absentCount}</Text>
              </View>
              <View style={s.statCard}>
                <LinearGradient colors={LATE_GRAD} style={s.statGrad} />
                <Text style={s.statTitle}>Late</Text>
                <Text style={s.statValue}>{lateCount}</Text>
              </View>
              <View style={s.statCard}>
                <LinearGradient colors={TOTAL_GRAD} style={s.statGrad} />
                <Text style={s.statTitle}>Total</Text>
                <Text style={s.statValue}>{students.length}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* TABLE CARD (centered) */}
        <View style={s.card}>
  <Text style={s.sectionTitle}>Student Attendance</Text>


          <View style={s.tableShell}>
<ScrollView
  horizontal
  showsHorizontalScrollIndicator
  style={s.grid}
  contentContainerStyle={s.gridContent}
>

              <View style={{ alignSelf: "center" }}>
                {/* Header */}
                <View style={s.rowHeader}>
{COLUMNS.map((col, i) => {
  const baseStyle = [
    s.cell, s.headerCell,
    i === 0 && s.snoCell,
    i === 1 && s.nameCell,
    i === 2 && s.rollCell,
    i === 3 && s.emailCell,
    i === 4 && s.classCell,
    (i === 5 || i === 6 || i === 7) && s.checkCell, // P/A/L
    i === 8 && s.delCell, // Delete shifts right
  ];

  // Sortable ROLLNO
  if (col === "ROLLNO") {
    return (
      <TouchableOpacity
        key="ROLLNO"
        onPress={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
        style={[...baseStyle, { flexDirection: "row", alignItems: "center", justifyContent: "center" }]}
        accessibilityRole="button"
        accessibilityLabel={`Sort by roll number, currently ${sortDir === "asc" ? "ascending" : "descending"}`}
      >
        <Text style={s.headerText}>ROLLNO</Text>
        <MaterialCommunityIcons name={sortDir === "asc" ? "arrow-up" : "arrow-down"} size={16} color="#fff" style={s.thArrow} />
      </TouchableOpacity>
    );
  }

  // Select-all checkboxes for Present/Absent/Late
  if (col === "Present" || col === "Absent" || col === "Late") {
    const value = col === "Present" ? allPresent : col === "Absent" ? allAbsent : allLate;
    const onChange = () => selectAll(col === "Present" ? "present" : col === "Absent" ? "absent" : "late");
    return (
      <View key={col} style={[...baseStyle, { flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center" }]}>
        <Text style={s.headerText}>{col}</Text>
        <Checkbox value={value} onValueChange={onChange} disabled={!canEditAttendance} />
      </View>
    );
  }

  // Default header cell
  return (
    <View key={col} style={baseStyle}>
      <Text style={s.headerText}>{col}</Text>
    </View>
  );
})}

                </View>

                {/* Rows */}
                {sortedStudents.map((stu, idx) => (
                  <View key={stu.key} style={[s.row, idx % 2 === 0 && s.rowAlt]}>
                    <View style={[s.cell, s.snoCell]}><Text>{idx + 1}</Text></View>
                    <View style={[s.cell, s.nameCell]}>
                      <Text numberOfLines={1} ellipsizeMode="tail">{stu.NAME}</Text>
                    </View>
                    <View style={[s.cell, s.rollCell]}>
                      <Text numberOfLines={1} ellipsizeMode="tail">{stu.ROLLNO}</Text>
                    </View>
                    <View style={[s.cell, s.emailCell]}>
                      <Text numberOfLines={1} ellipsizeMode="middle">{stu.EMAIL}</Text>
                    </View>
                    <View style={[s.cell, s.classCell]}>
                      <Text numberOfLines={1} ellipsizeMode="tail">{stu.CLASS}</Text>
                    </View>
                    <View style={[s.cell, s.checkCell, s.centerCell]}>
                      <Checkbox value={stu.present} onValueChange={() => toggle(stu.key, "present")} disabled={!canEditAttendance} />
                    </View>
                    <View style={[s.cell, s.checkCell, s.centerCell]}>
                      <Checkbox value={stu.absent} onValueChange={() => toggle(stu.key, "absent")} disabled={!canEditAttendance} />
                    </View>
                    <View style={[s.cell, s.checkCell, s.centerCell]}>
                      <Checkbox value={stu.late} onValueChange={() => toggle(stu.key, "late")} disabled={!canEditAttendance} />
                    </View>
                    <View style={[s.cell, s.delCell, s.centerCell]}>
                      <TouchableOpacity onPress={() => deleteStudent(stu.key)} accessibilityLabel="Delete student">
                        <MaterialCommunityIcons name="trash-can-outline" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Bottom action bar */}
          <View style={s.bottomBar}>
            <TouchableOpacity onPress={saveStudents} style={{ borderRadius: 10, overflow: "hidden" }}>
              <LinearGradient colors={BTN_GRAD} style={s.btnGrad}>
                <Text style={s.btnGradTxt}>Save Class</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={downloadAttendanceExcel} style={{ borderRadius: 10, overflow: "hidden" }}>
              <LinearGradient colors={DL_GRAD} style={s.btnGrad}>
                <Text style={s.btnGradTxt}>Download Attendance</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Floating add student */}
      <TouchableOpacity style={s.fab} onPress={() => setShowAddModal(true)}>
  <MaterialCommunityIcons name="plus" size={28} color="#fff" />
</TouchableOpacity>


      {/* Save tick modal */}
      <Modal visible={savedTick} transparent animationType="fade">
        <View style={s.centerFade}>
          <View style={s.tickCard}>
  <MaterialCommunityIcons name="check-circle" size={48} color="#22c55e" />
  <Text style={{ marginTop: 6, fontWeight: "600" }}>Attendance saved</Text>
</View>

        </View>
      </Modal>

      {/* Roster saved modal */}
      <Modal visible={success} transparent animationType="fade">
        <View style={s.centerFade}>
          <View style={s.savedCard}>
  <MaterialCommunityIcons name="check-circle" size={48} color="#33c24d" />
  <Text style={{ fontWeight: "bold", color: NAVY, marginTop: 8 }}>Roster Saved!</Text>
</View>

        </View>
      </Modal>

      {/* Add student modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Add New Student</Text>
            <TextInput placeholder="Name" value={newName} onChangeText={setNewName} style={s.input} />
            <TextInput placeholder="Roll No" value={newRoll} onChangeText={setNewRoll} style={s.input} />
            <TextInput placeholder="Email ID" value={newEmail} onChangeText={setNewEmail} style={s.input} />
            <Text style={s.static}>Class: {CLS_DISPLAY}</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.modalBtn} onPress={confirmAddStudent}>
                <Text style={s.modalBtnTxt}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.cancel]} onPress={() => setShowAddModal(false)}>
                <Text style={s.modalBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ------------------------- Styles ------------------------- */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: MUTED_BG },

  // generic card
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.8)",
    padding: 14,
    shadowColor: "#0b1220",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },

  rowSplit: { flexDirection: "row" },
col70: { flex:7, alignSelf:"flex-start" },
col30: { flex:3, alignSelf:"flex-start" },

  stack: { width: "100%" },

  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  headerSub: { color: "#475569", marginTop: 2 },

  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: NAVY_BORDER,
    backgroundColor: NAVY_SOFT,
  },

  outlineBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: NAVY_BORDER,
    backgroundColor: NAVY_SOFT,
  },
  outlineBtnTxt: { color: NAVY, fontWeight: "700" },

  dangerBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#ef4444",
    borderWidth: 1,
    borderColor: "#dc2626",
  },
  dangerBtnTxt: { color: "#fff", fontWeight: "800" },

  sectionTitle: { fontSize: 18, fontWeight: "800", color: NAVY, marginBottom: 8 },

  statusRow: { flexDirection: "row", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  pill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  pillOpen: { backgroundColor: "#dcfce7", borderWidth: 1, borderColor: "#bbf7d0" },
  pillClosed: { backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#fecaca" },
  pillInfo: { backgroundColor: NAVY_SOFT, borderWidth: 1, borderColor: NAVY_BORDER },
  pillTxt: { fontWeight: "700", color: "#0f172a" },

  // calendar (fills its half)
  calendarBoxFull: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    alignSelf: "stretch",
    backgroundColor: "#fff",
    elevation: 3,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  // stats — vertical stack now
  statsColumn: {
    width: "100%",
    flexDirection: "column",
    gap: 12,
    marginTop: 10,
  },
  statCard: {
    position: "relative",
    borderRadius: 16,
    padding: 14,
    overflow: "hidden",
    minHeight: 62,
    shadowColor: "#0b1220",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  statGrad: { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
 statTitle: { color: "#0f172a", fontWeight: "800", marginBottom: 6 },
statValue: { color: "#0f172a", fontSize: 28, fontWeight: "900" },

  // Buttons (gradient shells)
  btnGrad: { paddingVertical: 12, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  btnGradTxt: { color: "#fff", fontWeight: "800" },

  // Table
  tableCenterWrap: { alignItems: "center" }, // centers the whole table block inside the card
  rowHeader: { flexDirection: "row", backgroundColor: NAVY, borderBottomWidth: 1, borderColor: "#E2E8F0", alignSelf: "center" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#E2E8F0", alignSelf: "center" },
  rowAlt: { backgroundColor: "#F3F6FF" },
  cell: { flex: 1, minWidth: 180, padding: 10, borderRightWidth: 1, borderColor: "#E2E8F0" },
  centerCell: { alignItems: "center" },
  headerCell: { backgroundColor: NAVY },
  headerText: { fontWeight: "800", textAlign: "center", color: "#ffffff" },

  // Column sizing
  snoCell: { minWidth: 64, alignItems: "center" },
checkCell: { minWidth: 120, alignItems: "center" }, // more breathing room
delCell:   { minWidth: 80,  alignItems: "center" },
tableShell: {
  width: "100%",
  borderRadius: 12,
  overflow: "hidden",              // clip header/background inside card
  borderWidth: 1,
  borderColor: "#E2E8F0",
  alignSelf: "center",
},
grid: {
  // keep existing props, then ensure it never exceeds the card
  flex: 1,
  alignSelf: "stretch",
  maxWidth: "100%",
},
gridContent: {
  alignItems: "stretch",
},

  nameCell: { minWidth: 260, flexGrow: 1.4 },
  rollCell: { minWidth: 100, flexGrow: 1.1 },
  emailCell: { minWidth: 390 },
  classCell: { minWidth: 150, alignItems: "flex-start" },

  // replaced emoji with icon; keep spacing via size=20
  deleteIcon: { fontSize: 18 },

  // Footer actions
  bottomBar: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 12 },

  // FAB
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: NAVY,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  fabTxt: { color: "#fff", fontSize: 28, fontWeight: "bold" },

  // Modals
  centerFade: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.15)" },
  tickCard: { backgroundColor: "#fff", padding: 24, borderRadius: 16, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10 },
  savedCard: { backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  modal: { width: "80%", backgroundColor: "#fff", padding: 20, borderRadius: 12 },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12, color: NAVY },
  input: { borderWidth: 1, borderColor: "#CBD5E1", padding: 10, borderRadius: 8, marginBottom: 12, backgroundColor: "#fff" },
  static: { padding: 10, backgroundColor: "#F1F5F9", borderRadius: 8, marginBottom: 12, fontWeight: "600" },
  modalBtns: { flexDirection: "row", justifyContent: "space-between" },
  modalBtn: { flex: 1, padding: 12, backgroundColor: NAVY, borderRadius: 8, marginHorizontal: 4, alignItems: "center" },
  cancel: { backgroundColor: "#94a3b8" },
  modalBtnTxt: { color: "#fff", textAlign: "center", fontWeight: "700" },
  sortRow: { flexDirection:"row", alignItems:"center" },
chip: {
  paddingVertical:6, paddingHorizontal:10, borderRadius:999,
  borderWidth:1, borderColor:"#CBD5E1", backgroundColor:"#F1F5F9", marginLeft:6
},
chipActive: { backgroundColor:"#E0E7FF", borderColor:"#A5B4FC" },
chipTxt: { color:"#334155", fontWeight:"700" },
chipTxtActive: { color:"#1e293b" },
thArrow: { marginLeft: 6, transform: [{ translateY: 1 }] },

});
