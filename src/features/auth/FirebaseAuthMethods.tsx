import { useEffect, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { ArrowLeft, Check, LoaderCircle, LockKeyhole, Phone, ShieldCheck } from "lucide-react";
import { api, type ApiUser } from "../../lib/api";
import "./firebase-auth.css";
import {
  clearFirebaseSession,
  createPhoneVerifier,
  firebaseConfigured,
  requestPhoneCode,
  signInWithGoogle
} from "../../lib/firebase";

type Screen = "providers" | "phone";

function friendlyError(error: unknown) {
  if (error instanceof FirebaseError) {
    const errors: Record<string, string> = {
      "auth/popup-closed-by-user": "The Google sign-in window was closed before completing.",
      "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and try again.",
      "auth/unauthorized-domain": "This website domain is not allowed in your Firebase Authentication settings.",
      "auth/invalid-phone-number": "Enter a valid mobile number in international format, for example +919876543210.",
      "auth/invalid-verification-code": "That verification code is incorrect. Check the SMS and try again.",
      "auth/code-expired": "That verification code has expired. Request a new code.",
      "auth/too-many-requests": "Too many attempts. Wait a while before trying again.",
      "auth/captcha-check-failed": "The security check failed. Refresh the page and try again.",
      "auth/network-request-failed": "A network error interrupted sign-in. Check your connection and retry.",
      "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Authentication.",
      "auth/invalid-credential": "The sign-in credential could not be verified. Try again."
    };
    return errors[error.code] || "Firebase sign-in could not be completed. Check your Firebase Authentication setup and try again.";
  }
  return error instanceof Error ? error.message : "Sign-in could not be completed. Please try again.";
}

export default function FirebaseAuthMethods({
  register,
  onAuthenticated
}: {
  register: boolean;
  onAuthenticated: (user: ApiUser) => void;
}) {
  const [screen, setScreen] = useState<Screen>("providers");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const captchaContainerRef = useRef<HTMLDivElement>(null);
  const verifierRef = useRef<ReturnType<typeof createPhoneVerifier> | null>(null);
  const confirmationRef = useRef<Awaited<ReturnType<typeof requestPhoneCode>> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      verifierRef.current?.clear();
      verifierRef.current = null;
      void clearFirebaseSession();
    };
  }, []);

  const finishSignIn = async (idToken: string, displayName?: string) => {
    const result = await api<{ user: ApiUser }>("/auth/firebase", {
      method: "POST",
      body: JSON.stringify({ idToken, name: displayName?.trim() || undefined })
    });
    if (!mountedRef.current) return;
    onAuthenticated(result.user);
    void clearFirebaseSession();
  };

  const handleGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      const credential = await signInWithGoogle();
      await finishSignIn(await credential.user.getIdToken());
    } catch (authError) {
      if (mountedRef.current) setError(friendlyError(authError));
      void clearFirebaseSession();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleSendCode = async () => {
    const normalizedPhone = phone.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setError("Enter the full mobile number with country code, for example +919876543210.");
      return;
    }
    if (name.trim().length < 2) {
      setError("Enter your name to create or access your mobile account.");
      return;
    }
    if (!captchaContainerRef.current) {
      setError("The security check could not load. Refresh the page and try again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      verifierRef.current?.clear();
      verifierRef.current = createPhoneVerifier(captchaContainerRef.current);
      confirmationRef.current = await requestPhoneCode(normalizedPhone, verifierRef.current);
      if (mountedRef.current) setCodeSent(true);
    } catch (authError) {
      verifierRef.current?.clear();
      verifierRef.current = null;
      if (mountedRef.current) setError(friendlyError(authError));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!confirmationRef.current) {
      setError("Request a new verification code before continuing.");
      return;
    }
    if (!/^\d{6}$/.test(verificationCode.trim())) {
      setError("Enter the six-digit verification code sent to your phone.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const credential = await confirmationRef.current.confirm(verificationCode.trim());
      await finishSignIn(await credential.user.getIdToken(), name);
    } catch (authError) {
      if (mountedRef.current) setError(friendlyError(authError));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleBack = () => {
    verifierRef.current?.clear();
    verifierRef.current = null;
    confirmationRef.current = null;
    setCodeSent(false);
    setVerificationCode("");
    setError("");
    setScreen("providers");
  };

  if (!firebaseConfigured) {
    return (
      <section className="firebase-auth-setup" aria-label="Google and mobile sign-in setup">
        <div><LockKeyhole size={17} /><span><b>Google & mobile sign-in</b><small>Firebase setup is required. Email and password sign-in are still available.</small></span></div>
      </section>
    );
  }

  return (
    <section className="firebase-auth-methods" aria-label="Other sign-in methods">
      <div className="firebase-auth-divider"><span>or continue securely with</span></div>
      {screen === "providers" ? (
        <div className="firebase-auth-provider-buttons">
          <button type="button" className="firebase-auth-provider google" onClick={handleGoogle} disabled={busy}>
            {busy ? <LoaderCircle className="firebase-auth-spin" size={18} /> : <GoogleMark />}
            <span>Continue with Google</span>
          </button>
          <button type="button" className="firebase-auth-provider phone" onClick={() => { setScreen("phone"); setError(""); }} disabled={busy}>
            <Phone size={17} /><span>Continue with mobile</span>
          </button>
        </div>
      ) : (
        <div className="firebase-auth-phone">
          <button type="button" className="firebase-auth-back" onClick={handleBack} disabled={busy}><ArrowLeft size={15} /> Other sign-in methods</button>
          <label>Full name<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Enter your name" maxLength={80} disabled={busy} /></label>
          <label>Mobile number<input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+919876543210" maxLength={16} disabled={busy || codeSent} /></label>
          {codeSent && <label>SMS verification code<input autoComplete="one-time-code" inputMode="numeric" value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" maxLength={6} disabled={busy} /></label>}
          {error && <p className="firebase-auth-error" role="alert">{error}</p>}
          {!codeSent ? (
            <button type="button" className="firebase-auth-submit" onClick={handleSendCode} disabled={busy}>
              {busy ? <LoaderCircle className="firebase-auth-spin" size={17} /> : <Phone size={17} />} Send verification code
            </button>
          ) : (
            <button type="button" className="firebase-auth-submit" onClick={handleVerifyCode} disabled={busy || verificationCode.length !== 6}>
              {busy ? <LoaderCircle className="firebase-auth-spin" size={17} /> : <Check size={17} />} Verify &amp; continue
            </button>
          )}
          <div ref={captchaContainerRef} />
        </div>
      )}
      {screen === "providers" && error && <p className="firebase-auth-error" role="alert">{error}</p>}
      <p className="firebase-auth-privacy"><ShieldCheck size={14} /> {register ? "Google email or phone OTP must be verified before an account is created." : "Your Google account or phone number is verified securely."}</p>
    </section>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.5H5.8v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.5a12 12 0 0 1 0-7.1v-5.3H5.8a20 20 0 0 0 0 17.7l6.8-5.3Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z"/></svg>;
}
