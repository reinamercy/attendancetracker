"use client"

// app/hod/login.tsx
import { SUPERMAIL } from "@/constants/app"
import { auth, db } from "@/firebase"
import { Stack, useRouter } from "expo-router"
import { signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth"
import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { useEffect, useRef, useState } from "react"
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform as RNPlatform,
  Animated,
  Easing,
  Pressable,
} from "react-native"

// 👇 add this import
import ButterflyTrail from "@/components/ButterflyTrail"

const NAVY = "#000080"

const show = (title: string, msg?: string) => {
  if (Platform.OS === "web") {
    // @ts-ignore
    ;(window as any)?.alert?.(msg ? `${title}\n\n${msg}` : title)
  } else {
    Alert.alert(title, msg)
  }
}

export default function HODLogin() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [focusedEmail, setFocusedEmail] = useState(false)
  const [focusedPassword, setFocusedPassword] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const titleAnim = useRef(new Animated.Value(0)).current
  const underlineAnim = useRef(new Animated.Value(0)).current
  const cardAnim = useRef(new Animated.Value(0)).current
  const loginScale = useRef(new Animated.Value(1)).current
  const googleScale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(titleAnim, {
        toValue: 1,
        duration: 420,
        delay: 60,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(underlineAnim, {
        toValue: 1,
        duration: 600,
        delay: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(cardAnim, {
        toValue: 1,
        duration: 500,
        delay: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start()
  }, [fadeAnim, titleAnim, underlineAnim, cardAnim])

  const pressIn = (v: Animated.Value) =>
    Animated.spring(v, { toValue: 0.97, useNativeDriver: true, friction: 5, tension: 120 }).start()
  const pressOut = (v: Animated.Value) =>
    Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 5, tension: 120 }).start()

  const upsertHod = async (mail: string) => {
    if (auth.currentUser?.uid) {
      await setDoc(
        doc(db, "hods", auth.currentUser.uid),
        { email: mail, uid: auth.currentUser.uid, createdAt: serverTimestamp() },
        { merge: true },
      )
    }
  }

  const handleLogin = async () => {
    const e = email.trim().toLowerCase()
    const p = password.trim()
    if (!e || !p) return show("Missing", "Enter email & password")
    if (e !== SUPERMAIL) return show("Access blocked", `Only ${SUPERMAIL} can access HOD portal.`)
    if (p.length < 6) return show("Password too short", "Use at least 6 characters.")

    try {
      setBusy(true)
      await signInWithEmailAndPassword(auth, e, p)
      await upsertHod(e)
      router.replace("/hod")
    } catch (err: any) {
      const code = err?.code || ""
      if (code === "auth/user-not-found") return show("User not found", "Create the account in Firebase Auth.")
      if (code === "auth/invalid-credential" || code === "auth/wrong-password")
        return show("Wrong password", "Check your password and try again.")
      if (code === "auth/too-many-requests") return show("Too many attempts", "Please wait a minute and try again.")
      show("Login failed", err instanceof Error ? err.message : String(err))
      try {
        await signOut(auth)
      } catch {}
    } finally {
      setBusy(false)
    }
  }

  const handleGoogleWeb = async () => {
    if (Platform.OS !== "web") return show("Unavailable", "Google sign-in is enabled on web only.")
    try {
      setBusy(true)
      const provider = new GoogleAuthProvider()
      const cred = await signInWithPopup(auth, provider)
      const mail = cred.user.email?.toLowerCase() || ""
      if (mail !== SUPERMAIL) {
        await signOut(auth)
        return show("Access blocked", `Only ${SUPERMAIL} can access HOD portal.`)
      }
      await upsertHod(mail)
      router.replace("/hod")
    } catch (err: any) {
      show("Google sign-in failed", err?.message ?? String(err))
      try {
        await signOut(auth)
      } catch {}
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView behavior={RNPlatform.OS === "ios" ? "padding" : undefined} style={s.page}>
        <Animated.View
          style={[
            s.wrap,
            s.card,
            {
              opacity: cardAnim,
              transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            },
          ]}
        >
          <Animated.Text
            style={[
              s.title,
              {
                opacity: titleAnim,
                transform: [{ translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
              },
            ]}
            accessibilityRole="header"
          >
            HOD Login
          </Animated.Text>

          <View style={s.titleUnderlineWrap} accessibilityElementsHidden importantForAccessibility="no">
            <Animated.View
              style={[
                s.titleUnderline,
                { width: underlineAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "64%"] }) },
              ]}
            />
          </View>

          <TextInput
            placeholder={`Email (must be ${SUPERMAIL})`}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocusedEmail(true)}
            onBlur={() => setFocusedEmail(false)}
            style={[s.input, focusedEmail && s.inputFocused]}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor="#E5E7EB"
          />
          <TextInput
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocusedPassword(true)}
            onBlur={() => setFocusedPassword(false)}
            style={[s.input, focusedPassword && s.inputFocused]}
            secureTextEntry
            placeholderTextColor="#E5E7EB"
          />

          <Pressable
            onPress={handleLogin}
            onPressIn={() => pressIn(loginScale)}
            onPressOut={() => pressOut(loginScale)}
            disabled={busy}
            accessibilityLabel="Login to HOD portal"
            accessibilityHint="Authenticates with email and password"
            style={({ pressed }) => [s.pressableBase, pressed && s.pressed]}
          >
            <Animated.View style={[s.primaryBtn, { transform: [{ scale: loginScale }] }, busy && { opacity: 0.8 }]}>
              <Text style={s.primaryTxt}>{busy ? "Working" : "Login"}</Text>
              {busy && <LoadingDots color="#ffffff" />}
            </Animated.View>
          </Pressable>



          <Pressable
            onPress={() => show("Create account", "Ask the admin to enable sign-ups.")}
            accessibilityRole="link"
            accessibilityLabel="Create an account"
          >
            <Text style={s.subTxt}>New here? Create an account</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* 👇 sits on top, web-only; safe to keep here */}
    </>
  )
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F6F8FC",
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  wrap: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    alignItems: "stretch",
  },
  card: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 8,
  },
  titleUnderlineWrap: { alignItems: "center", marginBottom: 12 },
  titleUnderline: {
    height: 3,
    backgroundColor: "#000080",
    borderRadius: 2,
  },
  input: {
    height: 52,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
    backgroundColor: "#ffffff",
    color: "#0f172a",
  },
  inputFocused: {
    borderColor: "#000080",
    shadowColor: "#000080",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  pressableBase: {
    borderRadius: 14,
  },
  pressed: {
    opacity: 0.96,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#000080",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    flexDirection: "row",
  },
  primaryTxt: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  ghostBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 2,
    borderColor: "#E5E7EB",
  },
  ghostTxt: { color: "#0f172a", fontSize: 15, fontWeight: "700" },
  subTxt: { color: "#0f172a", opacity: 0.8, fontSize: 13, textAlign: "center", marginTop: 12 },
})

// Function for LoadingDots component
function LoadingDots({ color = "#ffffff" }: { color?: string }) {
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const createAnim = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 280,
            delay,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.quad),
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 280,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.quad),
          }),
          Animated.delay(120),
        ]),
      )
    const a1 = createAnim(dot1, 0)
    const a2 = createAnim(dot2, 120)
    const a3 = createAnim(dot3, 240)
    a1.start()
    a2.start()
    a3.start()
    return () => {
      a1.stop()
      a2.stop()
      a3.stop()
    }
  }, [])

  const Dot = ({ anim }: { anim: Animated.Value }) => (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        marginHorizontal: 3,
        backgroundColor: color,
        opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
      }}
    />
  )

  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 8 }}>
      <Dot anim={dot1} />
      <Dot anim={dot2} />
      <Dot anim={dot3} />
    </View>
  )
}
