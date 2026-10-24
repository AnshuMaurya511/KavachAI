import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircle, ShieldCheck, Sparkles, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import VoiceAssistant from "./VoiceAssistant";
import "./assistant-widget.css";

export default function AssistantWidget({ caseContextEnabled = true }: { caseContextEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const assistantPage = location.pathname === "/app/assistant";

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
      );
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  if (assistantPage) return null;

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className="assistant-widget-launcher"
          onClick={() => setOpen(true)}
          aria-label="Open KAVACH AI assistant"
          aria-haspopup="dialog"
        >
          <span className="assistant-widget-launcher-icon"><MessageCircle size={21} /><Sparkles size={12} /></span>
          <span className="assistant-widget-launcher-copy"><b>Need a hand?</b><small>Ask KAVACH AI</small></span>
        </button>
      )}

      {open && (
        <div className="assistant-widget-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section ref={dialogRef} className="assistant-widget-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-widget-title">
            <header className="assistant-widget-header">
              <div className="assistant-widget-brand">
                <span className="assistant-widget-avatar"><Bot size={20} /></span>
                <span><b id="assistant-widget-title">KAVACH AI Assistant</b><small><ShieldCheck size={12} /> Private guidance · not live AI</small></span>
              </div>
              <button ref={closeButtonRef} type="button" className="assistant-widget-close" onClick={() => setOpen(false)} aria-label="Close assistant">
                <X size={19} />
              </button>
            </header>
            <div className="assistant-widget-content">
              <VoiceAssistant compact caseContextEnabled={caseContextEnabled} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
