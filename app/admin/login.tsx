// app/admin/login.tsx
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import React, { useState } from 'react'
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { auth, db } from '../../firebase'

// -------- Google (Expo AuthSession) for native
import * as Google from 'expo-auth-session/providers/google'
import Constants from 'expo-constants'
import * as WebBrowser from 'expo-web-browser'
WebBrowser.maybeCompleteAuthSession()

// ---------- Fallback IDs (in case extra.google is missing)
const FALLBACK_GOOGLE_IDS = {
  webClientId:
    '488809231478-qta3q53tuoqudoek4cb5rvk828oha17a.apps.googleusercontent.com',
  androidClientId:
    '488809231478-u0mqgfdqrio28in8oi43ouqm9sqju43g.apps.googleusercontent.com',
  iosClientId: '', // add later if you make an iOS client
}

function getGoogleIds() {
  const cfgAny: any =
    (Constants as any)?.expoConfig?.extra?.google ??
    (Constants as any)?.manifest?.extra?.google ??
    {}
  return {
    webClientId: cfgAny.webClientId || FALLBACK_GOOGLE_IDS.webClientId,
    androidClientId: cfgAny.androidClientId || FALLBACK_GOOGLE_IDS.androidClientId,
    iosClientId: cfgAny.iosClientId || FALLBACK_GOOGLE_IDS.iosClientId,
  }
}

const show = (title: string, msg?: string) => {
  if (Platform.OS === 'web') {
    ;(window as any)?.alert?.(msg ? `${title}\n\n${msg}` : title)
  } else {
    Alert.alert(title, msg)
  }
}

// ✅ Only allow @citchennai.net (case-insensitive; subdomains allowed)
const ALLOWED = /^[^@]+@(?:.*\.)?citchennai\.net$/i

export default function AdminLogin() {
  const router = useRouter()
  const { next } = useLocalSearchParams<{ next?: string }>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  // ---- UI anim state
  const fade = React.useRef(new Animated.Value(0)).current
  const slide = React.useRef(new Animated.Value(18)).current
  const underline = React.useRef(new Animated.Value(0)).current
  const [focused, setFocused] = React.useState<'email' | 'password' | null>(null)

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(underline, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }, [])

  // ---- Google AuthSession (native)
  const ids = getGoogleIds()
  const PROXY_PATH = '@anonymous/attendence_hod' // works without Expo account login
  const redirectUri = `https://auth.expo.dev/${PROXY_PATH}`

  const [request, /*response*/, promptAsync] = Google.useAuthRequest({
    clientId: ids.webClientId,
    androidClientId: ids.androidClientId,
    iosClientId: ids.iosClientId || undefined,
    webClientId: ids.webClientId,
    responseType: 'id_token',
    scopes: ['openid', 'profile', 'email'],
    redirectUri,
    prompt: 'select_account consent',
    extraParams: { prompt: 'select_account consent' },
  } as any)

  const finishLogin = async (e: string) => {
    try {
      if (auth.currentUser?.uid) {
        await Promise.all([
          setDoc(
            doc(db, 'admins', auth.currentUser.uid),
            { email: e, uid: auth.currentUser.uid, createdAt: serverTimestamp() },
            { merge: true },
          ),
          setDoc(
            doc(db, 'users', auth.currentUser.uid),
            { uid: auth.currentUser.uid, email: e, role: 'admin', createdAt: serverTimestamp() },
            { merge: true },
          ),
          setDoc(
            doc(db, 'allowedUsers', e), // e is already lowercased
            { email: e, createdAt: serverTimestamp() },
            { merge: true }
          ),
        ])
      }
    } catch {}
    if (typeof next === 'string' && next) {
      router.replace({ pathname: next as any })
    } else {
      router.replace({ pathname: '/admin/dashboard', params: { mentor: e } })
    }
  }

  // 🔧 CHANGED: force lowercase when reading allowlist
  const checkWhitelist = async (e: string) => {
    const snap = await getDoc(doc(db, 'allowedUsers', e.toLowerCase()))
    return snap.exists()
  }

  // Handle Google redirect result on web (fixes flicker → stay)
  // 🔧 UPDATED: handle post-redirect + optional password linking
React.useEffect(() => {
  if (Platform.OS !== 'web') return
  ;(async () => {
    try {
      const res = await getRedirectResult(auth)
      if (!res) return

      const e = (res.user.email ?? '').toLowerCase()
      if (!ALLOWED.test(e)) {
        await signOut(auth)
        show('Access blocked', 'Only emails ending with @citchennai.net are allowed.')
        return
      }

      // If we stored a password before redirect, link it now (Google-only → add password)
      const storedEmail = sessionStorage.getItem('login_email') || ''
      const storedPw = sessionStorage.getItem('login_pw') || ''
      sessionStorage.removeItem('login_email')
      sessionStorage.removeItem('login_pw')

      if (storedEmail && storedPw && storedEmail === e) {
        const methods = await fetchSignInMethodsForEmail(auth, e)
        if (!methods.includes('password')) {
          try {
            const cred = EmailAuthProvider.credential(e, storedPw)
            await linkWithCredential(res.user, cred)
            show('Password linked', 'You can also login with email & password now.')
          } catch (err: any) {
            // If it was already linked in the meantime, ignore
          }
        }
      }

      await finishLogin(e)
    } catch (err: any) {
      show('Google sign-in failed', err?.message || String(err))
    }
  })()
}, [])


  const handleLogin = async () => {
    const e = email.trim().toLowerCase()
    const p = password.trim()

    if (!e || !p) { show('Missing', 'Enter email & password'); return }
    if (!ALLOWED.test(e)) { show('Access blocked', 'Only emails ending with @citchennai.net are allowed.'); return }
    if (p.length < 6) { show('Password too short', 'Use at least 6 characters.'); return }

    try {
      setBusy(true)
      await signInWithEmailAndPassword(auth, e, p)

      const ok = await checkWhitelist(e)
      if (!ok) {
        await signOut(auth)
        show('Access denied', 'This email is not registered. Please register first.')
        return
      }
      return finishLogin(e)
    } catch (err: any) {
      const code = err?.code || ''

      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found') {
        const methods = await fetchSignInMethodsForEmail(auth, e)
        if (methods.includes('google.com') && !methods.includes('password')) {
          show('Use "Continue with Google"', 'This account was created with Google. Use the Google button, or go to Register to link a password.')
          return
        }
        if (code === 'auth/user-not-found') { show('Oops! User not found. Register to begin'); return }
        show('Wrong password', 'Check your password and try again.')
        return
      }

      if (code === 'auth/wrong-password') { show('Wrong password', 'Check your password and try again.'); return }
      if (code === 'auth/too-many-requests') { show('Too many attempts', 'Please wait a minute and try again.'); return }

      show('Login failed', err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleGoogle = async () => {
    try {
      if (Platform.OS === 'web') {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account consent', hd: 'citchennai.net' })

  try {
    const cred = await signInWithPopup(auth, provider)
    const e = (cred.user.email ?? '').toLowerCase()
    if (!ALLOWED.test(e)) {
      await signOut(auth)
      show('Access blocked', 'Only emails ending with @citchennai.net are allowed.')
      return
    }

    // 🔧 NEW: if account is Google-only and user typed a valid password, link it
    const eTrim = e
    const pTrim = (password || '').trim()
    if (pTrim.length >= 6) {
      const methods = await fetchSignInMethodsForEmail(auth, eTrim)
      if (!methods.includes('password')) {
        try {
          const pwCred = EmailAuthProvider.credential(eTrim, pTrim)
          await linkWithCredential(auth.currentUser!, pwCred)
          show('Password linked', 'You can also login with email & password now.')
        } catch (err: any) {
          // ignore if already linked or canceled
        }
      }
    } else {
      // If no password typed and password not linked, give a hint
      
    }

    return finishLogin(e)
  } catch (err: any) {
    if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/popup-closed-by-user') {
      // 🔧 NEW: store intent so the post-redirect handler can link the password
      const eTrim = (email || '').trim().toLowerCase()
      const pTrim = (password || '').trim()
      if (eTrim && pTrim.length >= 6) {
        sessionStorage.setItem('login_email', eTrim)
        sessionStorage.setItem('login_pw', pTrim)
      }
      await signInWithRedirect(auth, provider)
      return
    }
    throw err
  }
}


      // ---- Native (Android/iOS) via AuthSession proxy
      const res = await (promptAsync as any)({
        useProxy: true,
        projectNameForProxy: PROXY_PATH,
        preferEphemeralSession: true,
      })
      if (res.type !== 'success') return

      const idToken =
        (res as any).params?.id_token ??
        (res as any).authentication?.idToken
      const accessToken = (res as any).authentication?.accessToken
      if (!idToken && !accessToken) throw new Error('No token from Google')

      const firebaseCred = GoogleAuthProvider.credential(
        idToken || undefined,
        accessToken || undefined
      )
      await signInWithCredential(auth, firebaseCred)

      const e = (auth.currentUser?.email ?? '').toLowerCase()
      if (!ALLOWED.test(e)) {
        await signOut(auth)
        Alert.alert('Access blocked', 'Only emails ending with @citchennai.net are allowed.')
        return
      }
      return finishLogin(e)
    } catch (err: any) {
      Alert.alert('Google sign-in failed', err?.message || String(err))
    }
  }

  const LoadingDots = ({ color = '#FFFFFF' }: { color?: string }) => {
    const d1 = React.useRef(new Animated.Value(0)).current
    const d2 = React.useRef(new Animated.Value(0)).current
    const d3 = React.useRef(new Animated.Value(0)).current

    React.useEffect(() => {
      const makeLoop = (v: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 400, easing: Easing.linear, useNativeDriver: true, delay }),
            Animated.timing(v, { toValue: 0, duration: 400, easing: Easing.linear, useNativeDriver: true }),
          ]),
        ).start()

      makeLoop(d1, 0); makeLoop(d2, 130); makeLoop(d3, 260)
    }, [])

    const dotStyle = (v: Animated.Value) => ({
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }],
    })

    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Animated.View style={[s.dot, dotStyle(d1), { backgroundColor: color }]} />
        <Animated.View style={[s.dot, dotStyle(d2), { backgroundColor: color }]} />
        <Animated.View style={[s.dot, dotStyle(d3), { backgroundColor: color }]} />
      </View>
    )
  }

  const ScaleButton = ({
    children,
    onPress,
    disabled,
    style,
    accessibilityLabel,
  }: {
    children: React.ReactNode
    onPress?: () => void
    disabled?: boolean
    style?: any
    accessibilityLabel?: string
  }) => {
    const scale = React.useRef(new Animated.Value(1)).current
    const onIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, friction: 6, tension: 120 })
    const onOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 })

    return (
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => onIn().start()}
        onPressOut={() => onOut().start()}
        android_ripple={{ color: 'rgba(14,7,122,0.12)' }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [{ opacity: disabled ? 0.6 : pressed ? 0.96 : 1 }, style]}
      >
        <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
      </Pressable>
    )
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.View style={[s.card, { opacity: fade, transform: [{ translateY: slide }] }]}>
        <Text style={s.title}>Admin / Mentor Login</Text>
        <Animated.View
          style={[
            s.underline,
            {
              transform: [{ scaleX: underline }],
            },
          ]}
        />

        <TextInput
          placeholder="Email (e.g. name@citchennai.net)"
          value={email}
          onChangeText={setEmail}
          style={[s.input, focused === 'email' && s.inputFocused]}
          keyboardType="email-address"
          autoCapitalize="none"
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          accessibilityLabel="Email"
          placeholderTextColor="#6b7280"
        />
        <TextInput
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          style={[s.input, focused === 'password' && s.inputFocused]}
          secureTextEntry
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          accessibilityLabel="Password"
          placeholderTextColor="#6b7280"
        />

        <ScaleButton onPress={handleLogin} disabled={busy} style={s.button} accessibilityLabel="Login">
          <View style={s.buttonInner}>
            <Text style={s.buttonText}>{busy ? 'Working' : 'Login'}</Text>
            {busy && <LoadingDots />}
          </View>
        </ScaleButton>

        <ScaleButton
          onPress={handleGoogle}
          disabled={busy || !request}
          style={[s.ghostBtn, { marginTop: 12 }]}
          accessibilityLabel="Continue with Google"
        >
          <Text style={s.ghostTxt}>Continue with Google</Text>
        </ScaleButton>

        <Pressable
          onPress={() => router.replace('/admin/register')}
          accessibilityRole="link"
          accessibilityLabel="Create a new account"
          style={s.linkBtn}
        >
          <Text style={s.linkTxt}>New here? Create an account</Text>
        </Pressable>
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderRadius: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  underline: {
    height: 3,
    width: '28%',
    backgroundColor: 'rgb(14, 7, 122)',
    borderRadius: 3,
    marginTop: 4,
    marginBottom: 18,
    transform: [{ scaleX: 0 }],
    transformOrigin: 'left',
  },
  input: {
    width: '100%',
    maxWidth: 520,
    height: 54,
    borderWidth: 2,
    borderColor: 'rgb(14, 7, 122)',
    backgroundColor: '#FFFFFF',
    color: '#0f172a',
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  inputFocused: {
    borderColor: 'rgb(14, 7, 122)',
    shadowColor: 'rgb(14, 7, 122)',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  button: {
    width: '100%',
    maxWidth: 520,
    height: 54,
    borderRadius: 14,
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 14,
    backgroundColor: 'rgb(14, 7, 122)',
  },
  buttonInner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ghostBtn: {
    width: '100%',
    maxWidth: 520,
    height: 54,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  ghostTxt: {
    textAlign: 'center',
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
    backgroundColor: '#F6F8FC',
  },
  linkBtn: { paddingVertical: 10, marginTop: 20, alignItems: 'center' },
  linkTxt: { textAlign: 'center', color: '#0f172a', opacity: 0.8 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'left',
  },
})