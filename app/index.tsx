"use client"
import { BlurView } from "expo-blur"
import { useRouter } from "expo-router"
import { useEffect, useRef } from "react"
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import "react-native-gesture-handler"
import {
  GestureHandlerRootView,
  State as GHState,
  PanGestureHandler,
  type HandlerStateChangeEvent,
  type PanGestureHandlerEventPayload,
} from "react-native-gesture-handler"

// SVG for vector petals + gradients
import Svg, {
  Defs,
  G,
  Path,
  Stop,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient
} from "react-native-svg"

const { width: screenWidth, height: screenHeight } = Dimensions.get("window")

// ----------------- flower config ----------------
const FLOWER_SCALE = 1.35      // 1.1–1.8 for size
//-------------------------------------------------

/** SVG flower: 4 gradient petals + glowing oval core */
function RealisticFlowerSVG() {
  const vw = 1000, vh = 700
  const cx = 500,  cy = 350

  const PETAL_LEN = 280
  const PETAL_W1  = 170
  const PETAL_W2  = 260
  const CORE_RX   = 220
  const CORE_RY   = 160
  const HALO_RX   = 400
  const HALO_RY   = 290

  const petalPath = `
    M ${cx} ${cy - PETAL_LEN}
    C ${cx + PETAL_W1} ${cy - PETAL_LEN}, ${cx + PETAL_W2} ${cy - 70}, ${cx} ${cy + 10}
    C ${cx - PETAL_W2} ${cy - 70}, ${cx - PETAL_W1} ${cy - PETAL_LEN}, ${cx} ${cy - PETAL_LEN}
    Z
  `

  return (
    <View style={[s.flowerSvg, { transform: [{ scale: FLOWER_SCALE }] }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={`0 0 ${vw} ${vh}`}>
        <Defs>
          <SvgRadialGradient id="halo" cx="50%" cy="50%" r="65%">
            <Stop offset="0%"  stopColor="rgba(255,255,255,0.33)" />
            <Stop offset="100%" stopColor="rgba(255,255,255,0.00)" />
          </SvgRadialGradient>

          <SvgLinearGradient id="petalGrad" x1="50%" y1="0%" x2="50%" y2="100%">
            <Stop offset="0%"  stopColor="rgba(255,255,255,0.98)" />
            <Stop offset="100%" stopColor="rgba(255,255,255,0.60)" />
          </SvgLinearGradient>

          <SvgRadialGradient id="coreGrad" cx="50%" cy="40%" r="70%">
            <Stop offset="0%"  stopColor="rgba(255,255,255,1)" />
            <Stop offset="100%" stopColor="rgba(255,255,255,0.82)" />
          </SvgRadialGradient>
        </Defs>

        {/* PETALS ONLY — no halos/cores/strokes */}
<G opacity={0.95}>
  <Path d={petalPath} fill="url(#petalGrad)" stroke="rgba(255,255,255,0.55)" strokeWidth={2}/>
  <Path d={petalPath} transform={`rotate(90 ${cx} ${cy})`}  fill="url(#petalGrad)" stroke="rgba(255,255,255,0.55)" strokeWidth={2}/>
  <Path d={petalPath} transform={`rotate(180 ${cx} ${cy})`} fill="url(#petalGrad)" stroke="rgba(255,255,255,0.55)" strokeWidth={2}/>
  <Path d={petalPath} transform={`rotate(270 ${cx} ${cy})`} fill="url(#petalGrad)" stroke="rgba(255,255,255,0.55)" strokeWidth={2}/>
</G>

      </Svg>

      {/* soft bloom */}
      <BlurView intensity={12} tint="light" style={StyleSheet.absoluteFillObject} />
    </View>
  )
}

export default function Landing() {
  const router = useRouter()

  const logoScale = useRef(new Animated.Value(0.8)).current
  const logoOpacity = useRef(new Animated.Value(0)).current
  const titleTranslateY = useRef(new Animated.Value(30)).current
  const titleOpacity = useRef(new Animated.Value(0)).current
  const subtitleTranslateY = useRef(new Animated.Value(30)).current
  const subtitleOpacity = useRef(new Animated.Value(0)).current
  const buttonsTranslateY = useRef(new Animated.Value(40)).current
  const buttonsOpacity = useRef(new Animated.Value(0)).current
  const buttonScale1 = useRef(new Animated.Value(0.9)).current
  const buttonScale2 = useRef(new Animated.Value(0.9)).current

  const cursorX = useRef(new Animated.Value(screenWidth / 2)).current
  const cursorY = useRef(new Animated.Value(screenHeight / 2)).current
  const orb1TranslateX = Animated.subtract(cursorX, 150)
  const orb1TranslateY = Animated.subtract(cursorY, 150)
  const orb2TranslateX = Animated.subtract(cursorX, 100)
  const orb2TranslateY = Animated.subtract(cursorY, 100)

  const particleAnimations = useRef(
    Array.from({ length: 6 }, () => {
      const baseX = new Animated.Value(Math.random() * screenWidth)
      const baseY = new Animated.Value(Math.random() * screenHeight)
      const dy = new Animated.Value(0)
      const scale = new Animated.Value(0.5 + Math.random() * 0.5)
      const opacity = new Animated.Value(0.3 + Math.random() * 0.4)
      return { baseX, baseY, dy, scale, opacity }
    })
  ).current

  useEffect(() => {
    // entrance anims
    Animated.parallel([
      Animated.timing(logoScale, { toValue: 1, duration: 800, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start()

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleTranslateY, { toValue: 0, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]).start()
    }, 200)

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(subtitleTranslateY, { toValue: 0, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(subtitleOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]).start()
    }, 400)

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(buttonsTranslateY, { toValue: 0, duration: 700, easing: Easing.out(Easing.back(1.1)), useNativeDriver: true }),
        Animated.timing(buttonsOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(buttonScale1, { toValue: 1, duration: 700, easing: Easing.out(Easing.back(1.1)), useNativeDriver: true }),
        Animated.timing(buttonScale2, { toValue: 1, duration: 700, delay: 100, easing: Easing.out(Easing.back(1.1)), useNativeDriver: true }),
      ]).start()
    }, 600)

    // floating particles
    particleAnimations.forEach((p, idx) => {
      const range = 60 + Math.random() * 80
      const speed = 3000 + Math.random() * 2000
      const float = Animated.loop(
        Animated.sequence([
          Animated.timing(p.dy, { toValue: -range, duration: speed, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(p.dy, { toValue: range, duration: speed, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      )
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(p.scale, { toValue: 0.8 + Math.random() * 0.4, duration: 2000 + Math.random() * 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(p.scale, { toValue: 0.3 + Math.random() * 0.4, duration: 2000 + Math.random() * 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      )
      setTimeout(() => { float.start(); pulse.start() }, idx * 400)
    })
  }, [])

  // gestures
  const onGestureEvent = Animated.event(
    [{ nativeEvent: { x: cursorX, y: cursorY } }],
    { useNativeDriver: false }
  )
  const onHandlerStateChange = (e: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
    if (e.nativeEvent.state === GHState.END) {
      Animated.parallel([
        Animated.spring(cursorX, { toValue: e.nativeEvent.x, useNativeDriver: false }),
        Animated.spring(cursorY, { toValue: e.nativeEvent.y, useNativeDriver: false }),
      ]).start()
    }
  }

  const handleAdminPress = () => {
    Animated.sequence([
      Animated.timing(buttonScale1, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(buttonScale1, { toValue: 1.05, duration: 150, useNativeDriver: true }),
      Animated.timing(buttonScale1, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start(() => router.push("/admin/login"))
  }


  return (
    <GestureHandlerRootView style={s.gradient}>
      <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
        <Animated.View style={s.container}>

          {/* SVG FLOWER (background accent) */}
          <RealisticFlowerSVG />

          <View style={s.backgroundPattern} />

          {/* Logo */}
          <Animated.View style={[s.logoContainer, { transform: [{ scale: logoScale }], opacity: logoOpacity }]}>
            <Image source={require("../assets/cit-logo.png")} style={s.logo} />
          </Animated.View>

          {/* Title */}
          <Animated.View style={[s.titleContainer, { transform: [{ translateY: titleTranslateY }], opacity: titleOpacity }]}>
            <Text style={s.title}>Welcome to CIT Attendance Portal!</Text>
          </Animated.View>

          {/* Subtitle */}
          <Animated.View style={[s.subtitleContainer, { transform: [{ translateY: subtitleTranslateY }], opacity: subtitleOpacity }]}>
            <Text style={s.subtitle}>Choose your portal</Text>
          </Animated.View>

          {/* Buttons */}
          <Animated.View style={[s.buttonsContainer, { transform: [{ translateY: buttonsTranslateY }], opacity: buttonsOpacity }]}>
            <Animated.View style={{ transform: [{ scale: buttonScale1 }] }}>
              <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={handleAdminPress} activeOpacity={0.8}>
                <Text style={s.btnTxt}>Admin / Mentor</Text>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={{ transform: [{ scale: buttonScale1 }] }}>
              <TouchableOpacity
  onPress={() => router.push("/hod/login")}   // CHANGED: was "/hod"
  style={[s.btn, s.btnHOD]}
  activeOpacity={0.8}
>
  <Text style={s.btnTxtHOD}>HOD</Text>
</TouchableOpacity>
            </Animated.View>

            <Animated.View style={{ transform: [{ scale: buttonScale2 }] }}>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </PanGestureHandler>
    </GestureHandlerRootView>
  )
}

const s = StyleSheet.create({
  gradient: { flex: 1, backgroundColor: "#F1F5F9" },
  container: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, paddingVertical: 40 },

  // SVG flower container
  flowerSvg: {
    position: "absolute",
    width: Math.min(screenWidth * 1.25, 1100),
    height: Math.min(screenHeight * 0.72, 640),
    alignSelf: "center",
    zIndex: -2,
  },

  // ambient shapes
  orb1: { position: "absolute", width: 300, height: 300, borderRadius: 150, backgroundColor: "#DBEAFE", opacity: 0.25, zIndex: -3 },
  orb2: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "#E0E7FF", opacity: 0.22, zIndex: -3 },
  particle: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: "#3B82F6", opacity: 0.35, zIndex: -1 },

  backgroundPattern: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "transparent", zIndex: -1 },

  logoContainer: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 20, marginBottom: 32, shadowColor: "#000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 12 },
  logo: { width: 180, height: 100, resizeMode: "contain" },

  titleContainer: { marginBottom: 12, paddingHorizontal: 16 },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center", color: "#1E293B", letterSpacing: -0.5, lineHeight: 34 },

  subtitleContainer: { marginBottom: 40, paddingHorizontal: 16 },
  subtitle: { fontSize: 16, textAlign: "center", color: "#64748B", fontWeight: "500", letterSpacing: 0.2 },

  buttonsContainer: { flexDirection: "row", gap: 16, justifyContent: "center", flexWrap: "wrap", paddingHorizontal: 16 },
  btn: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, minWidth: 140, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 },
  btnPrimary: { backgroundColor: "#000080", borderWidth: 2, borderColor: "#FFFFFF" },
  btnSecondary: { backgroundColor: "#000080", borderWidth: 2, borderColor: "#FFFFFF" },
  btnHOD: { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#1E40AF" },
  btnTxt: { color: "#FFFFFF", fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
  btnTxtHOD: { color: "#1E40AF", fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
})
