import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { BellRing, Check, CircleAlert, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { api, API_BASE } from "../../lib/api";

const alertStatuses = ["New", "Acknowledged", "In Progress", "Resolved"] as const;
type AlertStatus = typeof alertStatuses[number];
type SosAlert = {
  id: string;
  reference: string;
  category: string;
  incidentAt: string;
  amount: number | null;
  description: string;
  status: AlertStatus;
  acknowledgedAt: string | null;
  acknowledgedBy: { id: string; name: string } | null;
  contactPhone: string;
  citizen: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
  history: Array<{
    status: string;
    note: string | null;
    createdAt: string;
    updatedBy: { id: string; name: string };
  }>;
};
type IncomingAlert = Pick<SosAlert, "id" | "reference" | "category" | "incidentAt" | "createdAt" | "status">;

async function playBuzzer() {
  if (typeof window.AudioContext === "undefined") throw new Error("This browser does not support alert audio.");
  const context = new window.AudioContext();
  try {
    await context.resume();
    if (context.state !== "running") throw new Error("Browser audio is unavailable. Enable sound using the button.");
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.setValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015);
    gain.gain.setValueAtTime(0.11, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
    await new Promise<void>(resolve => window.setTimeout(resolve, 380));
  } finally {
    await context.close();
  }
}

const formatTimestamp = (value: string) => new Date(value).toLocaleString("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata"
});

export function SosAdminPage() {
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newAlert, setNewAlert] = useState<IncomingAlert | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("recoverx-sos-admin-muted") === "true"; } catch { return false; }
  });
  const [soundError, setSoundError] = useState("");
  const knownIds = useRef(new Set<string>());
  const soundedIds = useRef(new Set<string>());
  const busyIds = useRef(new Set<string>());
  const soundEnabledRef = useRef(false);
  const mutedRef = useRef(muted);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    mutedRef.current = muted;
  }, [soundEnabled, muted]);

  const loadAlerts = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await api<{ total: number; pending: number; alerts: SosAlert[] }>("/sos/admin/alerts");
      for (const alert of result.alerts) knownIds.current.add(alert.id);
      setAlerts(result.alerts);
      setTotal(result.total);
      setPending(result.pending);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "SOS alerts could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts(true);
    const origin = API_BASE.endsWith("/api") ? API_BASE.slice(0, -4) : undefined;
    const socket = io(origin, {
      path: "/api/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"]
    });
    socket.on("connect", () => {
      setSocketConnected(true);
      void loadAlerts();
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));
    socket.on("sos:new-alert", (alert: IncomingAlert) => {
      if (!alert || typeof alert.id !== "string" || knownIds.current.has(alert.id)) return;
      knownIds.current.add(alert.id);
      setNewAlert(alert);
      setNotice(`New SOS alert received: ${alert.reference}`);
      void loadAlerts();
      if (!soundEnabledRef.current || mutedRef.current || soundedIds.current.has(alert.id)) return;
      soundedIds.current.add(alert.id);
      void playBuzzer().catch(() => {
        setSoundError("The browser blocked the buzzer. Enable sound with a click to hear future alerts.");
      });
    });
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [loadAlerts]);

  async function enableSound() {
    setSoundError("");
    try {
      await playBuzzer();
      setSoundEnabled(true);
    } catch (audioError) {
      setSoundError(audioError instanceof Error ? audioError.message : "Could not enable alert audio.");
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try { localStorage.setItem("recoverx-sos-admin-muted", String(next)); } catch { /* Preference storage is optional. */ }
  }

  async function acknowledge(alertId: string) {
    if (busyIds.current.has(alertId)) return;
    busyIds.current.add(alertId);
    setError("");
    try {
      const result = await api<{ alert: SosAlert }>(`/sos/admin/alerts/${encodeURIComponent(alertId)}/acknowledge`, { method: "POST" });
      setAlerts(current => current.map(alert => alert.id === alertId ? result.alert : alert));
      setPending(current => Math.max(0, current - (alerts.find(alert => alert.id === alertId)?.status === "New" ? 1 : 0)));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not acknowledge this alert.");
    } finally {
      busyIds.current.delete(alertId);
    }
  }

  async function updateStatus(alertId: string, status: AlertStatus) {
    if (busyIds.current.has(alertId)) return;
    busyIds.current.add(alertId);
    setError("");
    try {
      const result = await api<{ alert: SosAlert }>(`/sos/admin/alerts/${encodeURIComponent(alertId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      const previous = alerts.find(alert => alert.id === alertId);
      setAlerts(current => current.map(alert => alert.id === alertId ? result.alert : alert));
      if (previous?.status === "New" && status !== "New") setPending(current => Math.max(0, current - 1));
      if (previous?.status !== "New" && status === "New") setPending(current => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update alert status.");
    } finally {
      busyIds.current.delete(alertId);
    }
  }

  return <div className="stack sos-admin-page">
    <div className="heading">
      <div><span className="eyebrow">AUTHORIZED ADMINISTRATORS</span><h1>SOS Alerts</h1><p>New citizen alerts are stored in RecoverX and delivered to connected staff in real time.</p></div>
      <button className="btn secondary" type="button" onClick={() => void loadAlerts()} disabled={refreshing}><RefreshCw size={16}/>{refreshing ? "Refreshing…" : "Refresh"}</button>
    </div>
    <div className="sos-admin-controls">
      <span className={`sos-connection ${socketConnected ? "connected" : ""}`} role="status"><i/>{socketConnected ? "Live notifications connected" : "Live notifications reconnecting"}</span>
      {!soundEnabled
        ? <button type="button" className="btn secondary" onClick={() => void enableSound()}><Volume2 size={16}/>Enable buzzer</button>
        : <button type="button" className="btn secondary" onClick={toggleMute} aria-pressed={muted}>{muted ? <VolumeX size={16}/> : <Volume2 size={16} />}{muted ? "Unmute buzzer" : "Mute buzzer"}</button>}
      <span className="sos-admin-sound-label">{!soundEnabled ? "Browser audio needs a click to enable." : muted ? "Buzzer is muted." : "Buzzer enabled."}</span>
    </div>
    {soundError && <p className="error" role="status">{soundError}</p>}
    {notice && <div className="sos-live-notice" role="status" aria-live="polite"><BellRing size={18}/><span>{notice}</span><button className="icon" type="button" onClick={() => setNotice("")} aria-label="Dismiss alert notification">×</button></div>}
    {newAlert && <div className="sos-new-alert" role="alert"><CircleAlert size={20}/><div><b>New SOS alert: {newAlert.reference}</b><small>{newAlert.category} · {formatTimestamp(newAlert.createdAt)}</small></div></div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="stats three">
      <div className="stat"><span className="tile red"><BellRing size={20}/></span><div><small>Total alerts</small><b>{total}</b><span>Recent stored alerts</span></div></div>
      <div className="stat"><span className="tile orange"><CircleAlert size={20}/></span><div><small>Pending alerts</small><b>{pending}</b><span>Awaiting acknowledgement</span></div></div>
      <div className="stat"><span className="tile"><Check size={20}/></span><div><small>Connection</small><b>{socketConnected ? "Live" : "Offline"}</b><span>Database remains the source of truth</span></div></div>
    </div>
    <section className="card">
      <div className="card-head"><h2>Citizen fraud alerts</h2><small>Latest {alerts.length} alerts</small></div>
      {loading ? <p className="empty">Loading SOS alerts…</p> : alerts.length === 0 ? <p className="empty">No SOS alerts have been submitted.</p> : <div className="sos-admin-list">
        {alerts.map(alert => <details className={`sos-admin-alert ${alert.status === "New" ? "is-new" : ""}`} key={alert.id}>
          <summary>
            <span className="sos-alert-summary"><b>{alert.reference}</b><small>{alert.category}</small></span>
            <span className="sos-admin-person"><b>{alert.citizen.name}</b><small>{alert.contactPhone}</small></span>
            <span className={`sos-status-chip status-${alert.status.toLowerCase().replace(/\s+/g, "-")}`}>{alert.status}</span>
            <span className="sos-alert-time">{formatTimestamp(alert.incidentAt)}</span>
          </summary>
          <div className="sos-alert-details">
            <dl>
              <dt>Citizen email</dt><dd>{alert.citizen.email}</dd>
              <dt>Amount lost</dt><dd>{alert.amount === null ? "Not provided" : `INR ${alert.amount.toLocaleString("en-IN")}`}</dd>
              <dt>Submitted</dt><dd>{formatTimestamp(alert.createdAt)}</dd>
              <dt>Description</dt><dd>{alert.description}</dd>
              {alert.acknowledgedAt && <><dt>Acknowledged</dt><dd>{formatTimestamp(alert.acknowledgedAt)}{alert.acknowledgedBy ? ` by ${alert.acknowledgedBy.name}` : ""}</dd></>}
            </dl>
            <div className="sos-alert-actions">
              {alert.status === "New" && <button type="button" className="btn primary" disabled={busyIds.current.has(alert.id)} onClick={() => void acknowledge(alert.id)}>Acknowledge alert</button>}
              <label>Status<select value={alert.status} onChange={event => {
                const value = event.target.value;
                if (alertStatuses.includes(value as AlertStatus)) void updateStatus(alert.id, value as AlertStatus);
              }} disabled={busyIds.current.has(alert.id)}>{alertStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
            </div>
            <div className="sos-alert-history"><b>Activity</b>{alert.history.map((item, index) => <p key={`${item.createdAt}-${index}`}><span>{item.status}</span>{item.note ? ` · ${item.note}` : ""}<small>{formatTimestamp(item.createdAt)} · {item.updatedBy.name}</small></p>)}</div>
          </div>
        </details>)}
      </div>}
    </section>
    <p className="sos-admin-disclaimer">Use citizen contact details only for authorized follow-up. RecoverX alerts do not represent a report received by police or a government department.</p>
  </div>;
}
