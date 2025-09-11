"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "expo-router"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { Feather } from "@expo/vector-icons"
import { onAuthStateChanged } from "firebase/auth"
import { auth } from "@/firebase"
import { SUPERMAIL } from "@/constants/app"
const COLORS = {
  primary: "#2563EB", // blue-600
  dark: "#0B1220", // near-black
  light: "#F3F4F6", // gray-100
  white: "#FFFFFF", // white
  accent: "#10B981", // emerald-500
}

function GlowButton({
  label,
  icon,
  onPress,
  backgroundColor,
  textColor = COLORS.white,
  accessibilityLabel,
}: {
  label: string
  icon: keyof typeof Feather.glyphMap
  onPress: () => void
  backgroundColor: string
  textColor?: string
  accessibilityLabel?: string
}) {
  const scale = useRef(new Animated.Value(1)).current
  const glow = useRef(new Animated.Value(0)).current // 0..1
  const ring = useRef(new Animated.Value(0)).current // focus ring 0..1

  const pressIn = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 0.97,
        useNativeDriver: true,
        speed: 20,
        bounciness: 6,
      }),
      Animated.timing(glow, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start()
  }
  const pressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 6,
      }),
      Animated.timing(glow, {
        toValue: 0.15,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const onFocus = () =>
    Animated.timing(ring, { toValue: 1, duration: 140, useNativeDriver: false }).start()
  const onBlur = () =>
    Animated.timing(ring, { toValue: 0, duration: 140, useNativeDriver: false }).start()

  // subtle idle glow on mount
  useEffect(() => {
    glow.setValue(0.15)
  }, [glow])

  const ringStyle = {
    borderWidth: 2,
    borderColor: ring.interpolate({
      inputRange: [0, 1],
      outputRange: ["transparent", backgroundColor],
    }) as any,
  }

  return (
    <Animated.View style={[styles.cardShadow, { transform: [{ scale }] }]}>
      {/* hover/press glow backdrop */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            opacity: glow,
            backgroundColor:
              backgroundColor === COLORS.dark ? "#1f2937" : "#93c5fd",
          },
        ]}
      />
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        onHoverIn={() => {
          if (Platform.OS === "web")
            Animated.timing(glow, {
              toValue: 0.35,
              duration: 150,
              useNativeDriver: true,
            }).start()
        }}
        onHoverOut={() => {
          if (Platform.OS === "web")
            Animated.timing(glow, {
              toValue: 0.15,
              duration: 200,
              useNativeDriver: true,
            }).start()
        }}
        android_ripple={{
          color: "rgba(255,255,255,0.25)",
          foreground: true,
        }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        style={[styles.card, ringStyle, { backgroundColor }]}
      >
        <View style={styles.cardContent}>
          <Feather name={icon} size={18} color={textColor} />
          <Text style={[styles.cardLabel, { color: textColor }]}>{label}</Text>
          <Feather
            name="chevron-right"
            size={18}
            color={textColor}
            style={{ marginLeft: 6, opacity: 0.9 }}
          />
        </View>
      </Pressable>
    </Animated.View>
  )
}
function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Go back"
      accessibilityRole="button"
      style={styles.backBtn}
      android_ripple={{ color: "rgba(0,0,0,0.08)", foreground: true }}
    >
      <Feather name="chevron-left" size={22} color={COLORS.dark} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  )
}

export default function HodHome() {
  const router = useRouter()

  const containerOpacity = useRef(new Animated.Value(0)).current
  const containerTranslateY = useRef(new Animated.Value(12)).current
  const titleOpacity = useRef(new Animated.Value(0)).current
  const titleTranslateY = useRef(new Animated.Value(8)).current
  const underlineProgress = useRef(new Animated.Value(0)).current
const [ready, setReady] = useState(false)
  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(containerOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(containerTranslateY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslateY, {
          toValue: 0,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(underlineProgress, {
          toValue: 1,
          delay: 40,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start()
  }, [containerOpacity, containerTranslateY, titleOpacity, titleTranslateY, underlineProgress])
useEffect(() => {
    // THE CODE CHANGED PART (auth guard)
    const unsub = onAuthStateChanged(auth, (u) => {
      const mail = (u?.email || "").toLowerCase()
      if (!u || mail !== SUPERMAIL) {
        router.replace("/hod/login")     // not allowed -> send to login
      } else {
        setReady(true)                   // allowed -> render portal
      }
    })
    return unsub
    // THE CODE CHANGED PART (auth guard)
  }, [router])

  // prevent flicker while checking auth
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: COLORS.white }} />
  }
const buttons = [
  {
    label: "Classes",
    icon: "users" as const,
    bg: "#000080",
    text: COLORS.white,
    action: () => router.push("/hod/classes"),
  },
  {
    label: "Attendance",
    icon: "check-square" as const,
    bg: COLORS.dark,
    text: COLORS.white,
    action: () => router.push("/hod/attendence"),
  },
]

  return (
    <View style={[styles.screen, { backgroundColor: COLORS.white }]}>
      <BackButton onPress={() => router.back()} />
      {/* soft background depth */}
      <LinearGradient
        colors={["#e7f0ff", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.9 }}
        style={styles.glowTop}
        pointerEvents="none"
      />

      <Animated.View
        style={{
          opacity: containerOpacity,
          transform: [{ translateY: containerTranslateY }],
          alignItems: "center",
          width: "100%",
        }}
      >
        <Animated.View
          style={[
            styles.headerWrap,
            { opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] },
          ]}
        >
          <Text style={styles.title} accessibilityRole="header">
            HOD Portal
          </Text>
          <Animated.View
            style={[
              styles.titleUnderline,
              { backgroundColor: '#000080', transform: [{ scaleX: underlineProgress }] },
            ]}
          />
          <Text style={styles.subtitle}>Manage academics with clarity and speed</Text>
        </Animated.View>

        <View style={styles.grid}>
          {buttons.map((b) => (
            <GlowButton
              key={b.label}
              label={b.label}
              icon={b.icon}
              backgroundColor={b.bg}
              textColor={b.text}
              onPress={b.action}
              accessibilityLabel={`${b.label} section`}
            />
          ))}
        </View>

        <View style={styles.helper}>
          <Text style={styles.helperText}>Tip: You can revisit any section at any time.</Text>
          <View style={styles.statusPill}>
            <View style={[styles.dot, { backgroundColor: COLORS.accent }]} />
            <Text style={styles.statusText}>Online</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  glowTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 420,
  },
  headerWrap: {
    width: "100%",
    maxWidth: 560,
    alignItems: "center",
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.dark,
    textAlign: "center",
    letterSpacing: 0.2,
  },
  titleUnderline: {
    marginTop: 6,
    height: 3,
    width: 90,
    borderRadius: 3,
    alignSelf: "center",
    transform: [{ scaleX: 0 }],
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 1.5,
  },
  subtitle: {
    marginTop: 10,
    color: "#374151",
    textAlign: "center",
    fontSize: 14,
  },
  grid: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14 as any,
    justifyContent: "center",
  },
  cardShadow: {
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
    overflow: "visible",
  },
  glow: {
    position: "absolute",
    top: -12,
    left: -12,
    right: -12,
    bottom: -12,
    borderRadius: 20,
    opacity: 0,
    transform: [{ scale: 1 }],
    filter: Platform.OS === "web" ? "blur(24px)" : undefined, // safe no-op on native
  } as any,
  card: {
    paddingVertical: 18,
    paddingHorizontal: 26,
    borderRadius: 14,
    minWidth: 200,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: '#000080',
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardLabel: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginLeft: 8,
  },
  helper: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8 as any,
  },
  helperText: {
    fontSize: 12,
    color: "#6B7280",
  },
  statusPill: {
    marginLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6 as any,
  },
  statusText: {
    fontSize: 11,
    color: "#065F46",
    fontWeight: "600",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  backBtn: {
  position: "absolute",
  top: Platform.select({ ios: 52, android: 44, default: 18 }), // ↓ more space on mobile
  left: 16,
  zIndex: 20,
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 10,
  paddingVertical: 8,
  borderRadius: 12,
  backgroundColor: "rgba(255,255,255,0.9)",
  shadowColor: "#000",
  shadowOpacity: 0.08,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 6,
  elevation: 3,
},

backText: {
  marginLeft: 2,
  fontSize: 14,
  fontWeight: "700",
  color: COLORS.dark,
},

})
