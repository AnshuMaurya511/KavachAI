import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, Volume2, VolumeX, X } from "lucide-react";
import { api } from "../../lib/api";

const categories = ["UPI/payment fraud", "Bank fraud", "Online scam", "Identity theft", "Other"];

type AlertResponse = {
  alert: {
    id: string;
    reference: string;
    category: string;
    incidentAt: string;
    amount: number | null;
    description: string;
    status: string;
    createdAt: string;
  };
};

async function playSuccessTone() {
  if (typeof window.AudioContext === "undefined") throw new Error("Audio is not supported in this browser.");
  const context = new window.AudioContext();
  try {
    await context.resume();
    if (context.state !== "running") throw new Error("Browser audio is currently unavailable.");
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.value = 784;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
    await new Promise<void>(resolve => window.setTimeout(resolve, 350));
  } finally {
    await context.close();
  }
}

export function CitizenSosButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "confirm" | "success">("form");
  const [category, setCategory] = useState(categories[0]);
  const [incidentAt, setIncidentAt] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("recoverx-sos-confirmation-muted") === "true"; } catch { return false; }
  });
  const submissionKey = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      dialogRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function dismiss() {
    if (sending) return;
    setOpen(false);
    setError("");
    setNotice("");
  }

  function reviewAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const time = new Date(incidentAt);
    if (!incidentAt || !Number.isFinite(time.getTime()) || time.getTime() > Date.now()) {
      setError("Enter an approximate incident date and time that is not in the future.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Please describe what happened in at least 10 characters.");
      return;
    }
    if (!/^\+?[0-9 ()-]{8,20}$/.test(contactPhone.trim())) {
      setError("Enter a valid contact phone number.");
      return;
    }
    if (amount && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) {
      setError("Enter a valid amount, or leave it blank.");
      return;
    }
    submissionKey.current = null;
    setError("");
    setStep("confirm");
  }

  async function submitAlert() {
    if (sending) return;
    const time = new Date(incidentAt);
    if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now()) {
      setError("Incident date and time must be valid and cannot be in the future.");
      setStep("form");
      return;
    }
    setSending(true);
    setError("");
    setNotice("");
    submissionKey.current ??= crypto.randomUUID();
    try {
      const result = await api<AlertResponse>("/sos/alerts", {
        method: "POST",
        headers: { "Idempotency-Key": submissionKey.current },
        body: JSON.stringify({
          category,
          incidentAt: time.toISOString(),
          ...(amount ? { amount: Number(amount) } : {}),
          description: description.trim(),
          contactPhone: contactPhone.trim()
        })
      });
      setReference(result.alert.reference);
      setStep("success");
      submissionKey.current = null;
      if (!muted) {
        try {
          await playSuccessTone();
        } catch {
          setNotice("Your alert was submitted, but this browser could not play the confirmation tone.");
        }
      }
      if (speechEnabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(
          "Your fraud alert has been submitted successfully to the RecoverX administration team."
        ));
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit your alert. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    try { localStorage.setItem("recoverx-sos-confirmation-muted", String(nextMuted)); } catch { /* Preference storage is optional. */ }
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="citizen-sos-fab"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => { setStep("form"); setOpen(true); }}
    >
      <AlertTriangle size={20} aria-hidden="true"/>
      <span>SOS Fraud Alert</span>
    </button>
    {open && <div className="sos-modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) dismiss();
    }}>
      <div
        className="sos-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sos-modal-title"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header className="sos-modal-head">
          <div><span className="eyebrow">RECOVERX FRAUD ALERT</span><h2 id="sos-modal-title">{step === "success" ? "Alert submitted" : "Send an SOS fraud alert"}</h2></div>
          <button type="button" className="icon" onClick={dismiss} disabled={sending} aria-label="Close SOS alert dialog"><X/></button>
        </header>
        {step === "success" ? <div className="sos-success-panel" role="status" aria-live="polite">
          <CheckCircle2 size={42}/>
          <h3>Your alert has been submitted</h3>
          <p>The RecoverX administration team has received it. This does not notify police or a government department.</p>
          <div className="sos-reference-box"><small>Alert reference ID</small><b>{reference}</b></div>
          {notice && <p className="error" role="status">{notice}</p>}
          <div className="sos-confirmation-controls">
            <button className="btn secondary" type="button" onClick={toggleMute} aria-pressed={muted}>
              {muted ? <VolumeX size={16}/> : <Volume2 size={16}/>} {muted ? "Unmute tone" : "Mute tone"}
            </button>
            {"speechSynthesis" in window && <label><input type="checkbox" checked={speechEnabled} onChange={event => {
              const enabled = event.target.checked;
              setSpeechEnabled(enabled);
              if (enabled) window.speechSynthesis.speak(new SpeechSynthesisUtterance("Your fraud alert has been submitted successfully to the RecoverX administration team."));
            }}/> Speak confirmation</label>}
          </div>
          <button type="button" className="btn primary" onClick={dismiss}>Done</button>
        </div> : step === "confirm" ? <div className="sos-confirm-step">
          <p>Check these details before sending your alert to the RecoverX administration team.</p>
          <dl>
            <dt>Category</dt><dd>{category}</dd>
            <dt>Approximate incident time</dt><dd>{new Date(incidentAt).toLocaleString()}</dd>
            {amount && <><dt>Approximate loss</dt><dd>INR {Number(amount).toLocaleString("en-IN")}</dd></>}
            <dt>Contact number</dt><dd>{contactPhone}</dd>
            <dt>Description</dt><dd>{description}</dd>
          </dl>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sos-confirmation-controls">
            <button className="btn secondary" type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>} {muted ? "Unmute confirmation tone" : "Mute confirmation tone"}</button>
            {"speechSynthesis" in window && <label><input type="checkbox" checked={speechEnabled} onChange={event => setSpeechEnabled(event.target.checked)}/> Speak confirmation after submission</label>}
          </div>
          <div className="sos-modal-actions">
            <button type="button" className="btn secondary" onClick={() => { setStep("form"); setError(""); submissionKey.current = null; }} disabled={sending}>Edit details</button>
            <button type="button" className="btn primary" onClick={() => void submitAlert()} disabled={sending}>{sending ? "Submitting…" : "Confirm and send alert"}</button>
          </div>
        </div> : <form className="sos-modal-form" onSubmit={reviewAlert}>
          <p className="sos-modal-explainer">This alert goes to the RecoverX administration team for review. It is not an official police or government report.</p>
          <label>Fraud category<select value={category} onChange={event => setCategory(event.target.value)} required>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Approximate incident date and time<input type="datetime-local" value={incidentAt} max={new Date().toISOString().slice(0, 16)} onChange={event => setIncidentAt(event.target.value)} required/></label>
          <label>Approximate amount lost (optional)<input type="number" min="0" max="1000000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="INR"/></label>
          <label>Short description<textarea value={description} onChange={event => setDescription(event.target.value)} minLength={10} maxLength={1200} rows={3} placeholder="Briefly describe what happened. Never share PINs, passwords, CVV or OTPs." required/></label>
          <label>Contact phone number<input type="tel" value={contactPhone} onChange={event => setContactPhone(event.target.value)} minLength={8} maxLength={20} placeholder="+91" required/></label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sos-confirmation-controls"><button className="btn secondary" type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>} {muted ? "Unmute confirmation tone" : "Mute confirmation tone"}</button></div>
          <button className="btn primary sos-modal-continue" type="submit">Review alert</button>
        </form>}
        {step !== "success" && <p className="sos-modal-privacy">Your account identifies the alert owner. Submit only the information needed for administration to follow up.</p>}
      </div>
    </div>}
  </>;
}
