// app/admin/dashboard.tsx — Merged UI (from old Admin UI) + New Logic (HOD + legacy support)
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import {
  addDoc,
  collection,
  getDocs,
  query,
  where
} from 'firebase/firestore'

import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { canonicalClassKey, yearfulCanon } from '../../constants/classKey'
import { auth, db } from '../../firebase'

// -------------------------
// Types & constants
// -------------------------
type ClassItem = { id: string; name: string; _raw?: any }
// 🔁 CHANGED: allow only @citchennai.net (case-insensitive, subdomains allowed)
const ALLOWED = /^[^@]+@(?:.*\.)?citchennai\.net$/i

const toLower = (s: string | null | undefined) => (s ?? '').toLowerCase()

// Map Firestore doc -> ClassItem (supports both models)
const mapDoc = (id: string, data: any): ClassItem => {
  if (typeof data?.name === 'string') {
    // legacy shape: {name, mentor}
    return { id, name: data.name, _raw: data }
  }
  // HOD shape: { dept, year, section, mentorEmails: [...] }
  const dept = data?.dept || 'CSE'
  const section = data?.section || '—'
  const year = data?.year ? ` (Year ${data.year})` : ''
  return { id, name: `${dept}-${String(section).toUpperCase()}${year}`, _raw: data }
}

// -------------------------
// Component
// -------------------------
export default function AdminDashboard() {
  const router = useRouter()

  // auth + main state
  const [userEmail, setUserEmail] = useState<string | null>(null) // null = loading, '' = no user
  const [classes, setClasses] = useState<ClassItem[]>([])

  // create modal
  const [modalVisible, setModalVisible] = useState(false)
  const [department, setDepartment] = useState('')
  const [section, setSection] = useState('')

  // delete flow
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<ClassItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // students count
  const [studentCounts, setStudentCounts] = useState<Record<string, number>>({})
  const totalStudents = useMemo(
    () => Object.values(studentCounts).reduce((a, b) => a + b, 0),
    [studentCounts]
  )

  // -------------------------
  // UI helpers (pure UI)
  // -------------------------
  const getDept = (name: string) => (name.split('-')[0] || name).trim()
  const deptCount = new Set(classes.map(c => getDept(c.name))).size

  // -------------------------
  // AUTH GUARD (preserve logic)
  // -------------------------
  useEffect(() => {
    const sub = onAuthStateChanged(auth, u => {
      if (!u?.email || !ALLOWED.test(u.email)) {
        setUserEmail('')
        router.replace('/admin/login')
      } else {
        setUserEmail(u.email)
      }
    })
    return sub
  }, [])

  // -------------------------
  // Which sections this mentor is allowed to create (from their assigned classes)
  // -------------------------
  const getSectionFromItem = (item: ClassItem): string | null => {
    if (item._raw?.section) return String(item._raw.section).toUpperCase()
    const parts = (item.name || '').split('-')
    if (parts.length >= 2) return parts[1].trim().toUpperCase()
    return null
  }

  const allowedSections = useMemo(() => {
    const s = new Set<string>()
    classes.forEach(ci => {
      const sec = getSectionFromItem(ci)
      if (sec) s.add(sec.toUpperCase())
    })
    return s
  }, [classes])

  // -------------------------
  // LOAD CLASSES (NEW LOGIC): legacy + HOD models
  // -------------------------
  const refresh = async (email: string) => {
    const emailLower = toLower(email)
    const colRef = collection(db, 'classes')

    // legacy mentor-created docs
    const qLegacy = query(colRef, where('mentor', '==', email))
    // HOD-created docs (we saved lowercased mentor emails)
    const qHod = query(colRef, where('mentorEmails', 'array-contains', emailLower))

    const [snapLegacy, snapHod] = await Promise.all([getDocs(qLegacy), getDocs(qHod)])

    const byId = new Map<string, ClassItem>()
    snapLegacy.docs.forEach(d => byId.set(d.id, mapDoc(d.id, d.data())))
    snapHod.docs.forEach(d => byId.set(d.id, mapDoc(d.id, d.data())))

    const rows = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
    setClasses(rows)
  }

  useEffect(() => {
    if (userEmail) refresh(userEmail)
  }, [userEmail])

  // COUNT STUDENTS (robust: group + top-level + subcollection + fallback fields)
  // -------------------------
  // -------------------------
  // COUNT STUDENTS to match admin/attendance.tsx rules
  // -------------------------
  useEffect(() => {
    const run = async () => {
      if (!classes.length) {
        setStudentCounts({})
        return
      }

      const studentsCol = collection(db, 'students') // top-level collection
      const results: Record<string, number> = {}

      await Promise.all(
        classes.map(async (item) => {
          // derive dept, section, year from the display name e.g. "CSE-M (Year 3)"
          const base = (item.name || '').split(' (Year')[0].trim() // "CSE-M"
          const [deptRaw, secRaw] = base.split('-')
          const dept = (deptRaw || '').trim().toUpperCase()
          const section = (secRaw || '').trim().toUpperCase()
          const m = item.name.match(/\(Year\s*(\d+)\)/i)
          const yearInt: number | null = m ? Number(m[1]) : null

          // build keys similar to admin/attendance.tsx
          const canonLegacy = canonicalClassKey(base)          // "CSE-M"
          const canonYearful = yearInt ? yearfulCanon(dept, section, yearInt) : canonLegacy // "CSE-M-Y3" or "CSE-M"

          let count = 0

          // 1) yearful: CLASS_CANON == "CSE-M-Y3"
          try {
            const s1 = await getDocs(query(studentsCol, where('CLASS_CANON', '==', canonYearful)))
            count = s1.size
          } catch {}

          // 2) legacy+year: CLASS_CANON == "CSE-M" AND year == 3
          if (count === 0 && yearInt != null) {
            try {
              const s2 = await getDocs(
                query(
                  studentsCol,
                  where('CLASS_CANON', '==', canonLegacy),
                  where('year', '==', yearInt)
                )
              )
              count = s2.size
            } catch {}
          }

          // 3) pure display match: CLASS == "CSE-M (Year 3)"
          if (count === 0) {
            try {
              const s3 = await getDocs(query(studentsCol, where('CLASS', '==', item.name)))
              count = s3.size
            } catch {}
          }

          results[item.id] = count
        })
      )

      setStudentCounts(results)
    }
    run()
  }, [classes])

  // -------------------------
  // CREATE CLASS (restricted to assigned sections)
  // -------------------------
  const addClass = async () => {
    if (!userEmail) return
    const dept = (department || '').trim()
    const sec = (section || '').trim().toUpperCase()
    if (!dept || !sec) return

    if (allowedSections.size === 0) {
      Alert.alert('Not allowed', 'Ask the HOD to assign you to a class first.')
      return
    }

    if (!allowedSections.has(sec)) {
      Alert.alert(
        'Not allowed',
        `You can only create classes for your assigned sections: ${[...allowedSections].join(', ')}`
      )
      return
    }

    const name = `${dept}-${sec}`
    if (classes.some(c => c.name.split(' (Year ')[0] === name)) {
      setModalVisible(false)
      setDepartment('')
      setSection('')
      return
    }

    await addDoc(collection(db, 'classes'), {
      // keep legacy shape so nothing else breaks
      name,
      mentor: userEmail,
      created: Date.now(),
    })

    setModalVisible(false)
    setDepartment('')
    setSection('')
    await refresh(userEmail)
  }


  const doSignOut = async () => {
    await signOut(auth)
    router.replace('/')
  }

  // -------------------------
  // Render (UI from old upgraded design)
  // -------------------------
  if (userEmail === null) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Checking session…</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header (glass bar) */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={18} color="#0f172a" />
          </TouchableOpacity>
          <View style={styles.logoBadge}>
            <MaterialCommunityIcons name="school" size={18} color="#fff" />
          </View>
          <View style={styles.headerTextWrap}>
  <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">Admin Dashboard</Text>
  <Text style={styles.headerSub} numberOfLines={1} ellipsizeMode="tail">Logged in as: {userEmail || '-'}</Text>
</View>

        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={doSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutTxt}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats cards */}
      <View style={styles.stats}>
        <View style={styles.statCard}>
          <Text style={styles.statTitle}>Total Classes</Text>
          <View style={styles.statRow}>
            <Text style={styles.statValue}>{classes.length}</Text>
            <View style={[styles.statIconBox, { backgroundColor: '#0ea5e9' }]}>
              <MaterialCommunityIcons name="book-open-variant" size={18} color="#fff" />
            </View>
          </View>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statTitle}>Total Students</Text>
          <View style={styles.statRow}>
            <Text style={styles.statValue}>
              {classes.length ? totalStudents : '—'}
            </Text>
            <View style={[styles.statIconBox, { backgroundColor: '#16a34a' }]}>
              <MaterialCommunityIcons name="account-group" size={18} color="#fff" />
            </View>
          </View>
          <Text style={styles.statHint}>Summed across listed classes</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statTitle}>Departments</Text>
          <View style={styles.statRow}>
            <Text style={styles.statValue}>{deptCount}</Text>
            <View style={[styles.statIconBox, { backgroundColor: '#a855f7' }]}>
              <MaterialCommunityIcons name="domain" size={18} color="#fff" />
            </View>
          </View>
        </View>
      </View>

      {/* Empty state */}
      {classes.length === 0 && (
        <Text style={styles.noClasses}>
          No classes assigned yet. Ask your HOD to add you as a mentor.
        </Text>
      )}

      {/* Class list */}
      <FlatList
        data={classes}
        keyExtractor={c => c.id}
        contentContainerStyle={
          classes.length === 0 ? { flex: 1, justifyContent: 'center', alignItems: 'center' } : undefined
        }
        renderItem={({ item }) => {
          const count = studentCounts[item.id]
          return (
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.classBtn, { flex: 1, marginRight: 8 }]}
                onPress={() =>
                  router.push({
                    pathname: '/admin/attendance',
                    params: {
                      // keep old display name for UI
                      cls: item.name,
                      // NEW: send canonical key for Firestore queries
                      clsCanon: canonicalClassKey(item.name),
                      mentor: userEmail ?? '',
                    },
                  })
                }
              >
                <View style={styles.classHead}>
                  <View style={styles.clsIcon}>
                    <MaterialCommunityIcons name="book-outline" size={16} color="#fff" />
                  </View>
                  <Text style={styles.classTxt} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.badge}>{getDept(item.name)}</Text>
                  <Text style={styles.metaDot}>•</Text>
                  <Text style={styles.metaTxt}>
                    {typeof count === 'number' ? `${count} students` : '…'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          )
        }}
      />

      {/* Bottom big CTA */}

      {/* New Class Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Class</Text>
            <TextInput
              placeholder="Department (e.g. CSE)"
              value={department}
              onChangeText={setDepartment}
              style={styles.input}
            />
            <TextInput
              placeholder="Section (e.g. C)"
              value={section}
              onChangeText={t => setSection(t.toUpperCase())}
              style={styles.input}
            />
            <Text style={{ color: '#6B7280', marginBottom: 8 }}>
              You can only create sections you are assigned to: {classes.length ? [...allowedSections].join(', ') : '—'}
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalBtn} onPress={addClass}>
                <Text style={styles.modalBtnTxt}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.cancel]} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm Delete Modal (Web) */}
      
    </SafeAreaView>
  )
}

// -------------------------
// Styles — upgraded theme from old UI
// -------------------------
const styles = StyleSheet.create({
  // Page
  container: {
    flex: 1,
    backgroundColor: '#F5F7FF',
    paddingHorizontal: 24,
    // paddingTop removed to respect safe area
    paddingBottom: 24,
  },

  // Header (glass)
headerBar: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottomWidth: 1,
  borderColor: 'rgba(226,232,240,0.8)',
  backgroundColor: 'rgba(255,255,255,0.88)',
  paddingVertical: 12,
  paddingHorizontal: 8,   // a bit more padding
  borderRadius: 12,
  overflow: 'hidden',
  marginBottom: 14,
},

  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(241,245,249,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  logoBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgb(14, 7, 122)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  headerSub: { color: '#475569', fontSize: 12, marginTop: 2 },
headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(241,245,249,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.8)',
  },
  iconTxt: { fontSize: 14 },

  // Sign out: RED button
  signOutBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  signOutTxt: { color: '#FFFFFF', fontWeight: '800' },

  // Stats
  stats: { flexDirection: 'row', gap: 12, marginTop: 10, marginBottom: 16, alignItems: 'stretch' },
  statCard: {
  flex: 1,
  flexBasis: 0,     // ⬅ add
  minWidth: 0,      // ⬅ add
  backgroundColor: 'rgba(255,255,255,0.92)',
  borderWidth: 1,
  borderColor: 'rgba(226,232,240,0.8)',
  borderRadius: 18,
  paddingVertical: 14,
  paddingHorizontal: 16,
  shadowColor: '#0b1220',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
},
statTitle: { color: '#64748b', fontSize: 12, fontWeight: '600', marginBottom: 6, flexShrink: 1 },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statValue: { color: '#0f172a', fontSize: 24, fontWeight: '800' },
  statHint: { marginTop: 6, fontSize: 11, color: '#6b7280' },

  // Empty state
  noClasses: { textAlign: 'center', fontSize: 16, color: '#64748b', marginTop: 24 },

  // Class row (card)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.8)',
    backgroundColor: 'rgba(255,255,255,0.96)',
    marginBottom: 14,
    shadowColor: '#0b1220',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },

  classBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: 'transparent',
    borderRadius: 12,
  },
  classHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  clsIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgb(14, 7, 122)',
    alignItems: 'center',
    justifyContent: 'center',
  },
classTxt: { color: '#0f172a', fontSize: 18, fontWeight: '800', minWidth: 0, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    color: '#3730a3',
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '700',
  },
  metaDot: { color: '#94a3b8', fontSize: 14, marginHorizontal: 2 },
  metaTxt: { color: '#475569', fontSize: 12, fontWeight: '700' },

  // Delete = outlined red
  deleteBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#fecaca',
  },
  deleteTxt: { color: '#dc2626', fontWeight: '700' },

  // Bottom big CTA
  fab: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 24,
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgb(14, 7, 122)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0E077A',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  fabTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },

  // Modals
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#E6ECF3',
    shadowColor: '#0b1220',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  input: {
    height: 50,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    color: '#0f172a',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  modalBtns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    backgroundColor: '#4f46e5',
    shadowColor: '#312e81',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  cancel: { backgroundColor: '#94a3b8' },
  modalBtnTxt: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.2 },
  headerTextWrap: { flexShrink: 1, minWidth: 0 },
  statIconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})