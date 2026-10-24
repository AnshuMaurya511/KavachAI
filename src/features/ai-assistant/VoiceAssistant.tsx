import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  LoaderCircle,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX
} from "lucide-react";
import { api, type ApiCase } from "../../lib/api";
import "./voice-assistant.css";

type VoiceState = "idle" | "requesting_permission" | "listening" | "processing" | "speaking" | "error";
type Language = "en-IN" | "hi-IN";
type Message = { id: number; role: "assistant" | "user"; text: string };
type CaseContext = ApiCase & {
  evidence?: Array<{ id: string; name: string; createdAt: string }>;
  timeline?: Array<{ id: string; title: string; detail?: string | null; eventAt: string }>;
  tasks?: Array<{ id: string; title: string; status: string; dueDate?: string | null }>;
};

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface RecognitionErrorEvent extends Event {
  error: string;
}
interface BrowserRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => BrowserRecognition;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

const prompts = [
  "Review my current case.",
  "What evidence is missing?",
  "Summarize my transaction timeline.",
  "Help me prepare my complaint information.",
  "What should I do next?",
  "Explain this case in simple Hindi.",
  "Read my pending tasks."
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : date.toLocaleDateString();
}

function buildGuidance(question: string, selectedCase: CaseContext | null, language: Language) {
  const normalized = question.toLowerCase();
  const asksForCase = /case|evidence|timeline|transaction|task|review|current|next/.test(normalized)
    || (/complaint/.test(normalized) && /my|this|current|prepare/.test(normalized));
  const urgent = /just|recent|today|now|lost|sent|stolen|unauthori[sz]ed|ongoing/.test(normalized);
  const reportingQuestion = /report|upi|fraud|complaint/.test(normalized);

  if (language === "hi-IN") {
    if (urgent) {
      return "अगर अभी-अभी साइबर वित्तीय धोखाधड़ी में पैसे गए हैं, तो AI के जवाब का इंतज़ार न करें। तुरंत अपने बैंक के आधिकारिक चैनल से संपर्क करें, 1930 पर कॉल करें और cybercrime.gov.in पर रिपोर्ट करें। यह ऐप आपकी ओर से शिकायत दर्ज नहीं करता।";
    }
    if (asksForCase && !selectedCase) return "अपने केस से जुड़ी जानकारी देखने के लिए पहले ऊपर से कोई केस चुनें। आप सामान्य प्रश्न पूछ सकते हैं; यह सीमित स्थानीय मार्गदर्शन है, लाइव AI सेवा नहीं।";
    if (normalized.includes("evidence") || normalized.includes("document")) {
      const count = selectedCase?.evidence?.length ?? 0;
      return `आपके चुने गए केस में ${count} ${count === 1 ? "फ़ाइल" : "फ़ाइलें"} दर्ज हैं। बैंक स्टेटमेंट, लेन-देन की रसीद या संदर्भ संख्या, संबंधित संदेश और शिकायत की पावती उपयोगी रिकॉर्ड हो सकते हैं। ये सुझाव हैं, हर मामले के लिए अनिवार्य कानूनी सूची नहीं। पासवर्ड, PIN, OTP या सीड फ़्रेज़ साझा न करें।`;
    }
    if (normalized.includes("timeline") || normalized.includes("transaction")) {
      const event = selectedCase?.timeline?.[0];
      return event
        ? `आपके केस टाइमलाइन की सबसे हाल की दर्ज घटना “${event.title}” है (${formatDate(event.eventAt)})${event.detail ? `। विवरण: ${event.detail}` : ""}। केवल अपने रिकॉर्ड से पुष्टि की गई तारीखें और लेन-देन विवरण जोड़ें।`
        : "इस केस के लिए कोई टाइमलाइन घटना दर्ज नहीं है। अपने बैंक रिकॉर्ड और संदेशों से तारीखें व संदर्भ संख्या जाँचकर उन्हें व्यवस्थित करें।";
    }
    if (normalized.includes("task") || normalized.includes("pending")) {
      const tasks = selectedCase?.tasks?.filter(task => task.status !== "Completed") ?? [];
      return tasks.length
        ? `इस केस के लिए ${tasks.length} अधूरे कार्य दर्ज हैं: ${tasks.map(task => task.title).join("; ")}।`
        : "चुने गए केस के लिए कोई अधूरा कार्य दर्ज नहीं मिला।";
    }
    if (reportingQuestion) {
      return "भारत में संदिग्ध साइबर वित्तीय धोखाधड़ी के लिए cybercrime.gov.in पर रिपोर्ट करें या 1930 पर कॉल करें, और अपने बैंक के आधिकारिक चैनल से संपर्क करें। यदि पैसे अभी-अभी गए हैं, तो तुरंत कार्रवाई करें; AI के जवाब का इंतज़ार न करें। यह ऐप आपकी ओर से शिकायत दर्ज नहीं करता।";
    }
    return selectedCase
      ? `आपके केस रिकॉर्ड में “${selectedCase.title}” (${selectedCase.reference}) का प्रकार ${selectedCase.type} और स्थिति “${selectedCase.status}” दर्ज है। यह केवल रिकॉर्ड का सार है, स्वतंत्र जाँच या कानूनी सलाह नहीं।`
      : "आप सामान्य प्रश्न पूछ सकते हैं। केस-विशेष जानकारी के लिए पहले अपना केस चुनें। यह सीमित स्थानीय मार्गदर्शन है, लाइव AI सेवा नहीं।";
  }

  if (urgent) {
    return "If money has just been lost to suspected cyber fraud, do not wait for an AI response. Contact your bank through its official channel, call India’s cyber-fraud helpline at 1930, and report at cybercrime.gov.in promptly. RecoverX has not filed a report or contacted anyone for you.";
  }
  if (asksForCase && !selectedCase) return "Select one of your cases above for case-specific guidance. You can still ask general questions. This is limited local guidance, not a live AI service.";
  if (normalized.includes("evidence") || normalized.includes("document")) {
    const count = selectedCase?.evidence?.length ?? 0;
    return `The selected case has ${count} evidence ${count === 1 ? "file" : "files"} recorded. Bank statements, transaction receipts or reference numbers, relevant messages, and complaint acknowledgements can be useful records. These are suggestions, not universal legal requirements. Never share passwords, PINs, OTPs, or recovery phrases.`;
  }
  if (normalized.includes("timeline") || normalized.includes("transaction")) {
    const events = selectedCase?.timeline?.slice(0, 3) ?? [];
    return events.length
      ? `Recent recorded timeline events: ${events.map(event => `${event.title} (${formatDate(event.eventAt)})`).join("; ")}. Verify dates and transaction details against your own records before relying on them.`
      : "There are no timeline events recorded for this case yet. Use bank records and messages to confirm dates and reference numbers before organizing them.";
  }
  if (normalized.includes("task") || normalized.includes("pending")) {
    const tasks = selectedCase?.tasks?.filter(task => task.status !== "Completed") ?? [];
    return tasks.length
      ? `There ${tasks.length === 1 ? "is" : "are"} ${tasks.length} incomplete task${tasks.length === 1 ? "" : "s"} recorded for this case: ${tasks.map(task => task.title).join("; ")}.`
      : "No incomplete tasks are recorded for the selected case.";
  }
  if (reportingQuestion) {
    return "For suspected cyber-financial fraud in India, report through cybercrime.gov.in or call 1930, and contact your bank through its official channel. If money was just lost, act promptly rather than waiting for an AI response. RecoverX has not filed a report or contacted anyone for you.";
  }
  if (selectedCase) {
    return `Your case record lists “${selectedCase.title}” (${selectedCase.reference}), type ${selectedCase.type}, status “${selectedCase.status}”, and reported amount ${formatMoney(selectedCase.amount)}. This summarizes recorded information only; it is not an independent investigation or legal advice.`;
  }
  return "Keep transaction dates, amounts, reference numbers, bank contacts, and complaint acknowledgements together. Use official bank and government channels. This is limited local guidance, not a live AI service.";
}

const initialMessage: Message = {
  id: 0,
  role: "assistant",
  text: "Hello. I can offer limited general guidance and summarize information already recorded in a case you select. This is not a live AI assessment. What would you like help with?"
};

export default function VoiceAssistant({ compact = false, caseContextEnabled = true }: { compact?: boolean; caseContextEnabled?: boolean }) {
  const [cases, setCases] = useState<ApiCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedCase, setSelectedCase] = useState<CaseContext | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [casesError, setCasesError] = useState("");
  const [language, setLanguage] = useState<Language>("en-IN");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [recognitionAvailable, setRecognitionAvailable] = useState(false);
  const [synthesisAvailable, setSynthesisAvailable] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [draft, setDraft] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const cancelledRecognitionsRef = useRef(new WeakSet<BrowserRecognition>());
  const processingRef = useRef(false);
  const mountedRef = useRef(false);
  const submitRef = useRef<(text: string) => void>(() => {});
  const responseTimerRef = useRef<number | null>(null);
  const nextMessageId = useRef(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    const speechWindow = window as SpeechWindow;
    setRecognitionAvailable(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    setSynthesisAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    let updateVoices: (() => void) | undefined;
    if ("speechSynthesis" in window) {
      updateVoices = () => setVoices(window.speechSynthesis.getVoices());
      updateVoices();
      window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    }

    let live = true;
    if (caseContextEnabled) {
      api<{ cases: ApiCase[] }>("/cases")
        .then(data => { if (live) setCases(data.cases); })
        .catch(error => { if (live) setCasesError(error instanceof Error ? error.message : "Could not load your cases."); });
    }

    return () => {
      live = false;
      mountedRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        if (updateVoices) window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
      }
    };
  }, [caseContextEnabled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, interimTranscript]);

  useEffect(() => {
    if (!caseContextEnabled || !selectedCaseId) {
      setSelectedCase(null);
      setCaseError("");
      setCaseLoading(false);
      return;
    }
    let live = true;
    setSelectedCase(null);
    setCaseLoading(true);
    setCaseError("");
    api<{ case: CaseContext }>(`/cases/${encodeURIComponent(selectedCaseId)}`)
      .then(data => { if (live) setSelectedCase(data.case); })
      .catch(error => { if (live) setCaseError(error instanceof Error ? error.message : "Could not load this case."); })
      .finally(() => { if (live) setCaseLoading(false); });
    return () => { live = false; };
  }, [caseContextEnabled, selectedCaseId]);

  const stopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingMessageId(null);
    setVoiceState(current => current === "speaking" ? "idle" : current);
  }, []);

  const speak = useCallback((text: string, id: number, speechLanguage: Language = language) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguage;
    const voiceLanguage = speechLanguage.slice(0, 2);
    const chosenVoice = voices.find(voice => voice.name === voiceName && voice.lang.toLowerCase().startsWith(voiceLanguage));
    const languageVoice = voices.find(voice => voice.lang.toLowerCase().startsWith(voiceLanguage));
    const voice = chosenVoice || languageVoice;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      if (!mountedRef.current) return;
      setSpeakingMessageId(id);
      setVoiceState("speaking");
    };
    utterance.onend = () => {
      if (!mountedRef.current) return;
      setSpeakingMessageId(null);
      setVoiceState(current => current === "speaking" ? "idle" : current);
    };
    utterance.onerror = event => {
      if (!mountedRef.current) return;
      if (event.error === "canceled" || event.error === "interrupted") return;
      setSpeakingMessageId(null);
      setVoiceState("error");
      setVoiceError("Speech playback stopped. You can still read the written response.");
    };
    window.speechSynthesis.speak(utterance);
  }, [language, voiceName, voices]);

  const submit = useCallback((rawText: string) => {
    const text = rawText.trim();
    if (!text || processingRef.current || voiceState === "processing") return;
    processingRef.current = true;
    if (recognitionRef.current) {
      cancelledRecognitionsRef.current.add(recognitionRef.current);
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    stopSpeaking();
    setVoiceError("");
    setInterimTranscript("");
    setDraft("");
    setVoiceState("processing");
    const userMessage: Message = { id: nextMessageId.current++, role: "user", text };
    setMessages(current => [...current, userMessage]);
    if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      processingRef.current = false;
      const responseLanguage = /hindi|हिंदी/i.test(text) ? "hi-IN" : language;
      const answer = buildGuidance(text, selectedCase, responseLanguage);
      const response: Message = { id: nextMessageId.current++, role: "assistant", text: answer };
      setMessages(current => [...current, response]);
      setVoiceState("idle");
      if (synthesisAvailable) speak(answer, response.id, responseLanguage);
    }, 280);
  }, [language, selectedCase, speak, stopSpeaking, synthesisAvailable, voiceState]);

  submitRef.current = submit;

  const startListening = () => {
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setVoiceState("error");
      setVoiceError("Speech recognition is not supported in this browser. Use the text box below instead.");
      return;
    }
    if (voiceState === "listening" || voiceState === "requesting_permission") {
      recognitionRef.current?.stop();
      return;
    }
    if (voiceState === "processing") return;
    if (recognitionRef.current) {
      cancelledRecognitionsRef.current.add(recognitionRef.current);
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    stopSpeaking();
    setVoiceError("");
    setInterimTranscript("");
    setVoiceState("requesting_permission");
    const recognition = new Constructor();
    let finalTranscript = "";
    let recognitionError = "";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.onstart = () => {
      if (mountedRef.current) setVoiceState("listening");
    };
    recognition.onresult = event => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (mountedRef.current) setInterimTranscript(interim);
    };
    recognition.onerror = event => {
      const messagesByError: Record<string, string> = {
        "not-allowed": "Microphone access was denied. Allow microphone access in your browser or use the text box.",
        "service-not-allowed": "The browser speech service is unavailable. Use the text box instead.",
        "audio-capture": "No microphone was detected. Connect a microphone or use the text box.",
        "no-speech": "No speech was detected. Try again or type your question.",
        network: "The browser speech service encountered a network issue. Try again or type your question."
      };
      recognitionError = messagesByError[event.error] || "Speech recognition stopped unexpectedly. Try again or type your question.";
      if (mountedRef.current) {
        setVoiceError(recognitionError);
        setVoiceState("error");
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (!mountedRef.current) return;
      setInterimTranscript("");
      if (cancelledRecognitionsRef.current.has(recognition)) return;
      const transcript = finalTranscript.trim();
      if (transcript && !recognitionError) submitRef.current(transcript);
      else if (!recognitionError) setVoiceState("idle");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setVoiceState("error");
      setVoiceError("Could not start speech recognition. Check microphone access or use the text box.");
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(draft);
  };

  const startNewConversation = () => {
    stopSpeaking();
    if (recognitionRef.current) cancelledRecognitionsRef.current.add(recognitionRef.current);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    processingRef.current = false;
    if (responseTimerRef.current !== null) window.clearTimeout(responseTimerRef.current);
    setInterimTranscript("");
    setVoiceError("");
    setDraft("");
    setMessages([{ ...initialMessage, id: nextMessageId.current++ }]);
    setVoiceState("idle");
  };

  const statusLabel: Record<VoiceState, string> = {
    idle: "Ready when you are",
    requesting_permission: "Waiting for microphone permission",
    listening: "Listening",
    processing: "Preparing guidance",
    speaking: "Speaking",
    error: "Voice unavailable"
  };
  const statusIcon = voiceState === "listening" ? <AudioLines /> : voiceState === "processing" || voiceState === "requesting_permission" ? <LoaderCircle className="voice-spin" /> : voiceState === "error" ? <AlertTriangle /> : <CheckCircle2 />;

  return (
    <div className="voice-page">
      {!compact && <header className="voice-header">
        <div>
          <span className="eyebrow">KAVACH AI WORKSPACE</span>
          <h1>RecoverX Voice Assistant</h1>
          <p>Speak naturally. Understand your case. Know your next step.</p>
        </div>
        <div className="voice-header-actions">
          <span className="voice-availability"><span /> Guidance mode · no live AI</span>
          <Link to="/app/cases" className="btn secondary"><ArrowRight size={16} /> My cases</Link>
        </div>
      </header>}

      {caseContextEnabled && <div className="voice-case-select">
        <label htmlFor="voice-case">Case context</label>
        <select id="voice-case" value={selectedCaseId} onChange={event => setSelectedCaseId(event.target.value)}>
          <option value="">No case selected</option>
          {cases.map(item => <option value={item.id} key={item.id}>{item.reference} · {item.title}</option>)}
        </select>
        {casesError && <span className="voice-inline-error" role="alert">{casesError}</span>}
      </div>}

      <div className={`voice-layout${compact ? " compact" : ""}`}>
        <main className="voice-main">
          <section className="voice-console" aria-label="Voice controls">
            <div className={`voice-orb ${voiceState}`} aria-hidden="true">
              <span className="voice-orb-inner">{voiceState === "listening" ? <AudioLines size={34} /> : voiceState === "speaking" ? <Volume2 size={34} /> : voiceState === "processing" || voiceState === "requesting_permission" ? <LoaderCircle className="voice-spin" size={34} /> : <Bot size={34} />}</span>
            </div>
            <div className={`voice-state ${voiceState}`} role="status" aria-live="polite">{statusIcon}<span>{statusLabel[voiceState]}</span></div>
            <p className="voice-transcript" aria-live="polite">{interimTranscript ? <><b>Heard so far:</b> {interimTranscript}</> : voiceState === "listening" ? "Speak now. Press the microphone button again when you are done." : "Your microphone is only activated when you press the button."}</p>
            <div className="voice-controls">
              <button className={`voice-mic ${voiceState === "listening" ? "active" : ""}`} onClick={startListening} disabled={voiceState === "processing" || voiceState === "requesting_permission"} aria-label={voiceState === "listening" ? "Stop listening and submit transcript" : "Start voice input"} title={voiceState === "listening" ? "Stop listening" : "Start voice input"}>
                {voiceState === "listening" ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              {voiceState === "speaking" && <button className="voice-action" onClick={stopSpeaking} aria-label="Stop speaking"><VolumeX size={18} /> Stop speaking</button>}
              <button className="voice-action" onClick={startNewConversation} aria-label="Start a new conversation"><RotateCcw size={17} /> New conversation</button>
            </div>
            {voiceError && <p className="voice-error" role="alert"><AlertTriangle size={16} />{voiceError}</p>}
            {!recognitionAvailable && <p className="voice-note">Speech recognition is not supported here; typed questions remain available.</p>}
          </section>

          <section className="voice-chat card" aria-label="Conversation">
            <div className="voice-chat-head">
              <div><h2>Conversation</h2><span><Sparkles size={14} /> Limited local guidance · not a live AI response</span></div>
              <div className="voice-settings">
                <label htmlFor="voice-language">Language</label>
                <select id="voice-language" value={language} onChange={event => setLanguage(event.target.value as Language)}>
                  <option value="en-IN">English</option>
                  <option value="hi-IN">Hindi</option>
                </select>
              </div>
            </div>
            <div className="voice-messages" aria-live="polite">
              {messages.map(message => (
                <article className={`voice-message ${message.role}`} key={message.id}>
                  <span className="voice-message-icon">{message.role === "assistant" ? <Bot size={17} /> : <span>You</span>}</span>
                  <div className="voice-message-body">
                    <p>{message.text}</p>
                    {message.role === "assistant" && synthesisAvailable && (
                      <button className="voice-replay" onClick={() => speak(message.text, message.id)} aria-label={`Play response ${message.id}`} title="Read this response aloud">
                        <Volume2 size={15} /> {speakingMessageId === message.id ? "Playing" : "Read aloud"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {voiceState === "processing" && <div className="voice-processing"><LoaderCircle className="voice-spin" size={16} /> Preparing local guidance…</div>}
              <div ref={messagesEndRef} />
            </div>
            <div className="voice-prompts">
              <span>Try asking</span>
              {prompts.map(prompt => <button key={prompt} onClick={() => submit(prompt)} disabled={voiceState === "processing"}>{prompt}</button>)}
            </div>
            <form className="voice-composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="voice-text">Ask a question by typing</label>
              <input id="voice-text" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type a question instead…" maxLength={1000} />
              <button type="submit" disabled={!draft.trim() || voiceState === "processing"} aria-label="Send question"><Send size={18} /></button>
            </form>
            <div className="voice-chat-footer">
              <span><ShieldCheck size={15} /> No audio or transcript is saved by this page.</span>
              {synthesisAvailable && voices.length > 0 && (
                <label className="voice-voice-select">Voice
                  <select value={voiceName} onChange={event => setVoiceName(event.target.value)} aria-label="Select speech voice">
                    <option value="">System default</option>
                    {voices.map(voice => <option value={voice.name} key={`${voice.name}-${voice.lang}`}>{voice.name} · {voice.lang}</option>)}
                  </select>
                </label>
              )}
            </div>
          </section>
        </main>

        {caseContextEnabled && <aside className="voice-context stack">
          <section className="card voice-context-card">
            <div className="card-head"><h2>Case context</h2><FileText size={18} /></div>
            {caseLoading ? <p className="voice-empty">Loading case details…</p> : caseError ? <p className="voice-context-error" role="alert">{caseError}</p> : selectedCase ? (
              <>
                <span className="voice-case-reference">{selectedCase.reference}</span>
                <h3>{selectedCase.title}</h3>
                <dl className="voice-facts">
                  <div><dt>Type</dt><dd>{selectedCase.type}</dd></div>
                  <div><dt>Status</dt><dd>{selectedCase.status}</dd></div>
                  <div><dt>Reported amount</dt><dd>{formatMoney(selectedCase.amount)}</dd></div>
                  <div><dt>Incident date</dt><dd>{formatDate(selectedCase.incidentDate || selectedCase.date)}</dd></div>
                </dl>
                <div className="voice-context-counts">
                  <span><FileText size={15} /> {selectedCase.evidence?.length ?? 0} evidence files</span>
                  <span><Clock3 size={15} /> {selectedCase.timeline?.length ?? 0} timeline events</span>
                </div>
                {selectedCase.tasks && selectedCase.tasks.some(task => task.status !== "Completed") && (
                  <div className="voice-context-list"><b>Open case tasks</b>{selectedCase.tasks.filter(task => task.status !== "Completed").slice(0, 3).map(task => <span key={task.id}>{task.title}</span>)}</div>
                )}
                {selectedCase.timeline?.length ? (
                  <div className="voice-context-list"><b>Recent timeline</b>{selectedCase.timeline.slice(0, 2).map(event => <span key={event.id}>{event.title} · {formatDate(event.eventAt)}</span>)}</div>
                ) : null}
                <Link className="voice-case-link" to={`/app/cases/${encodeURIComponent(selectedCase.id)}`}>Open case details <ArrowRight size={15} /></Link>
              </>
            ) : (
              <div className="voice-empty"><p>Select a case to see only the information already recorded in your account.</p>{cases.length === 0 && !casesError && <span>No cases are available to select.</span>}</div>
            )}
          </section>

          <section className="card voice-safety">
            <div className="card-head"><h2>Urgent fraud?</h2><AlertTriangle size={18} /></div>
            <p>If money has just been lost to suspected cyber fraud, contact your bank and report promptly. Do not wait for an AI response.</p>
            <a href="tel:1930"><b>Call 1930</b><span>Cyber-fraud helpline in India</span></a>
            <a href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">Open cybercrime.gov.in <ArrowRight size={14} /></a>
          </section>

          <p className="voice-privacy"><ShieldCheck size={16} /> Microphone access is requested only when you press the microphone. Browser speech recognition may send audio to a browser or speech-service provider; check its privacy terms. This page does not record or store audio.</p>
        </aside>}
      </div>
    </div>
  );
}
