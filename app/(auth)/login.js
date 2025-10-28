/* app/(auth)/login.js */
import { onboardingHref } from "../../lib/nav";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Eye, EyeOff } from "lucide-react-native";
import { supabase } from "../../lib/supabase";

/* --- Brand tokens --- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const SUBTLE = "#6b7280";
const SURFACE = "#f6f7f9";
const BORDER = "#e6e9ee";
const OK = "#16a34a";
const DANGER = "#b3261e";

const STORAGE_KEYS = {
  rememberMe: "tmq.rememberMe",
  rememberedEmail: "tmq.rememberedEmail",
};

export default function Login() {
  const router = useRouter();
  const pwRef = useRef(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Inline message (no popups)
  const [inlineMsg, setInlineMsg] = useState("");
  const [inlineKind, setInlineKind] = useState("info");
  const [showPwPanel, setShowPwPanel] = useState(false);

  const normEmail = () => email.trim().toLowerCase();

  // ---- Password requirements ----
  const rules = useMemo(() => {
    const pw = password || "";
    return {
      length: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      digit: /\d/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw),
    };
  }, [password]);

  const allRulesOk =
    rules.length && rules.upper && rules.lower && rules.digit && rules.special;

  // Load remembered prefs
  useEffect(() => {
    (async () => {
      try {
        const [rememberFlag, remembered] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.rememberMe),
          AsyncStorage.getItem(STORAGE_KEYS.rememberedEmail),
        ]);
        if (rememberFlag != null) setRememberMe(rememberFlag === "1");
        if (rememberFlag === "1" && remembered) setEmail(remembered);
      } catch {}
    })();
  }, []);

  // Auto-leave login if session exists
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted && session) {
          router.replace(`/(app)/(tabs)/quotes?t=${Date.now()}`);
        }
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  const mapSupabaseError = (err) => {
    const msg = String(err?.message || "").toLowerCase();
    const code = String(err?.code || "").toLowerCase();
    if (code === "invalid_credentials" || msg.includes("invalid login credentials"))
      return "Email or password is incorrect.";
    if (msg.includes("email not confirmed"))
      return "Please confirm your email before signing in.";
    return err?.message || "Something went wrong. Please try again.";
  };

  async function persistRemember(e) {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.rememberMe, rememberMe ? "1" : "0"),
      rememberMe
        ? AsyncStorage.setItem(STORAGE_KEYS.rememberedEmail, e)
        : AsyncStorage.removeItem(STORAGE_KEYS.rememberedEmail),
    ]);
  }

  function validateEmailPw() {
    setInlineMsg("");
    const e = normEmail();
    if (!e || !password.trim()) {
      setInlineKind("error");
      setInlineMsg("Please enter both email and password.");
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setInlineKind("error");
      setInlineMsg("Please enter a valid email address.");
      return false;
    }
    return true;
  }

  // ---- Login ----
  const handleLogin = async () => {
    if (loading) return;
    if (!validateEmailPw()) return;

    try {
      setLoading(true);
      const e = normEmail();
      await persistRemember(e);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });
      if (error) throw error;

      router.replace(`/(app)/(tabs)/quotes?t=${Date.now()}`);
    } catch (e) {
      setShowPwPanel(true);
      setInlineKind("error");
      setInlineMsg(mapSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  // ---- Register ----
  const handleRegister = async () => {
    if (loading) return;
    if (!validateEmailPw()) return;

    if (!allRulesOk) {
      setShowPwPanel(true);
      setInlineKind("error");
      setInlineMsg("Password does not meet requirements.");
      return;
    }

    try {
      setLoading(true);
      const e = normEmail();
      await persistRemember(e);

      const { data, error } = await supabase.auth.signUp({
        email: e,
        password,
        options: {
          emailRedirectTo: "tradematequotes://auth/login",
          data: { plan_tier: "free" },
        },
      });
      if (error) throw error;

      // 🔔 Notify Admins (new registration)
      try {
        await supabase.functions.invoke("notify_admin", {
          body: {
            type: "new_user",
            title: "New user registered",
            message: e + " created an account",
            user_id: data?.user?.id || null,
            meta: { email: e },
          },
        });
      } catch (notifyErr) {
        console.log("notify_admin(new_user) failed:", notifyErr?.message || notifyErr);
      }

      if (data?.session) {
        router.replace({
          pathname: "/(app)/onboarding",
          params: { animation: "none" },
        });
      } else {
        setInlineKind("success");
        setInlineMsg("Account created. Signing you in…");

        const { error: e2 } = await supabase.auth.signInWithPassword({
          email: e,
          password,
        });

        // Optional: second notify if user row wasn’t ready yet
        if (!e2) {
          try {
            const { data: who } = await supabase.auth.getUser();
            await supabase.functions.invoke("notify_admin", {
              body: {
                type: "new_user",
                title: "New user registered",
                message: e + " created an account",
                user_id: who?.user?.id || null,
                meta: { email: e, via: "post-signin" },
              },
            });
          } catch {}
        }

        if (!e2)
          router.replace({
            pathname: "/(app)/onboarding",
            params: { animation: "none" },
          });
      }
    } catch (e) {
      setShowPwPanel(true);
      let nice = e?.message ?? "Please try again.";
      if (e?.message?.includes("User already registered")) {
        nice = "This email is already registered. Try logging in instead.";
      } else if (e?.message?.includes("Invalid email")) {
        nice = "Please enter a valid email address.";
      }
      setInlineKind("error");
      setInlineMsg(nice);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPw = async () => {
    if (loading) return;
    const e = normEmail();
    if (!e) {
      setInlineKind("error");
      setInlineMsg("Enter your email above to receive a reset link.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setInlineKind("error");
      setInlineMsg("Please enter a valid email address.");
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: "tradematequotes://reset",
      });
      if (error) throw error;
      setInlineKind("success");
      setInlineMsg("Password reset link sent. Check your email.");
    } catch (e) {
      setInlineKind("error");
      setInlineMsg(mapSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  const onSubmitEmail = () => pwRef.current?.focus?.();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.card}>
        <Image
          source={require("../../assets/images/trademate-login-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>TradeMate</Text>
        <Text style={styles.subtitle}>Sign in or register to get started</Text>

        {!!inlineMsg && (
          <View
            style={[
              styles.inlineBox,
              inlineKind === "error" && styles.inlineBoxError,
              inlineKind === "success" && styles.inlineBoxSuccess,
            ]}
          >
            <Text
              style={[
                styles.inlineText,
                inlineKind === "error" && { color: DANGER },
                inlineKind === "success" && { color: OK },
              ]}
            >
              {inlineMsg}
            </Text>
          </View>
        )}

        {showPwPanel && (
          <View
            style={[
              styles.rulesBox,
              allRulesOk ? styles.rulesOk : styles.rulesWarn,
            ]}
          >
            <Text
              style={[
                styles.rulesTitle,
                { color: allRulesOk ? OK : DANGER },
              ]}
            >
              Password requirements
            </Text>
            <Rule ok={rules.length} label="At least 8 characters" />
            <Rule ok={rules.upper && rules.lower} label="Uppercase & lowercase" />
            <Rule ok={rules.digit} label="A number" />
            <Rule ok={rules.special} label="A special character" />
          </View>
        )}

        <View style={styles.inputWrap}>
          <TextInput
            placeholder="Email"
            placeholderTextColor={SUBTLE}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (inlineMsg) setInlineMsg("");
            }}
            style={styles.input}
            returnKeyType="next"
            onSubmitEditing={onSubmitEmail}
            editable={!loading}
          />
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            ref={pwRef}
            placeholder="Password"
            placeholderTextColor={SUBTLE}
            secureTextEntry={!showPw}
            autoComplete="password"
            textContentType="password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (inlineMsg) setInlineMsg("");
            }}
            style={[styles.input, styles.inputHasIcon]}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            editable={!loading}
          />
          <TouchableOpacity
            onPress={() => !loading && setShowPw((s) => !s)}
            style={styles.eyeBtn}
            disabled={loading}
          >
            {showPw ? (
              <Eye color="#9aa0a6" size={20} />
            ) : (
              <EyeOff color="#9aa0a6" size={20} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.checksRowSingle}>
          <TouchableOpacity
            onPress={() => setRememberMe((v) => !v)}
            style={styles.checkItem}
            disabled={loading}
          >
            <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
              {rememberMe ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>Remember me</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ marginLeft: "auto" }}
            onPress={handleForgotPw}
            disabled={loading}
          >
            <Text style={styles.linkText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>Login</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.registerBtn}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.registerBtnText}>Register</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ---- Small rule row ---- */
function Rule({ ok, label }) {
  return (
    <View style={ruleStyles.row}>
      <Text style={[ruleStyles.dot, { color: ok ? OK : DANGER }]}>
        {ok ? "✓" : "•"}
      </Text>
      <Text style={[ruleStyles.text, { color: ok ? OK : DANGER }]}>
        {label}
      </Text>
    </View>
  );
}

const ruleStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  dot: { width: 18, textAlign: "center", fontSize: 16, marginRight: 4 },
  text: { fontSize: 14 },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  logo: { width: 156, height: 156, marginBottom: 14 },
  title: {
    color: TEXT,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    color: SUBTLE,
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  inlineBox: {
    width: "100%",
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
  },
  inlineBoxError: { backgroundColor: "#fdecec", borderColor: "#f7c8c8" },
  inlineBoxSuccess: { backgroundColor: "#ecfdf5", borderColor: "#bbf7d0" },
  inlineText: { fontSize: 14, color: TEXT },
  rulesBox: {
    width: "100%",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  rulesWarn: { backgroundColor: "#fff1f2", borderColor: "#fecdd3" },
  rulesOk: { backgroundColor: "#ecfdf5", borderColor: "#bbf7d0" },
  rulesTitle: { fontWeight: "800", marginBottom: 6, fontSize: 14 },
  inputWrap: { width: "100%", marginBottom: 12, position: "relative" },
  input: {
    width: "100%",
    backgroundColor: SURFACE,
    color: TEXT,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 16,
  },
  inputHasIcon: { paddingRight: 46 },
  eyeBtn: {
    position: "absolute",
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  checksRowSingle: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    marginBottom: 10,
  },
  checkItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { borderColor: BRAND, backgroundColor: "#e9f2ff" },
  tick: { color: BRAND, fontWeight: "800", fontSize: 14, lineHeight: 14 },
  checkLabel: { color: SUBTLE, fontSize: 13 },
  linkText: { color: BRAND, fontWeight: "700" },
  row: { width: "100%", flexDirection: "row", gap: 12, marginTop: 10 },
  primaryBtn: {
    flex: 1,
    backgroundColor: BRAND,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  registerBtn: {
    flex: 1,
    backgroundColor: "#facc15",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  registerBtnText: { color: "#1b1b1b", fontWeight: "800", fontSize: 16 },
});