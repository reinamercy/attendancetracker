// app/admin/register.tsx
import { useRouter } from "expo-router";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  // 🔧 CHANGED: added for robust Google redirect flow
  getRedirectResult,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../../firebase";

const show = (title: string, msg?: string, after?: () => void) => {
  if (Platform.OS === 'web') {
    (window as any)?.alert?.(msg ? `${title}\n\n${msg}` : title);
    if (after) after();
  } else {
    Alert.alert(title, msg, after ? [{ text: 'OK', onPress: after }] : undefined);
  }
};

// ✅ Only allow @citchennai.net (case-insensitive; subdomains allowed)
const ALLOWED = /^[^@]+@(?:.*\.)?citchennai\.net$/i;

export default function Register() {
  const r = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);

  // 🔧 CHANGED: handle Google redirect result (prod-safe; resumes linking after redirect)
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    (async () => {
      try {
        const res = await getRedirectResult(auth);
        if (!res) return;

        const e = (sessionStorage.getItem("reg_email") || "").toLowerCase();
        const p = sessionStorage.getItem("reg_pass") || "";
        const n = sessionStorage.getItem("reg_name") || "";

        // cleanup
        sessionStorage.removeItem("reg_email");
        sessionStorage.removeItem("reg_pass");
        sessionStorage.removeItem("reg_name");

        const signedEmail = (res.user.email || "").toLowerCase();
        if (!e || !p || signedEmail !== e) {
          await signOut(auth);
          show("Wrong Google account", `Please sign in as ${e} and try again.`);
          return;
        }

        const cred = EmailAuthProvider.credential(e, p);
        await linkWithCredential(res.user, cred);

        await Promise.all([
          setDoc(
            doc(db, "users", res.user.uid),
            { uid: res.user.uid, name: n, email: e, role: "admin", createdAt: serverTimestamp() },
            { merge: true }
          ),
          setDoc(
            doc(db, "allowedUsers", e),
            { email: e, createdAt: serverTimestamp() },
            { merge: true }
          ),
        ]);

        await signOut(auth);
        show("Account linked", "You can now login with email & password too.", () => r.replace("/admin/login"));
      } catch (err: any) {
        show("Google link failed", err?.message || String(err));
      }
    })();
  }, []);

  const onRegister = async () => {
    const e = email.trim().toLowerCase();
    const n = name.trim();
    const p = pass.trim();

    if (!n) { show('Missing', 'Enter your full name'); return; }
    if (!e || !e.includes('@')) { show('Invalid email', 'Enter a valid email'); return; }
    if (p.length < 6) { show('Weak password', 'Use at least 6 characters'); return; }
    if (!ALLOWED.test(e)) { show('Use your @citchennai.net email'); return; }

    try {
      setLoading(true);

      const methods = await fetchSignInMethodsForEmail(auth, e);

      // 🔧 CHANGED: Google-only account → try popup, fallback to redirect, then link password
      if (methods.includes('google.com') && !methods.includes('password')) {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({
          hd: "citchennai.net",
          login_hint: e,
          prompt: "select_account",
        });

        try {
          const res = await signInWithPopup(auth, provider);
          const signedEmail = (res.user.email || "").toLowerCase();
          if (signedEmail !== e) {
            await signOut(auth);
            show('Wrong Google account', `Please sign in with Google as ${e} and try again.`);
            return;
          }

          const cred = EmailAuthProvider.credential(e, p);
          await linkWithCredential(res.user, cred);

          await Promise.all([
            setDoc(
              doc(db, "users", res.user.uid),
              { uid: res.user.uid, name: n, email: e, role: "admin", createdAt: serverTimestamp() },
              { merge: true }
            ),
            setDoc(
              doc(db, "allowedUsers", e),
              { email: e, createdAt: serverTimestamp() },
              { merge: true }
            ),
          ]);

          await signOut(auth);
          show('Account linked', 'You can now login with email & password too.', () => r.replace('/admin/login'));
          return;

        } catch (err: any) {
          if (err?.code === "auth/popup-blocked" || err?.code === "auth/popup-closed-by-user") {
            sessionStorage.setItem("reg_email", e);
            sessionStorage.setItem("reg_pass", p);
            sessionStorage.setItem("reg_name", n);
            await signInWithRedirect(auth, provider);
            return;
          }
          throw err;
        }
      }

      if (methods.length > 0) {
        show('Already registered', 'Please log in.', () => r.replace('/admin/login'));
        return;
      }

      const userCred = await createUserWithEmailAndPassword(auth, e, p);
      try { await updateProfile(userCred.user, { displayName: n }); } catch {}

      await Promise.all([
        setDoc(
          doc(db, 'users', userCred.user.uid),
          { uid: userCred.user.uid, name: n, email: e, role: 'admin', createdAt: serverTimestamp() },
          { merge: true }
        ),
        setDoc(
          doc(db, 'allowedUsers', e),
          { email: e, createdAt: serverTimestamp() },
          { merge: true }
        ),
      ]);

      await signOut(auth);
      show('Account created', 'You can log in now.', () => r.replace('/admin/login'));
    } catch (err: any) {
      const msg = err?.message || String(err);
      show('Registration failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Create an account</Text>

        <TextInput
          style={styles.input}
          placeholder="Full name"
          autoCapitalize="words"
          value={name}
          onChangeText={setName}
          placeholderTextColor="#E5E7EB"
        />

        <TextInput
          style={styles.input}
          placeholder="Official email (e.g. name@citchennai.net)"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          placeholderTextColor="#E5E7EB"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={pass}
          onChangeText={setPass}
          placeholderTextColor="#E5E7EB"
        />

        <TouchableOpacity style={styles.btn} disabled={loading} onPress={onRegister}>
          {loading ? <ActivityIndicator /> : <Text style={styles.btnText}>Register</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => r.replace("/admin/login")}>
          <Text style={styles.link}>Already have an account? Login</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
    backgroundColor: '#FFFFFF',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#000080',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#E5E7EB',
    textAlign: 'center',
    marginBottom: 18,
  },
  input: {
    width: '100%',
    height: 54,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#000080',
    color: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  btn: {
    width: '100%',
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  btnText: {
    color: 'rgb(14, 7, 122)',
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    textAlign: 'center',
    color: '#FFFFFF',
    opacity: 1,
    marginTop: 10,
    fontWeight: '700',
  },
});