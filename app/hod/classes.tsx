"use client"

import { Feather, MaterialCommunityIcons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useNavigation, useRouter } from "expo-router"
import { getAuth, signOut } from "firebase/auth"
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query,
  serverTimestamp, updateDoc, where, writeBatch,
} from "firebase/firestore"
import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator, Alert,
  Animated, Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform, Pressable,
  SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
  useWindowDimensions
} from "react-native"
import { db } from "../../firebase"

/* --------------------------- types --------------------------- */
type Mentor = { name: string; email: string }
type ClassDoc = {
  id: string
  year: 1 | 2 | 3 | 4
  dept: "CSE"
  section: string
  mentors: Mentor[]
  status: "active" | "archived"
  createdAt?: any
}

/* --------------------------- helpers --------------------------- */
const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
function generateSectionsOrdered(n: number): string[] {
  if (n <= 0) return []
  const out: string[] = []
  let remaining = n
  let suffix = ""
  let round = 0
  while (remaining > 0) {
    for (let i = 0; i < alpha.length && remaining > 0; i++) {
      out.push(`${alpha[i]}${suffix}`)
      remaining--
    }
    round++
    suffix = String(round)
  }
  return out.slice(0, n)
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailValid = (e: string) => e.length === 0 || emailRegex.test(e)
const sectionValidFn = (s: string) => /^[A-Z][0-9]*$/.test(s || "")
const mentorsToEmails = (mentors: Mentor[]) =>
  Array.from(new Set((mentors || []).map((m) => (m.email || "").trim().toLowerCase()).filter(Boolean)))

/* --------------------------- subtle year tones --------------------------- */
const YEAR_TONE: Record<1 | 2 | 3 | 4, { bg: string; border: string; text: string; dot: string; activeBg: string }> = {
  1: { bg: "#F0F9FF", border: "#BAE6FD", text: "#0C4A6E", dot: "#38BDF8", activeBg: "#38BDF8" }, // medium sky (cyan-400)
  2: { bg: "#F0FDF4", border: "#BBF7D0", text: "#14532D", dot: "#34D399", activeBg: "#34D399" }, // medium green (emerald-400)
  3: { bg: "#FAF5FF", border: "#E9D5FF", text: "#4C1D95", dot: "#A78BFA", activeBg: "#A78BFA" }, // medium purple (violet-400)
  4: { bg: "#FFF7ED", border: "#FED7AA", text: "#7C2D12", dot: "#F59E0B", activeBg: "#F59E0B" }, // medium amber (orange-400)
}



/* --------------------------- tiny UI primitives --------------------------- */

function GlowButton({
  label,
  icon,
  onPress,
  variant = "primary",
  disabled,
  style,
}: {
  label: string
  icon?: keyof typeof Feather.glyphMap
  onPress: () => void
  variant?: "primary" | "danger" | "dangerOutline" | "ghost"
  disabled?: boolean
  style?: any
}) {
  // brand/navy + danger palette
  const NAVY = "#000080"
  const DANGER = "#DC2626"

  const bg =
    variant === "primary" ? NAVY :
    variant === "danger"  ? DANGER :
    variant === "dangerOutline" ? "#FFFFFF" : "#FFFFFF"

  const fg =
    variant === "dangerOutline" ? DANGER :
    variant === "ghost" ? "#0F172A" : "#FFFFFF"

  const border =
    variant === "danger" ? "#FCA5A5" :
    variant === "dangerOutline" ? DANGER :
    variant === "ghost"  ? "#94A3B8" : NAVY

  // keep animated values stable across renders
  const scale = useRef(new Animated.Value(1)).current
  const glow  = useRef(new Animated.Value(0.10)).current

  const pressIn = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.98, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.22, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true })
    ]).start()
  }
  const pressOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.10, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true })
    ]).start()
  }

  const showChevron = variant === "primary" // only for primary

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            opacity: glow,
            backgroundColor:
              variant === "danger" || variant === "dangerOutline"
                ? "#FEE2E2"
                : "#E0E7FF",
          },
        ]}
      />
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={[
          {
            backgroundColor: bg,
            borderColor: border,
          },
          styles.btnBase,
          (variant === "ghost" || variant === "dangerOutline") && { backgroundColor: "#FFFFFF" },
          disabled && { opacity: 0.6 },
        ]}
      >
        {icon ? <Feather name={icon} size={16} color={fg} style={{ marginRight: 8 }} /> : null}
        <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
        {showChevron ? (
          <Feather name="chevron-right" size={16} color={fg} style={{ marginLeft: 6, opacity: 0.9 }} />
        ) : null}
      </Pressable>
    </Animated.View>
  )
}

function Pill({
  label,
  active,
  onPress,
  style,
  tint,
}: {
  label: string
  active?: boolean
  onPress: () => void
  style?: any
  tint?: { bg: string; border: string; text: string; activeBg?: string; activeText?: string }
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        tint && { backgroundColor: tint.bg, borderColor: tint.border },
        !tint && active && styles.pillActive,
        tint && active && { backgroundColor: tint.activeBg ?? tint.border, borderColor: tint.border },
        style,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          tint && { color: tint.text },
          !tint && active && styles.pillTextActive,
          tint && active && { color: tint.activeText ?? "#FFFFFF" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function SearchField({
  value, onChangeText, placeholder, borderColor,
}: {
  value: string
  onChangeText: (t: string) => void
  placeholder: string
  borderColor?: string
}) {
  return (
    <View style={[styles.searchWrap, borderColor ? { borderColor } : null]}>
      <Feather name="search" size={16} color="#64748B" style={{ marginLeft: 12 }} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        style={styles.searchInput}
      />
    </View>
  )
}


/* --------------------------- component --------------------------- */
export default function HodClassesScreen() {
  const router = useRouter()
  const navigation: any = useNavigation()
  const { width } = useWindowDimensions()
  const isWide = width >= 1024
  const isPhone = width < 600

  const safeBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack()
      return
    }
    if (Platform.OS === "web" && typeof window !== "undefined" && window.history.length > 1) {
      window.history.back()
      return
    }
    router.replace("/login")
  }

  const [selectedYear, setSelectedYear] = useState<1 | 2 | 3 | 4>(1)
  const tone = YEAR_TONE[selectedYear]
  const ACCENT = YEAR_TONE[selectedYear]?.dot || "#000080";
  const filterTint = { bg: "#fff", border: ACCENT, text: "#475569", activeBg: ACCENT, activeText: "#fff" };

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createTab, setCreateTab] = useState<"single" | "bulk">("single")

  const [section, setSection] = useState("")
  const [mentor1, setMentor1] = useState<Mentor>({ name: "", email: "" })
  const [mentor2, setMentor2] = useState<Mentor>({ name: "", email: "" })

  const [bulkCount, setBulkCount] = useState<number>(0)
  const bulkPreview = useMemo(() => (bulkCount > 0 ? generateSectionsOrdered(bulkCount) : []), [bulkCount])

  const [initialLoading, setInitialLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)

  const [editMentorModal, setEditMentorModal] = useState<{
    id: string; section: string; year: 1 | 2 | 3 | 4; m1: Mentor; m2: Mentor
  } | null>(null)
  const [savingMentors, setSavingMentors] = useState(false)

  const [classesForYear, setClassesForYear] = useState<ClassDoc[]>([])

  useEffect(() => {
    setInitialLoading(true)
    const qy = query(collection(db, "classes"), where("dept", "==", "CSE"), where("year", "==", selectedYear as number))
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: ClassDoc[] = []
        snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) } as ClassDoc))
        const toKey = (s: string) => {
          const m = s.match(/^([A-Z]+)(\d*)$/)
          if (!m) return s
          const letter = m[1]
          const num = m[2] ? Number.parseInt(m[2], 10) : 0
          return `${String(num).padStart(4, "0")}-${letter}`
        }
        rows.sort((a, b) => toKey(a.section).localeCompare(toKey(b.section)))
        setClassesForYear(rows)
        setInitialLoading(false)
      },
      (err) => {
        console.error(err)
        setInitialLoading(false)
        Alert.alert("Error", "Failed to load classes.")
      },
    )
    return () => unsub()
  }, [selectedYear])

  const resetCreate = () => {
    setCreateTab("single")
    setSection("")
    setMentor1({ name: "", email: "" })
    setMentor2({ name: "", email: "" })
    setBulkCount(0)
  }
  const openCreateModal = () => { resetCreate(); setShowCreateModal(true) }

  const cleanedMentors = (m1: Mentor, m2: Mentor): Mentor[] => {
    const arr = [m1, m2].map((m) => ({ name: (m.name || "").trim(), email: (m.email || "").trim() })).filter((m) => m.name || m.email)
    const seen = new Set<string>()
    return arr.filter((m) => {
      if (!m.email) return true
      if (seen.has(m.email)) return false
      seen.add(m.email)
      return true
    }).slice(0, 2)
  }

  const sectionValid = sectionValidFn(section)

  const createSingle = async () => {
    if (!sectionValid) return Alert.alert("Invalid section", "Use A, B, C … or A1, B1 …")
    if (classesForYear.some((c) => c.section === section.toUpperCase())) {
      return Alert.alert("Duplicate", `CSE ${section.toUpperCase()} already exists`)
    }
    const mentors = cleanedMentors(mentor1, mentor2)
    if (
      mentors.some((m) => m.email && !emailValid(m.email)) ||
      (mentors[0]?.email && mentors[1]?.email && mentors[0].email === mentors[1].email)
    ) {
      return Alert.alert("Mentor email error", "Check mentor emails (must be valid & different).")
    }
    const takenEmails = new Set(
      classesForYear.flatMap((c) => (c.mentors || []).map((m) => (m.email || "").toLowerCase()).filter(Boolean)),
    )
    if (mentors.some((m) => m.email && takenEmails.has(m.email.toLowerCase()))) {
      return Alert.alert("Mentor already assigned", "One or more mentor emails are already assigned to another class.")
    }
    setSaving(true)
    try {
      await addDoc(collection(db, "classes"), {
        dept: "CSE",
        year: selectedYear,
        section: section.toUpperCase(),
        mentors,
        mentorEmails: mentorsToEmails(mentors),
        status: "active",
        createdAt: serverTimestamp(),
      })
      setShowCreateModal(false)
    } catch (e) {
      console.error(e); Alert.alert("Error", "Failed to create class.")
    } finally {
      setSaving(false)
    }
  }

  const createBulk = async () => {
    if (bulkPreview.length === 0) return Alert.alert("Nothing to create", "Pick a count from 1–100.")
    const existing = new Set(classesForYear.map((c) => c.section.toUpperCase()))
    const toCreate = bulkPreview.map((s) => s.toUpperCase()).filter((s) => !existing.has(s))
    if (toCreate.length === 0) return Alert.alert("All exist", "Every section in preview already exists.")
    setSaving(true)
    try {
      const batch = writeBatch(db)
      const col = collection(db, "classes")
      toCreate.forEach((sec) => {
        const ref = doc(col)
        batch.set(ref, {
          dept: "CSE",
          year: selectedYear,
          section: sec,
          mentors: [],
          mentorEmails: [],
          status: "active",
          createdAt: serverTimestamp(),
        })
      })
      await batch.commit()
      setShowCreateModal(false)
      if (toCreate.length !== bulkPreview.length) {
        Alert.alert("Partial create", `Created ${toCreate.length}. Skipped ${bulkPreview.length - toCreate.length} duplicates.`)
      }
    } catch (e) {
      console.error(e); Alert.alert("Error", "Failed to bulk-create classes.")
    } finally {
      setSaving(false)
    }
  }

  const askDelete = (id: string, label: string) => setConfirmDelete({ id, label })
  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    try { setDeleting(true); await deleteDoc(doc(db, "classes", confirmDelete.id)) }
    catch (e) { console.error(e); Alert.alert("Error", "Failed to delete class.") }
    finally { setDeleting(false); setConfirmDelete(null) }
  }

  const handleDeleteAllForYear = async () => {
    try {
      setDeletingAll(true)
      const qAll = query(collection(db, "classes"), where("dept", "==", "CSE"), where("year", "==", selectedYear as number))
      const snap = await getDocs(qAll)
      if (snap.empty) { setConfirmDeleteAll(false); return Alert.alert("Nothing to delete", `No classes for Year ${selectedYear}.`) }
      const docs = snap.docs
      const chunkSize = 450
      for (let i = 0; i < docs.length; i += chunkSize) {
        const chunk = docs.slice(i, i + chunkSize)
        const batch = writeBatch(db)
        chunk.forEach((d) => batch.delete(d.ref))
        await batch.commit()
      }
    } catch (e) { console.error(e); Alert.alert("Error", "Failed to delete all classes.") }
    finally { setDeletingAll(false); setConfirmDeleteAll(false) }
  }

  const openEditMentors = (cls: ClassDoc) => {
    const m1 = cls.mentors?.[0] || { name: "", email: "" }
    const m2 = cls.mentors?.[1] || { name: "", email: "" }
    setEditMentorModal({ id: cls.id, section: cls.section, year: cls.year, m1, m2 })
  }

  const saveMentors = async () => {
    if (!editMentorModal) return
    const { id, m1, m2 } = editMentorModal
    const mentors = cleanedMentors(m1, m2)
    if (
      mentors.some((m) => m.email && !emailValid(m.email)) ||
      (mentors[0]?.email && mentors[1]?.email && mentors[0].email === mentors[1].email)
    ) return Alert.alert("Mentor email error", "Check mentor emails (must be valid & different).")

    const taken: { email: string; classId: string }[] = []
    classesForYear.forEach((c) => (c.mentors || []).forEach((m) => m.email && taken.push({ email: m.email.toLowerCase(), classId: c.id })))
    const anotherHas = mentors.some((m) => m.email && taken.some((t) => t.email === m.email.toLowerCase() && t.classId !== id))
    if (anotherHas) return Alert.alert("Mentor already assigned", "Email already used by a different class in this year.")

    setSavingMentors(true)
    try {
      await updateDoc(doc(db, "classes", id), { mentors, mentorEmails: mentorsToEmails(mentors) })
      setEditMentorModal(null)
    } catch (e) { console.error(e); Alert.alert("Error", "Failed to update mentors.") }
    finally { setSavingMentors(false) }
  }

  // 🔎 table enhancements
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all")

  const filteredClasses = useMemo(() => {
    let data = [...classesForYear]
    if (statusFilter !== "all") {
      data = data.filter((c) => (c.status ?? "active") === statusFilter)
    }
    const q = search.trim().toLowerCase()
    if (q.length) {
      data = data.filter((c) => {
        const inSection = `cse ${c.section}`.toLowerCase().includes(q)
        const inMentors = (c.mentors || []).some(
          (m) =>
            (m.name || "").toLowerCase().includes(q) ||
            (m.email || "").toLowerCase().includes(q)
        )
        return inSection || inMentors
      })
    }
    return data
  }, [classesForYear, search, statusFilter])

  const doSignOut = async () => {
    try {
      const auth = getAuth()
      await signOut(auth)
    } catch {}
    router.replace("/hod/login")
  }

  /* --------------------------- render --------------------------- */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* subtle page glow */}
      <LinearGradient
        colors={["#F5F9FF", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.85 }}
        style={styles.pageGlow}
        pointerEvents="none"
      />

      {/* Header (shorter) */}
      <View style={[s.header, isPhone && { paddingHorizontal: 14, paddingVertical: 8 }]}>
        <View style={[s.headerContent, isPhone && { gap: 6 }]}>
          <View style={[s.headerLeft, isPhone && { gap: 8 }]}>
            {/* ◀ Back */}
            <TouchableOpacity onPress={safeBack} style={[s.backBtn, isPhone && { paddingHorizontal: 8, paddingVertical: 6 }]} accessibilityLabel="Go Back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="arrow-left" size={16} color="#000080" />
            </TouchableOpacity>

            <View style={[s.iconContainer, isPhone && { width: 36, height: 36, marginRight: 6 }]}>
              <MaterialCommunityIcons name="book-outline" size={16} color="#fff" />
            </View>
            <View style={s.titleContainer}>
              <Text style={[s.title, isPhone && { fontSize: 20 }]}>Classes (CSE)</Text>
              <Text style={[s.subtitle, isPhone && { fontSize: 12 }]}>Manage your academic sections</Text>
            </View>
          </View>

          {/* 🔴 Sign Out */}
          <TouchableOpacity style={[s.dangerBtn, isPhone && { paddingVertical: 6, paddingHorizontal: 10 }]} onPress={doSignOut}>
            <Text style={[s.dangerBtnTxt, isPhone && { fontSize: 13 }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.container, isPhone && { padding: 12 }]}>
        {/* ---- TOP ROW: Manage card (left) + Year panel (right) ---- */}
        {/* THE CODE CHANGED PART — stack + tighter gaps on phone */}
        <View style={[s.topRow, isPhone && { flexDirection: "column", gap: 10 }]}>
          {/* THE CODE CHANGED PART — mobile year selector */}
          {!isWide && (
          <View style={[s.yearBarMobile, { borderColor: YEAR_TONE[selectedYear].border, backgroundColor: YEAR_TONE[selectedYear].bg, alignItems: "center" }]}>
            <Text style={[s.yearBarTitle, { color: YEAR_TONE[selectedYear].text }]}>Manage Years</Text>
            <View style={s.yearButtonsMobile}>
              {[1, 2, 3, 4].map((year) => (
                <Pill
                  key={year}
                  label={`${year} yr`}
                  active={selectedYear === (year as 1 | 2 | 3 | 4)}
                  onPress={() => setSelectedYear(year as 1 | 2 | 3 | 4)}
                  tint={YEAR_TONE[year as 1 | 2 | 3 | 4]}
                />
              ))}
            </View>
          </View>
        )}

          {/* LEFT: Manage Years (only on wide) */}
          {isWide && (
            <View style={[s.sideCard, { borderColor: tone.border, backgroundColor: tone.bg }]}>
              <View style={[s.ribbon, { backgroundColor: tone.dot }]} />
              <LinearGradient
                colors={[tone.bg, "#FFFFFF"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />

            <Text style={[s.cardTitle, { color: tone.text, textAlign: "center" }]}>Manage Years</Text>
<Text style={[s.cardSub, { color: tone.text, opacity: 0.9, textAlign: "center" }]}>Switch the academic year to view, create, or clean up its classes.</Text>
<View style={[s.yearButtons, { flexWrap: "wrap", justifyContent: "center" }]}>

                {[1, 2, 3, 4].map((year) => (
                  <Pill
                    key={year}
                    label={`${year} yr`}
                    active={selectedYear === (year as 1 | 2 | 3 | 4)}
                    onPress={() => setSelectedYear(year as 1 | 2 | 3 | 4)}
                    tint={YEAR_TONE[year as 1 | 2 | 3 | 4]}
                  />
                ))}
              </View>
            </View>
          )}

          {/* RIGHT: Manage Year N */}
          <View
            style={[
              s.card,
              s.manageCard,
              // THE CODE CHANGED PART — responsive manage card
              { flex: 1, borderColor: tone.border, backgroundColor: tone.bg, ...(isPhone ? { width: "100%", minWidth: undefined, padding: 14 } : { minWidth: 320 }) }
            ]}
          >
            <View style={[s.ribbon, { backgroundColor: tone.dot }]} />
            <LinearGradient
              colors={[tone.bg, "#FFFFFF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />

            {/* THE CODE CHANGED PART — smaller fonts on phones */}
<Text style={[s.cardTitle, { color: tone.text, textAlign: "center" }, isPhone && { fontSize: 18 }]}>Manage Year {selectedYear}</Text>
<Text style={[s.cardSub, { color: tone.text, opacity: 0.9, textAlign: "center" }, isPhone && { fontSize: 13, lineHeight: 18 }]}>Create new sections or clean up classes for this year.</Text>

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
  <GlowButton icon="plus-circle" label=" Create Class(es)" onPress={openCreateModal} style={{ alignSelf: "center" }} />
  <GlowButton icon="trash-2" label={`Delete All (Year ${selectedYear})`} onPress={() => setConfirmDeleteAll(true)} variant="dangerOutline" style={{ minWidth: 160, alignSelf: "center" }} />
</View>
          </View>
        </View>

        {/* ---------- Toolbar + Table/Card ---------- */}
        <View style={[s.tableToolbar, isPhone && { gap: 8, flexDirection: "column" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search by class or mentor…"
              borderColor={YEAR_TONE[selectedYear].border}
            />

            {/* Pills: ALL / ACTIVE / ARCHIVED — tinted */}
            {/* THE CODE CHANGED PART — let filter pills wrap on phone */}
            <View style={[s.filterGroup, isPhone && { flexWrap: "wrap", alignSelf: "center" }]}>

              {(["all", "active", "archived"] as const).map((key) => (
                <Pill
                  key={key}
                  label={key[0].toUpperCase() + key.slice(1)}
                  active={statusFilter === key}
                  onPress={() => setStatusFilter(key)}
                  tint={filterTint}
                />
              ))}
            </View>
          </View>

        </View>

        {/* Desktop/Wide: table; Phone: cards */}
        {!isPhone ? (
          <View style={[s.table, { borderColor: YEAR_TONE[selectedYear].border }]}>
            <View style={[s.thead, { borderBottomColor: YEAR_TONE[selectedYear].border }]}>
              <Text style={[s.th, { flex: 2 }]}>Class</Text>
              <Text style={[s.th, { flex: 3 }]}>Mentors (max 2)</Text>
              <Text style={[s.th, { flex: 1 }]}>Status</Text>
              <Text style={[s.th, s.thRight, { flex: 2 }]}>Actions</Text>
            </View>

            {initialLoading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator />
                <Text style={{ marginLeft: 8 }}>Loading…</Text>
              </View>
            ) : filteredClasses.length === 0 ? (
              <View style={s.emptyState}>
                <Feather name="inbox" size={24} color="#64748B" />
                <Text style={s.emptyTitle}>No matches</Text>
                <Text style={s.emptySub}>
                  Try clearing filters or creating a new class.
                </Text>
              </View>
            ) : (
              filteredClasses.map((c, idx) => (
                <View
                  key={c.id}
                  style={[
                    s.rowItem,
                    idx % 2 === 1 && { backgroundColor: "#FBFDFF" },
                  ]}
                >
                  {/* Class */}
                  <View style={[s.cell, { flex: 2 }]}>
                    <Text style={s.cellText}>CSE {c.section}</Text>
                  </View>

                  {/* Mentors chips */}
                  <View style={[s.cell, { flex: 3 }]}>
                    {c.mentors?.length ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {c.mentors.slice(0, 2).map((m, i) => (
                          <View key={i} style={s.chip}>
                            <Feather name="user" size={12} color="#334155" style={{ marginRight: 6 }} />
                            <Text style={s.chipTxt}>{m.name || m.email}</Text>
                          </View>
                        ))}
                        {c.mentors.length > 2 && (
                          <View style={[s.chip, { backgroundColor: "#EEF2FF", borderColor: "#E0E7FF" }]}>
                            <Text style={[s.chipTxt, { color: "#4338CA" }]}>
                              +{c.mentors.length - 2}
                            </Text>
                          </View>
                        )}
                      </View>
                    ) : (
                      <Text style={[s.cellText, { color: "#94A3B8", fontStyle: "italic" }]}>—</Text>
                    )}
                  </View>

                  {/* Status pill */}
                  <View style={[s.cell, { flex: 1 }]}>
                    <View
                      style={[
                        s.badge,
                        (c.status ?? "active") === "active" ? s.badgeGreen : s.badgeGray,
                      ]}
                    >
                      <View style={[styles.dot, (c.status ?? "active") === "active" ? styles.dotGreen : styles.dotGray]} />
                      <Text
                        style={[
                          s.badgeTxt,
                          (c.status ?? "active") === "active" ? s.badgeTxtGreen : s.badgeTxtGray,
                        ]}
                      >
                        {c.status ?? "active"}
                      </Text>
                    </View>
                  </View>

                  {/* Actions */}
                  <View style={[s.cell, s.actionsCell]}>
                    <View style={s.actionsGroup}>
                      <GlowButton
                        label="Edit mentors"
                        icon="edit-2"
                        onPress={() => openEditMentors(c)}
                        variant="ghost"
                        style={{ minWidth: 140 }}
                      />
                      <GlowButton
                        label="Delete"
                        icon="trash-2"
                        onPress={() => askDelete(c.id, `CSE ${c.section} (Year ${c.year})`)}
                        variant="dangerOutline"
                        style={{ minWidth: 120 }}
                      />
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : (
          // Mobile cards
          <View style={{ gap: 10 }}>
            {initialLoading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator />
                <Text style={{ marginLeft: 8 }}>Loading…</Text>
              </View>
            ) : filteredClasses.length === 0 ? (
              <View style={s.emptyState}>
                <Feather name="inbox" size={22} color="#64748B" />
                <Text style={[s.emptyTitle, { fontSize: 16 }]}>No matches</Text>
                <Text style={[s.emptySub, { fontSize: 14 }]}>
                  Try clearing filters or creating a new class.
                </Text>
              </View>
            ) : (
              filteredClasses.map((c) => (
                <View key={c.id} style={s.mobileCard}>
  {/* Top Row: Class + Mentors + Status */}
  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
    {/* Class */}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={[s.clsIcon, { width: 30, height: 30 }]}>
        <MaterialCommunityIcons name="book-outline" size={16} color="#fff" />
      </View>
      <Text style={[s.classTxt, { fontSize: 16 }]}>CSE {c.section}</Text>
    </View>

    {/* Mentors */}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", flex: 1 }}>
      {c.mentors?.length ? (
        c.mentors.slice(0, 2).map((m, i) => (
          <View key={i} style={s.chip}>
            <Feather name="user" size={12} color="#334155" style={{ marginRight: 6 }} />
            <Text style={s.chipTxt}>{m.name || m.email}</Text>
          </View>
        ))
      ) : (
        <Text style={[s.cellText, { color: "#94A3B8", fontStyle: "italic" }]}>—</Text>
      )}
    </View>

    {/* Status */}
    <View style={[s.badge, (c.status ?? "active") === "active" ? s.badgeGreen : s.badgeGray]}>
      <View style={[styles.dot, (c.status ?? "active") === "active" ? styles.dotGreen : styles.dotGray]} />
      <Text style={[s.badgeTxt, (c.status ?? "active") === "active" ? s.badgeTxtGreen : s.badgeTxtGray]}>
        {c.status ?? "active"}
      </Text>
    </View>
  </View>

  {/* Centered Actions */}
  <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 12 }}>
    <GlowButton label="Edit mentors" icon="edit-2" onPress={() => openEditMentors(c)} variant="ghost" style={{ minWidth: 140 }} />
    <GlowButton label="Delete" icon="trash-2" onPress={() => askDelete(c.id, `CSE ${c.section} (Year ${c.year})`)} variant="dangerOutline" style={{ minWidth: 120 }} />
  </View>
</View>

              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <View style={s.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Create class — Year {selectedYear}</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} accessibilityLabel="Close">
                <Feather name="x" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {createTab === "single" ? (
                <View style={{ gap: 12 }}>
                  <Labeled label="Department"><Text style={s.locked}>CSE</Text></Labeled>
                  <Labeled label="Year"><Text style={s.locked}>{selectedYear}</Text></Labeled>

                  <Labeled label="Section (A, B, C … A1, B1 …)" error={section.length > 0 && !sectionValid ? "Invalid section" : undefined}>
                    <TextInput placeholder="e.g. C" value={section} onChangeText={(t) => setSection(t.toUpperCase())} autoCapitalize="characters" style={s.input} />
                  </Labeled>

                  <Text style={s.groupLabel}>Mentors (optional, max 2)</Text>

                  <Labeled label="Mentor 1 name"><TextInput placeholder="Name" value={mentor1.name} onChangeText={(t) => setMentor1((m) => ({ ...m, name: t }))} style={s.input} /></Labeled>
                  <Labeled label="Mentor 1 email" error={!emailValid(mentor1.email) ? "Invalid email" : undefined}>
                    <TextInput placeholder="email@example.com" keyboardType="email-address" autoCapitalize="none" value={mentor1.email} onChangeText={(t) => setMentor1((m) => ({ ...m, email: t.trim() }))} style={s.input} />
                  </Labeled>

                  <View style={s.hr} />

                  <Labeled label="Mentor 2 name"><TextInput placeholder="Name" value={mentor2.name} onChangeText={(t) => setMentor2((m) => ({ ...m, name: t }))} style={s.input} /></Labeled>
                  <Labeled label="Mentor 2 email" error={!emailValid(mentor2.email) ? "Invalid email" : undefined}>
                    <TextInput placeholder="email@example.com" keyboardType="email-address" autoCapitalize="none" value={mentor2.email} onChangeText={(t) => setMentor2((m) => ({ ...m, email: t.trim() }))} style={s.input} />
                  </Labeled>

                  <GlowButton
                    label="Create"
                    icon="check-circle"
                    onPress={createSingle}
                    style={{ marginTop: 8 }}
                    disabled={!sectionValid || saving}
                  />
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  <Labeled label="Department"><Text style={s.locked}>CSE</Text></Labeled>
                  <Labeled label="Year"><Text style={s.locked}>{selectedYear}</Text></Labeled>

                  <Labeled label="Create multiple classes">
                    <View style={s.row}>
                      <TouchableOpacity style={s.stepperBtn} onPress={() => setBulkCount((c) => Math.max(0, c - 1))}>
                        <Feather name="minus" size={16} color="#1E293B" />
                      </TouchableOpacity>
                      <TextInput style={[s.input, { flex: 0, width: 80, textAlign: "center" }]} keyboardType="numeric" placeholder="0" value={bulkCount ? String(bulkCount) : ""} onChangeText={(t) => { const n = Number.parseInt(t || "0", 10); if (Number.isNaN(n)) return setBulkCount(0); setBulkCount(Math.max(0, Math.min(100, n))) }} />
                      <TouchableOpacity style={s.stepperBtn} onPress={() => setBulkCount((c) => Math.min(100, c + 1))}>
                        <Feather name="plus" size={16} color="#1E293B" />
                      </TouchableOpacity>
                      <Text style={s.help}>Order: A..Z, then A1..Z1, etc.</Text>
                    </View>
                  </Labeled>

                  <Text style={s.groupLabel}>Preview</Text>
                  {bulkPreview.length === 0 ? (
                    <Text style={s.muted}>—</Text>
                  ) : (
                    <FlatList
                      data={bulkPreview}
                      keyExtractor={(x) => x}
                      renderItem={({ item }) => (<View style={s.previewItem}><Text style={s.previewText}>CSE {item}</Text></View>)}
                      style={s.previewList}
                      contentContainerStyle={{ paddingVertical: 4 }}
                    />
                  )}

                  <GlowButton
                    label={`Create ${bulkPreview.length} classes`}
                    icon="layers"
                    onPress={createBulk}
                    style={{ marginTop: 8 }}
                    disabled={bulkPreview.length === 0 || saving}
                  />
                </View>
              )}
            </ScrollView>

            {/* Tabs */}
            <View style={s.innerTabs}>
              {(["single", "bulk"] as const).map((tab) => (
                <Pill
                  key={tab}
                  label={tab === "single" ? "Single" : "Bulk"}
                  active={createTab === tab}
                  onPress={() => setCreateTab(tab)}
                  style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm Delete Single */}
      <Modal visible={!!confirmDelete} transparent animationType="fade">
        <View style={s.confirmBackdrop}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>Delete class?</Text>
            <Text style={s.confirmSub}>This will permanently remove {confirmDelete?.label}. This cannot be undone.</Text>
            <View style={s.confirmRow}>
              <GlowButton label="Cancel" onPress={() => setConfirmDelete(null)} variant="ghost" />
              <GlowButton label={deleting ? "Deleting..." : "Delete"} icon="trash-2" onPress={handleConfirmDelete} variant="dangerOutline" />
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm Delete All */}
      <Modal visible={confirmDeleteAll} transparent animationType="fade">
        <View style={s.confirmBackdrop}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>Delete all classes for Year {selectedYear}?</Text>
            <Text style={s.confirmSub}>This will permanently remove every CSE class in Year {selectedYear}. This cannot be undone.</Text>
            <View style={s.confirmRow}>
              <GlowButton label="Cancel" onPress={() => setConfirmDeleteAll(false)} variant="ghost" />
              <GlowButton label={deletingAll ? "Deleting..." : "Delete All"} icon="trash-2" onPress={handleDeleteAllForYear} variant="dangerOutline" />
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Mentors Modal */}
      <Modal visible={!!editMentorModal} transparent animationType="slide">
        <View style={sEM.backdrop}>
          <View style={sEM.modal}>
            <View style={sEM.header}>
              <Text style={sEM.title}>
                Edit mentors — CSE {editMentorModal?.section} (Year {editMentorModal?.year})
              </Text>
              <TouchableOpacity onPress={() => setEditMentorModal(null)} accessibilityLabel="Close">
                <Feather name="x" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
              {...(Platform.OS === "ios" ? { behavior: "padding" } : {})}
              keyboardVerticalOffset={Platform.select({ ios: 0, android: 0, default: 0 })}
              style={{ flex: 1 }}
            >
              <ScrollView contentContainerStyle={sEM.body} keyboardShouldPersistTaps="handled">
                <Text style={sEM.groupLabel}>Mentors (optional, max 2)</Text>

                <Labeled label="Mentor 1 name">
                  <TextInput style={sEM.input} value={editMentorModal?.m1.name || ""} onChangeText={(t) => setEditMentorModal(v => (v ? { ...v, m1: { ...v.m1, name: t } } : v))} placeholder="Name" />
                </Labeled>
                <Labeled label="Mentor 1 email" error={editMentorModal && !emailValid(editMentorModal.m1.email) ? "Invalid email" : undefined}>
                  <TextInput style={sEM.input} value={editMentorModal?.m1.email || ""} onChangeText={(t) => setEditMentorModal(v => (v ? { ...v, m1: { ...v.m1, email: t.trim() } } : v))} placeholder="email@example.com" keyboardType="email-address" autoCapitalize="none" />
                </Labeled>

                <View style={sEM.hr} />

                <Labeled label="Mentor 2 name">
                  <TextInput style={sEM.input} value={editMentorModal?.m2.name || ""} onChangeText={(t) => setEditMentorModal(v => (v ? { ...v, m2: { ...v.m2, name: t } } : v))} placeholder="Name" />
                </Labeled>
                <Labeled label="Mentor 2 email" error={editMentorModal && !emailValid(editMentorModal.m2.email) ? "Invalid email" : undefined}>
                  <TextInput style={sEM.input} value={editMentorModal?.m2.email || ""} onChangeText={(t) => setEditMentorModal(v => (v ? { ...v, m2: { ...v.m2, email: t.trim() } } : v))} placeholder="email@example.com" keyboardType="email-address" autoCapitalize="none" />
                </Labeled>

                <View style={sEM.btnRow}>
                  <GlowButton label="Cancel" onPress={() => setEditMentorModal(null)} variant="ghost" />
                  <GlowButton label={savingMentors ? "Saving…" : "Save"} icon="check-circle" onPress={saveMentors} />
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

/* --------------------------- small labeled row --------------------------- */
function Labeled({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      {children}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  )
}

/* --------------------------- styles --------------------------- */
const styles = StyleSheet.create({
  pageGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 320 },
  glow: {
    position: "absolute",
    top: -10, left: -10, right: -10, bottom: -10,
    borderRadius: 14,
    opacity: 0.12,
    ...(Platform.OS === "web" ? { filter: "blur(18px)" as any } : null),
  },
  btnBase: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: "#1E3A8A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    minHeight: 40,
    alignSelf: "flex-start",
  },
  btnText: { fontWeight: "800", letterSpacing: 0.3 },
  // Pills (brand navy)
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#000080",
    backgroundColor: "#F8FAFC",
    shadowOpacity: 0,   // remove shadow
    elevation: 0,       // no elevation (Android)
  },
  pillActive: { backgroundColor: "#000080", borderColor: "#000080", shadowOpacity: 0, elevation: 0 },
  pillText: { fontSize: 13, fontWeight: "700", color: "#475569" },
  pillTextActive: { color: "#FFFFFF" },
  // Search
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#000080",
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    paddingRight: 12,
  },
  searchInput: { paddingHorizontal: 10, paddingVertical: 10, fontSize: 15, color: "#1E293B", flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 999, marginRight: 6 },
  dotGreen: { backgroundColor: "#10B981" },
  dotGray: { backgroundColor: "#94A3B8" },
})

const s = StyleSheet.create({
  /* layout */
  container: { padding: 16, gap: 16, backgroundColor: "#F8FAFC" },
  /* header (shorter + back + sign out) */
  header: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#000080", backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  headerContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  headerLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "#000080", backgroundColor: "#FFFFFF" },
  iconContainer: { width: 40, height: 40, backgroundColor: "#1E3A8A", borderRadius: 12, justifyContent: "center", alignItems: "center", marginRight: 8 },
  titleContainer: { flex: 1, minWidth: 160 },
  title: { fontSize: 22, fontWeight: "800", color: "#1E293B", marginBottom: 2 },
  subtitle: { fontSize: 13, color: "#64748B", fontWeight: "500" },

  // sign out
  dangerBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#ef4444", borderWidth: 1, borderColor: "#dc2626" },
  dangerBtnTxt: { color: "#fff", fontWeight: "800" },

  topRow: { flexDirection: "row", alignItems: "stretch", gap: 16, flexWrap: "wrap" },
  sideCard: { width: 690, alignItems: "center", minHeight: 170, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: "#000080", borderRadius: 16, padding: 16, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, alignSelf: "flex-start", overflow: "hidden" },
  ribbon: { position: "absolute", top: 0, left: 0, right: 0, height: 6, borderTopLeftRadius: 16, borderTopRightRadius: 16, zIndex: 1 },

  manageCard: { overflow: "hidden" },
  card: { backgroundColor: "#FFFFFF", alignItems: "center", borderWidth: 1.5, borderColor: "#000080", borderRadius: 16, padding: 18, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },

  cardTitle: { fontSize: 20, fontWeight: "800", color: "#1E293B", marginBottom: 4 },
  cardSub: { color: "#64748B", fontSize: 15, lineHeight: 22 },

  table: { borderWidth: 1.5, borderColor: "#000080", borderRadius: 16, overflow: "hidden", backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  thead: { backgroundColor: "#F8FAFC", flexDirection: "row", paddingHorizontal: 16, paddingVertical: 16, gap: 12, borderBottomWidth: 2, borderBottomColor: "#000080" },
  th: { fontSize: 13, fontWeight: "800", color: "#475569", letterSpacing: 0.5, textTransform: "uppercase" },
  loadingRow: { padding: 24, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  emptyState: { padding: 32, gap: 10, alignItems: "center" },
  emptyTitle: { fontWeight: "800", color: "#1E293B", fontSize: 18, textAlign: "center" },
  emptySub: { color: "#64748B", fontSize: 15, textAlign: "center", lineHeight: 22 },
  rowItem: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "#F1F5F9", alignItems: "center", backgroundColor: "#FFFFFF" },
  cell: { justifyContent: "center", paddingRight: 8 },
  cellText: { color: "#1E293B", fontSize: 15, fontWeight: "500" },

  tableToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  filterGroup: { flexDirection: "row", gap: 8 },
  toolbarCount: { color: "#64748B", fontSize: 13, fontWeight: "600" },

  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#F1F5F9", borderColor: "#000080", borderWidth: 1, borderRadius: 999 },
  chipTxt: { fontSize: 13, fontWeight: "700", color: "#334155" },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start", flexDirection: "row", alignItems: "center" },
  badgeGreen: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  badgeGray: { backgroundColor: "#F1F5F9", borderColor: "#CBD5E1" },
  badgeTxt: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  badgeTxtGreen: { color: "#065F46" },
  badgeTxtGray: { color: "#475569" },
  thRight: { textAlign: "right" },

  actionsCell: { flex: 2, alignItems: "flex-end" },
  actionsGroup: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },

  /* forms & modals */
  input: { borderWidth: 1, borderColor: "#000080", borderRadius: 12, padding: 14, fontSize: 16, color: "#1E293B", backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  locked: { fontWeight: "700", color: "#1E293B", fontSize: 16, backgroundColor: "#F8FAFC", padding: 12, borderRadius: 8, borderWidth: 1, borderColor: "#000080" },
  label: { fontSize: 14, fontWeight: "700", color: "#1E293B" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  modal: { backgroundColor: "#FFFFFF", borderRadius: 16, width: "100%", maxWidth: 600, maxHeight: "90%", paddingHorizontal: 16, paddingTop: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 10 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#1E293B", flex: 1, marginRight: 16 },

  innerTabs: { flexDirection: "row", gap: 6, backgroundColor: "#F1F5F9", padding: 6, borderRadius: 12, marginTop: 16 },
  error: { color: "#DC2626", fontSize: 13, fontWeight: "500", marginTop: 4 },
  groupLabel: { fontWeight: "800", color: "#000080", marginTop: 8, fontSize: 16, marginBottom: 8 },
  hr: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  stepperBtn: { borderWidth: 1, borderColor: "#000080", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#FFFFFF" },
  help: { color: "#64748B", fontSize: 13, fontStyle: "italic" },
  muted: { color: "#94A3B8", fontSize: 15, fontStyle: "italic" },

  previewList: { maxHeight: 200, borderWidth: 1, borderColor: "#000080", borderRadius: 12, backgroundColor: "#FFFFFF" },
  previewItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  previewText: { color: "#1E293B", fontWeight: "600", fontSize: 15 },

  confirmBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  confirmCard: { backgroundColor: "#FFFFFF", padding: 24, borderRadius: 16, width: "100%", maxWidth: 440, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 10 },
  confirmTitle: { fontSize: 18, fontWeight: "800", color: "#1E293B" },
  confirmSub: { color: "#64748B", marginTop: 2, fontSize: 15, lineHeight: 22 },
  confirmRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 12 },

  /* mobile cards */
  mobileCard: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1.5, borderColor: "#E2E8F0", padding: 12, gap: 8, shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  mobileTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  classTxt: { color: "#0f172a", fontSize: 18, fontWeight: "800" },
  clsIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgb(14, 7, 122)", alignItems: "center", justifyContent: "center" },
  mobileActions: { flexDirection: "row", gap: 8, marginTop: 8 },

  /* NEW one-line styles for mobile year bar */
  yearBarMobile: { width: "100%", borderWidth: 1.5, borderRadius: 14, padding: 12, gap: 10 as any, backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },

  yearButtons: { flexDirection: "row", gap: 8 }, // (unchanged, used on desktop; we center via inline justifyContent)
yearBarTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" }, // <- center title text on mobile bar
yearButtonsMobile: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8 as any }, // <- center pills on mobile

})

const sEM = StyleSheet.create({
  backdrop: { ...s.modalBackdrop, paddingHorizontal: 24 },
  modal: { ...s.modal, maxWidth: 540, maxHeight: "80%", paddingHorizontal: 20, paddingTop: 20 },
  header: { ...s.modalHeader, marginBottom: 12, paddingBottom: 10 },
  title:  { ...s.modalTitle, fontSize: 20 },
  body:   { paddingBottom: 20, gap: 10 },
  hr:     { height: 1, backgroundColor: "#E2E8F0", marginVertical: 12 },
  input:  { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 16 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  primaryBtn: { backgroundColor: "#000080", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", flex: 1 },
  primaryBtnText: { color: "#fff", fontWeight: "800" },
  btnGhost: { borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#fff", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", flex: 1 },
  btnGhostText: { color: "#0F172A", fontWeight: "700" },
  close: { fontSize: 18, color: "#64748B", padding: 4 },
  groupLabel: { color: "#334155", fontWeight: "700", marginBottom: 6, marginTop: 4 },
})
