import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import type { ConfirmationResult } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Camera,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  FileUp,
  Handshake,
  Leaf,
  Lightbulb,
  LockKeyhole,
  MapPin,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  University,
  Users,
  X,
} from "lucide-react";

type Role = "citizen" | "university" | "industry";
type Challenge = {
  id: number;
  name: string;
  description: string;
  location: string;
  aiUrgency: "critical" | "high" | "medium" | "low";
  difficulty: "starter" | "intermediate" | "advanced";
  category: string;
  status: string;
  assignedUniversity?: string | null;
  solution?: string | null;
  creatorOpenId?: string | null;
  media?: { url: string; fileName: string }[];
  updates?: { body: string; authorName: string; status: string; createdAt: string }[];
};

const demoChallenges: Challenge[] = [
  { id: 17, name: "Overflowing drain near Ward 6 school", description: "The open drain overflows every monsoon and children cross it on their way to the anganwadi. A low-cost cover and water-flow redesign could help.", location: "Kadamwadi, Pune", aiUrgency: "high", difficulty: "intermediate", category: "Civic infrastructure", status: "in_progress", assignedUniversity: "COEP Technological University", solution: "A modular recycled-plastic drain cover with a debris capture channel is being prototyped." },
  { id: 18, name: "Milk collection cold-chain gap", description: "Small dairy farmers lose a portion of their morning collection because the nearest chilling point is 24 km away.", location: "Sangamner, Maharashtra", aiUrgency: "medium", difficulty: "advanced", category: "Livelihoods", status: "solution_proposed", assignedUniversity: "IIT Bombay", solution: "A solar-assisted community chiller sized for 350 litres is ready for field testing." },
  { id: 19, name: "Accessible bus stop signage", description: "The main bus interchange has no tactile route markers or audio information for people with low vision.", location: "Indore, Madhya Pradesh", aiUrgency: "medium", difficulty: "starter", category: "Inclusive cities", status: "new" },
  { id: 20, name: "Greywater reuse in hostel block", description: "A university hostel sends hundreds of litres of lightly used water to the drain each day, despite gardens needing irrigation.", location: "Kochi, Kerala", aiUrgency: "low", difficulty: "intermediate", category: "Climate & water", status: "new" },
];

const demoEvents = [
  { id: 1, title: "Makers for Monsoon: Drainage Sprint", description: "A 48-hour build sprint with ward engineers, students and local fabricators.", date: "18–19 Oct 2026", location: "COEP Innovation Hub", university: "COEP Technological University", sponsorshipTarget: 180000, sponsorRaised: 112000 },
  { id: 2, title: "Inclusive Mobility Field Lab", description: "Co-designing accessible public transport signage with commuters and disability advocates.", date: "07 Nov 2026", location: "SGSITS Campus, Indore", university: "SGSITS Indore", sponsorshipTarget: 95000, sponsorRaised: 38000 },
];

const roleCopy: Record<Role, { label: string; eyebrow: string; title: string; detail: string; icon: typeof Users; color: string }> = {
  citizen: { label: "Citizen / community", eyebrow: "Share what you see", title: "Your lived experience can start a project.", detail: "Raise a challenge with context, photos and a location. We will make it visible to the people who can act.", icon: Users, color: "peach" },
  university: { label: "University / HEI", eyebrow: "Turn insight into action", title: "Find the right problem for your people.", detail: "Browse AI-triaged challenges, form multidisciplinary teams and keep the community in the loop.", icon: University, color: "sage" },
  industry: { label: "Industry / CSR", eyebrow: "Back practical change", title: "Support solutions with a path to scale.", detail: "Discover grounded projects, mentor teams and sponsor the next field-ready innovation.", icon: Handshake, color: "gold" },
};

function urgencyLabel(value: string) {
  return value === "critical" ? "Critical" : value === "high" ? "High" : value === "low" ? "Low" : "Medium";
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function AppMark({ light = false }: { light?: boolean }) {
  return <div className={`app-mark ${light ? "app-mark-light" : ""}`}><span /><span /><span /></div>;
}

function RoleBadge({ role }: { role: Role }) {
  const Icon = roleCopy[role].icon;
  return <span className={`role-badge role-${role}`}><Icon size={14} /> {roleCopy[role].label}</span>;
}

function ChallengeCard({ challenge, onOpen }: { challenge: Challenge; onOpen: (challenge: Challenge) => void }) {
  return <button className="challenge-card text-left" onClick={() => onOpen(challenge)}>
    <div className="challenge-card-top"><span className={`urgency-pill urgency-${challenge.aiUrgency}`}>{urgencyLabel(challenge.aiUrgency)} urgency</span><span className="small-mono">CG-{String(challenge.id).padStart(4, "0")}</span></div>
    <h3>{challenge.name}</h3>
    <p>{challenge.description}</p>
    <div className="challenge-meta"><span><MapPin size={14} /> {challenge.location}</span><span className="category-label">{challenge.category}</span></div>
  </button>;
}

function UploadModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: (reference: string) => void }) {
  const mutation = trpc.challenges.create.useMutation();
  const [form, setForm] = useState({ citizenName: "", name: "", description: "", phone: "", aadhar: "", email: "", location: "", latitude: "", longitude: "", urgencyRequested: false });
  const [images, setImages] = useState<{ name: string; mimeType: string; dataUrl: string }[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const recaptchaVerifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const phoneVerified = Boolean(confirmationResult === null && otpSent && secondsLeft > 0 && otp.length === 6);
  const normalizePhone = (value: string) => value.trim().startsWith("+") ? value.trim() : `+91${value.trim()}`;
  const sendOtp = async () => {
    setError("");
    try {
      recaptchaVerifier.current?.clear();
      recaptchaVerifier.current = new RecaptchaVerifier(firebaseAuth, "phone-recaptcha-container", { size: "invisible" });
      const result = await signInWithPhoneNumber(firebaseAuth, normalizePhone(form.phone), recaptchaVerifier.current);
      setConfirmationResult(result);
      setOtpSent(true);
      setOtp("");
      setSecondsLeft(60);
    } catch (sendError) {
      recaptchaVerifier.current?.clear();
      recaptchaVerifier.current = null;
      setError(sendError instanceof Error ? sendError.message : "Unable to send the verification code. Please try again.");
    }
  };
  const verifyOtp = async (value: string) => {
    setOtp(value);
    if (value.length !== 6 || !confirmationResult || secondsLeft <= 0) return;
    setIsVerifyingOtp(true);
    try {
      await confirmationResult.confirm(value);
      setConfirmationResult(null);
      setError("");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "The verification code is invalid.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  useEffect(() => () => recaptchaVerifier.current?.clear(), []);

  const update = (key: string, value: string | boolean) => setForm(current => ({ ...current, [key]: value }));
  const locate = () => {
    setIsLocating(true);
    if (!navigator.geolocation) { setError("Location is not available in this browser."); setIsLocating(false); return; }
    navigator.geolocation.getCurrentPosition(position => {
      update("latitude", position.coords.latitude.toFixed(6));
      update("longitude", position.coords.longitude.toFixed(6));
      update("location", `Pinned location (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`);
      setIsLocating(false);
    }, () => { setError("We could not read your location. Add a nearby landmark instead."); setIsLocating(false); });
  };
  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).slice(0, 5).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => setImages(current => [...current, { name: file.name, mimeType: file.type || "image/jpeg", dataUrl: String(reader.result) }].slice(0, 5));
      reader.readAsDataURL(file);
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (!form.citizenName || !form.name || !form.phone || !form.description || !form.email || !form.location) { setError("Please complete all required fields marked with *."); return; }
    if (!phoneVerified) { setError("Verify your phone number with the OTP before submitting."); return; }
    try {
      const result = await mutation.mutateAsync({ ...form, images, otpVerified: true });
      onSubmitted(result.reference);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    }
  };

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Share a challenge">
    <div className="modal-card upload-modal">
      <div className="modal-heading"><div><span className="eyebrow">Citizen intake</span><h2>Share a challenge</h2><p>Give the people closest to the problem a head start.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
      <form onSubmit={submit} className="modal-form">
        <div className="form-grid"><label>Citizen name <span className="required-mark">*</span><input required value={form.citizenName} onChange={e => update("citizenName", e.target.value)} placeholder="Your full name" /></label><label>Problem name <span className="required-mark">*</span><input required value={form.name} onChange={e => update("name", e.target.value)} placeholder="e.g. Water logging at the bus stand" /></label></div>
        <div className="form-grid"><label>Phone number <span className="required-mark">*</span><div className="phone-input-row"><input required value={form.phone} onChange={e => { update("phone", e.target.value); setOtpSent(false); setOtp(""); setConfirmationResult(null); }} placeholder="10-digit phone number" /><button type="button" className="send-otp-button" onClick={sendOtp} disabled={form.phone.length < 8 || isVerifyingOtp}>{otpSent ? "Resend OTP" : "Send OTP"}</button></div>{otpSent && <div className="otp-row"><input aria-label="6-digit OTP" inputMode="numeric" maxLength={6} value={otp} onChange={e => verifyOtp(e.target.value.replace(/\D/g, ""))} placeholder="6-digit OTP" /><span>{secondsLeft > 0 ? `Expires in ${secondsLeft}s` : "OTP expired"}</span>{phoneVerified && <b>Verified</b>}</div>}</label><div /></div>
        <div id="phone-recaptcha-container" aria-hidden="true" />
        <label>Explain the problem <span className="required-mark">*</span><textarea required minLength={20} value={form.description} onChange={e => update("description", e.target.value)} placeholder="What is happening, who is affected and what would better look like?" rows={4} /></label>
        <div className="form-grid"><label>Aadhaar number<input inputMode="numeric" value={form.aadhar} onChange={e => update("aadhar", e.target.value.replace(/\D/g, ""))} placeholder="12-digit Aadhaar (stored securely)" /><small>We only retain the last four digits for your reference.</small></label><label>Email <span className="required-mark">*</span><input required type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="you@example.com" /></label></div>
        <div className="form-grid"><label>Nearby location <span className="required-mark">*</span><input required value={form.location} onChange={e => update("location", e.target.value)} placeholder="Landmark, ward or village" /></label><button type="button" className="location-button" onClick={locate}><Compass size={17} /> {isLocating ? "Locating…" : "Use my location"}</button></div>
        <div className="upload-zone"><div><Camera size={19} /><strong>Geotagged photos</strong><span>Add up to 5 photos that help explain the context.</span></div><label className="file-button"><FileUp size={16} /> Choose photos<input type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} /></label>{images.length > 0 && <div className="file-list">{images.map(image => <span key={image.name}><BadgeCheck size={13} /> {image.name}</span>)}</div>}</div>
        <label className="urgency-check"><input type="checkbox" checked={form.urgencyRequested} onChange={e => update("urgencyRequested", e.target.checked)} /><span><strong>This is urgent</strong><small>We will combine your signal with AI triage and human review.</small></span></label>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Save for later</button><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? "Reviewing…" : "Submit challenge"}<ArrowRight size={16} /></button></div>
      </form>
    </div>
  </div>;
}

function DetailModal({ challenge, onClose, role, canDelete, onClaim, onUpdate, onSolution, onDelete }: { challenge: Challenge; onClose: () => void; role: Role; canDelete: boolean; onClaim: () => void; onUpdate: () => void; onSolution: (solution: string) => void; onDelete: () => void }) {
  const [solution, setSolution] = useState("");
  const canAct = role === "university";
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Challenge details"><div className="modal-card detail-modal"><div className="modal-heading"><div><span className={`urgency-pill urgency-${challenge.aiUrgency}`}>{urgencyLabel(challenge.aiUrgency)} urgency</span><h2>{challenge.name}</h2><p><MapPin size={14} /> {challenge.location} · {challenge.category}</p></div><div className="detail-heading-actions">{canDelete && <button className="delete-link" onClick={onDelete}>Delete</button>}<button className="icon-button" onClick={onClose}><X size={20} /></button></div></div><div className="detail-body"><div className="detail-copy"><h4>What the community shared</h4><p>{challenge.description}</p><div className="detail-facts"><span><strong>Difficulty</strong>{formatStatus(challenge.difficulty)}</span><span><strong>Stage</strong>{formatStatus(challenge.status)}</span><span><strong>Reference</strong>CG-{String(challenge.id).padStart(4, "0")}</span></div>{challenge.solution && <div className="solution-box"><span className="eyebrow">Proposed solution</span><p>{challenge.solution}</p></div>}</div><div className="detail-side"><div className="ai-note"><Sparkles size={17} /><div><strong>AI triage</strong><p>Classified as <b>{challenge.category}</b> · {urgencyLabel(challenge.aiUrgency).toLowerCase()} urgency.</p></div></div><div className="mini-timeline"><span className="timeline-active" /><div><b>Challenge submitted</b><small>Community review queue</small></div><span className={challenge.status !== "new" ? "timeline-active" : ""} /><div><b>{challenge.status === "new" ? "Waiting for a team" : "Team engaged"}</b><small>{challenge.assignedUniversity || "University match in progress"}</small></div></div></div></div>{canAct && <div className="detail-actions"><div className="action-row"><button className="button button-primary" onClick={onClaim}><Lightbulb size={16} /> Start solving</button><button className="button button-secondary" onClick={onUpdate}><MessageCircle size={16} /> Post update</button></div><div className="solution-entry"><textarea value={solution} onChange={e => setSolution(e.target.value)} placeholder="Share a proposed solution once your team has a direction…" rows={3} /><button className="button button-dark" disabled={solution.length < 20} onClick={() => onSolution(solution)}><Send size={16} /> Upload solution</button></div></div>}</div></div>;
}

function LoginPanel({ onChoose, onClose }: { onChoose: (role: Role) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<Role>("citizen");
  return <div className="modal-backdrop"><div className="modal-card login-modal"><button className="icon-button close-corner" onClick={onClose}><X size={20} /></button><div className="login-brand"><AppMark /><span>COMMON GROUND</span></div><span className="eyebrow">Welcome in</span><h2>Choose your way to contribute.</h2><p className="login-intro">One portal, three perspectives. You can change this later.</p><div className="role-picker">{(Object.keys(roleCopy) as Role[]).map(role => { const Icon = roleCopy[role].icon; return <button key={role} className={`role-option ${selected === role ? "selected" : ""}`} onClick={() => setSelected(role)}><span className={`role-icon ${roleCopy[role].color}`}><Icon size={20} /></span><span><strong>{roleCopy[role].label}</strong><small>{role === "citizen" ? "Raise a local challenge" : role === "university" ? "Build with student teams" : "Mentor, fund and scale"}</small></span><ChevronDown size={16} /></button>; })}</div><button className="button button-primary login-cta" onClick={() => selected === "citizen" ? onChoose(selected) : startLogin()}>{selected === "citizen" ? `Continue as ${roleCopy[selected].label}` : `Create ${roleCopy[selected].label} account`}<ArrowRight size={16} /></button><button className="text-link" onClick={() => startLogin()}>Already have a portal account? Sign in securely</button><div className="privacy-note"><LockKeyhole size={14} /> Your personal information is encrypted and never shown publicly.</div></div></div>;
}

function CitizenDashboard({ challenges, onUpload, onOpen }: { challenges: Challenge[]; onUpload: () => void; onOpen: (challenge: Challenge) => void }) {
  const [tracking, setTracking] = useState("");
  const mine = challenges.filter(challenge => challenge.id === Number(tracking.replace(/\D/g, "")));
  return <div className="role-view"><div className="role-hero role-hero-citizen"><div><RoleBadge role="citizen" /><h1>Make the invisible visible.</h1><p>Share a challenge from your street, school, farm or neighbourhood. A clearer brief is the first act of change.</p><button className="button button-accent" onClick={onUpload}><Plus size={17} /> Share a challenge</button></div><div className="citizen-illustration"><div className="sun" /><div className="hill hill-one" /><div className="hill hill-two" /><div className="house"><span /></div></div></div><div className="section-heading"><div><span className="eyebrow">Your community desk</span><h2>Track a challenge</h2></div><div className="track-search"><Search size={16} /><input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Enter reference, e.g. CG-0017" /></div></div>{tracking && <div className="tracking-result">{mine.length ? mine.map(challenge => <ChallengeCard key={challenge.id} challenge={challenge} onOpen={onOpen} />) : <div className="empty-state"><CircleHelp size={18} /><span>No matching reference yet. Try <b>17</b> for a demo.</span></div>}</div>}<div className="citizen-grid"><div className="info-panel"><div className="panel-icon"><Bell size={19} /></div><div><h3>What happens next?</h3><p>We anonymise your intake, add AI-assisted context and put it in front of universities and local partners who can take it forward.</p></div></div><div className="impact-panel"><span className="eyebrow">Collective pulse</span><strong>84%</strong><p>of challenges receive a first response within 7 days.</p></div></div></div>;
}

function UniversityDashboard({ challenges, events, onOpen, onCreateEvent }: { challenges: Challenge[]; events: typeof demoEvents; onOpen: (challenge: Challenge) => void; onCreateEvent: () => void }) {
  const [filter, setFilter] = useState("All challenges");
  const filtered = challenges.filter(challenge => filter === "All challenges" || challenge.aiUrgency === filter.toLowerCase() || challenge.category === filter);
  return <div className="role-view dashboard-view"><div className="dashboard-top"><div><RoleBadge role="university" /><h1>Good morning, builders.</h1><p>There are 12 challenges where your campus could make a measurable difference.</p></div><button className="button button-primary" onClick={onCreateEvent}><Plus size={17} /> Post a tech event</button></div><div className="metric-grid"><div className="metric-card"><span>Open challenges</span><strong>12</strong><small><span className="trend-up">↑ 3</span> this month</small></div><div className="metric-card metric-sage"><span>In progress</span><strong>05</strong><small>Across 3 faculties</small></div><div className="metric-card metric-peach"><span>Community replies</span><strong>28</strong><small><span className="trend-up">↑ 18%</span> response rate</small></div><div className="metric-card metric-gold"><span>Field trials</span><strong>03</strong><small>Ready for partners</small></div></div><div className="section-heading table-heading"><div><span className="eyebrow">Opportunity board</span><h2>Find a challenge worth solving</h2></div><div className="filter-tabs">{["All challenges", "high", "medium", "low"].map(value => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "All challenges" ? value : `${urgencyLabel(value)} urgency`}</button>)}</div></div><div className="challenge-table"><div className="table-head"><span>Challenge</span><span>Urgency</span><span>Location</span><span>Difficulty</span><span>Stage</span></div>{filtered.map(challenge => <button className="table-row" key={challenge.id} onClick={() => onOpen(challenge)}><span className="table-challenge"><b>{challenge.name}</b><small>{challenge.category} · CG-{String(challenge.id).padStart(4, "0")}</small></span><span><span className={`urgency-pill urgency-${challenge.aiUrgency}`}>{urgencyLabel(challenge.aiUrgency)}</span></span><span><MapPin size={14} /> {challenge.location}</span><span className="difficulty"><i className={`difficulty-dot difficulty-${challenge.difficulty}`} />{formatStatus(challenge.difficulty)}</span><span className="stage-label">{formatStatus(challenge.status)}</span></button>)}</div><div className="events-strip"><div><span className="eyebrow">Campus to community</span><h2>Your upcoming tech events</h2></div>{events.slice(0, 2).map(event => <div className="event-mini" key={event.id}><div className="date-tile"><span>{event.date.split(" ")[0]}</span><small>{event.date.split(" ")[1] || "OCT"}</small></div><div><b>{event.title}</b><small>{event.university} · {event.sponsorRaised > 0 ? `₹${(event.sponsorRaised / 1000).toFixed(0)}k sponsored` : "Seeking sponsors"}</small></div></div>)}</div></div>;
}

function IndustryDashboard({ challenges, events, onOpen, onSponsor }: { challenges: Challenge[]; events: typeof demoEvents; onOpen: (challenge: Challenge) => void; onSponsor: (eventId: number) => void }) {
  const solutions = challenges.filter(challenge => challenge.solution);
  return <div className="role-view dashboard-view"><div className="dashboard-top industry-top"><div><RoleBadge role="industry" /><h1>Put your capacity to work.</h1><p>Back teams who understand the context, with capital, mentorship or a pathway to scale.</p></div><div className="partner-note"><Handshake size={19} /><span>6 active partnerships<br /><b>₹18.4L deployed this quarter</b></span></div></div><div className="industry-layout"><section><div className="section-heading"><div><span className="eyebrow">Solutions looking for allies</span><h2>Ready for a partner</h2></div><button className="text-link">View all <ArrowRight size={14} /></button></div><div className="solution-list">{solutions.map(challenge => <button className="solution-card text-left" key={challenge.id} onClick={() => onOpen(challenge)}><div className="solution-card-head"><span className="tag tag-sage">{challenge.category}</span><span className="small-mono">CG-{String(challenge.id).padStart(4, "0")}</span></div><h3>{challenge.name}</h3><p>{challenge.solution}</p><div className="solution-foot"><span><University size={14} /> {challenge.assignedUniversity || "University partner"}</span><span className="text-link">Contribute <ArrowRight size={13} /></span></div></button>)}</div></section><aside className="sponsor-column"><div className="section-heading"><div><span className="eyebrow">Make a moment</span><h2>Sponsor a field lab</h2></div></div>{events.map(event => <div className="sponsor-card" key={event.id}><div className="sponsor-card-top"><span className="tag tag-gold">{event.date}</span><span className="small-mono">{Math.round((event.sponsorRaised / event.sponsorshipTarget) * 100)}%</span></div><h3>{event.title}</h3><p>{event.description}</p><div className="progress-line"><span style={{ width: `${Math.min(100, (event.sponsorRaised / event.sponsorshipTarget) * 100)}%` }} /></div><div className="sponsor-meta"><span>₹{(event.sponsorRaised / 1000).toFixed(0)}k raised</span><span>₹{(event.sponsorshipTarget / 1000).toFixed(0)}k target</span></div><button className="button button-dark full-width" onClick={() => onSponsor(event.id)}>Sponsor this event <ArrowRight size={15} /></button></div>)}</aside></div></div>;
}

function EventModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const mutation = trpc.events.create.useMutation();
  const [form, setForm] = useState({ title: "", description: "", date: "", location: "", university: "", sponsorshipTarget: "" });
  const update = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); await mutation.mutateAsync({ ...form, sponsorshipTarget: Number(form.sponsorshipTarget || 0) }); onCreated(); };
  return <div className="modal-backdrop"><div className="modal-card event-modal"><div className="modal-heading"><div><span className="eyebrow">University workspace</span><h2>Post a tech event</h2><p>Invite partners into a focused moment of making.</p></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><form className="modal-form" onSubmit={submit}><label>Event title<input required value={form.title} onChange={e => update("title", e.target.value)} placeholder="e.g. Accessible Mobility Field Lab" /></label><label>What will happen?<textarea required value={form.description} onChange={e => update("description", e.target.value)} placeholder="What challenge will the event tackle and who should join?" rows={3} /></label><div className="form-grid"><label>Date<input required value={form.date} onChange={e => update("date", e.target.value)} placeholder="18–19 Oct 2026" /></label><label>Location<input required value={form.location} onChange={e => update("location", e.target.value)} placeholder="Campus or field site" /></label></div><div className="form-grid"><label>University / host<input required value={form.university} onChange={e => update("university", e.target.value)} placeholder="Institution name" /></label><label>Sponsorship target<input required type="number" value={form.sponsorshipTarget} onChange={e => update("sponsorshipTarget", e.target.value)} placeholder="₹ amount" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={mutation.isPending}>Publish event <ArrowRight size={16} /></button></div></form></div></div>;
}

export default function Home() {
  const [role, setRole] = useState<Role | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);
  const [notice, setNotice] = useState("");
  const challengesQuery = trpc.challenges.list.useQuery();
  const eventsQuery = trpc.events.list.useQuery();
  const challenges = useMemo(() => ((challengesQuery.data || []) as Challenge[]).length ? (challengesQuery.data || []) as Challenge[] : demoChallenges, [challengesQuery.data]);
  const events = useMemo(() => ((eventsQuery.data || []) as typeof demoEvents).length ? (eventsQuery.data || []) as typeof demoEvents : demoEvents, [eventsQuery.data]);
  const claim = trpc.challenges.claim.useMutation();
  const update = trpc.challenges.update.useMutation();
  const solution = trpc.challenges.solution.useMutation();
  const sponsor = trpc.events.sponsor.useMutation();
  const roleData = role ? roleCopy[role] : null;
  const { user } = useAuth();
  const deleteMutation = trpc.challenges.delete.useMutation();
  const deleteChallenge = async () => {
    if (!selectedChallenge || !window.confirm("Are you sure you want to delete this challenge?")) return;
    await deleteMutation.mutateAsync({ id: selectedChallenge.id });
    setSelectedChallenge(null);
    await challengesQuery.refetch();
    showNotice("Challenge deleted.");
  };

  const showNotice = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(""), 4200); };
  const handleClaim = async () => { if (!selectedChallenge) return; await claim.mutateAsync({ id: selectedChallenge.id, university: "COEP Technological University" }); setSelectedChallenge({ ...selectedChallenge, status: "in_progress", assignedUniversity: "COEP Technological University" }); showNotice("Challenge claimed. Your team is now connected to the community contact."); };
  const handleUpdate = async () => { if (!selectedChallenge) return; await update.mutateAsync({ challengeId: selectedChallenge.id, authorRole: "university", authorName: "COEP Technological University", body: "Our multidisciplinary team has completed the first site walk and is mapping the water flow.", status: "In progress" }); showNotice("Update posted to the project timeline."); };
  const handleSolution = async (value: string) => { if (!selectedChallenge) return; await solution.mutateAsync({ id: selectedChallenge.id, solution: value }); setSelectedChallenge({ ...selectedChallenge, status: "solution_proposed", solution: value }); showNotice("Solution uploaded for industry partners to review."); };
  const handleSponsor = async (eventId: number) => { await sponsor.mutateAsync({ eventId, industryName: "Your organisation", amount: 50000, contributionNote: "Interested in field testing and mentorship." }); showNotice("Thanks — a partnership note is ready for the university team."); };

  return <div className="portal-shell">
    <header className="site-header"><a className="brand" href="#top"><AppMark /><span>COMMON<br /><b>GROUND</b></span></a><nav><a href="/#how-it-works">How it works</a><a href="/#opportunities">Opportunities</a><a href="/#stories">Stories</a></nav><div className="header-actions"><button className="button button-primary button-small" onClick={() => setLoginOpen(true)}>Join / Log in <ArrowRight size={14} /></button><button className="mobile-menu" aria-label="Menu"><Menu size={20} /></button></div></header>
    {!role ? <>
      <main id="top"><section className="hero"><div className="hero-copy"><span className="eyebrow">A civic innovation commons</span><h1>Good ideas start with <em>good questions.</em></h1><p className="hero-lede">Common Ground brings lived experience, university talent and industry capacity to the same table — so local challenges become shared projects.</p><div className="hero-actions"><button className="button button-primary" onClick={() => setUploadOpen(true)}>Share a challenge <ArrowRight size={16} /></button><button className="button button-quiet" onClick={() => setLoginOpen(true)}>Explore as a partner <Compass size={16} /></button></div><div className="hero-proof"><div className="avatar-stack"><span>R</span><span>A</span><span>M</span><span>+</span></div><span><b>1,240 neighbours</b><br />already making things better</span></div></div><div className="hero-art"><div className="art-card art-card-back"><span className="small-mono">FIELD NOTE 07</span><strong>Small signals.<br />Shared action.</strong><div className="scribble">↗</div></div><div className="art-card art-card-front"><div className="art-map"><span className="map-line line-a" /><span className="map-line line-b" /><span className="map-line line-c" /><span className="map-pin pin-one" /><span className="map-pin pin-two" /><span className="map-pin pin-three" /></div><span className="small-mono">LIVE ON THE GROUND</span><p>From a school drain in Kadamwadi to a solar milk chiller in Sangamner.</p></div><div className="hero-stamp"><span>LISTEN</span><span>MAKE</span><span>LEARN</span></div></div></section><section className="ticker"><span><Sparkles size={14} /> AI-assisted triage, human-led decisions</span><span><ShieldCheck size={14} /> Privacy-first citizen intake</span><span><Handshake size={14} /> 24 partner institutions</span></section><section className="section light-section" id="how-it-works"><div className="section-heading large-heading"><div><span className="eyebrow">A living network</span><h2>Different roles.<br /><em>One common ground.</em></h2></div><p>Every challenge has more than one perspective. The hub gives each one a useful next step.</p></div><div className="role-grid">{(Object.keys(roleCopy) as Role[]).map(key => { const data = roleCopy[key]; const Icon = data.icon; return <button className={`role-card role-card-${data.color}`} key={key} onClick={() => { setRole(key); window.scrollTo({ top: 0, behavior: "smooth" }); }}><div className="role-card-top"><span className="role-icon"><Icon size={21} /></span><ArrowRight size={18} /></div><span className="eyebrow">{data.eyebrow}</span><h3>{data.label}</h3><p>{data.detail}</p><span className="card-link">Enter your workspace <ArrowRight size={14} /></span></button>; })}</div></section><section className="section dark-section" id="opportunities"><div className="section-heading dark-heading"><div><span className="eyebrow">Signals becoming projects</span><h2>What is waiting<br /><em>for a good team?</em></h2></div><button className="button button-ghost-light" onClick={() => { setRole("university"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>See the opportunity board <ArrowRight size={15} /></button></div><div className="challenge-preview">{challenges.slice(0, 3).map(challenge => <ChallengeCard key={challenge.id} challenge={challenge} onOpen={setSelectedChallenge} />)}</div></section><section className="section story-section" id="stories"><div className="story-visual"><div className="story-number">01</div><div className="story-quote">“The solution was not in a lab. It was in the way people were already adapting.”</div><span className="small-mono">FIELD NOTE · KADAMWADI</span></div><div className="story-copy"><span className="eyebrow">A better brief</span><h2>Make room for the people who know the problem best.</h2><p>Before a project gets a budget or a badge, it gets a careful question. Common Ground keeps community context attached to the work from first report to field trial.</p><button className="text-link">Read the field notes <ArrowRight size={15} /></button></div></section></main><footer className="site-footer"><div><a className="brand brand-footer"><AppMark light /><span>COMMON<br /><b>GROUND</b></span></a><p>Local knowledge, shared capacity.</p></div><div className="footer-links"><span>Built for citizens, campuses & collaborators.</span><a href="mailto:hello@commonground.example">hello@commonground.example <ArrowUpRightIcon /></a></div></footer></> : <main className="workspace" id="top"><div className="workspace-header"><button className="back-home" onClick={() => setRole(null)}>← Back to the commons</button><div className="workspace-user"><span className="status-dot" /> Live workspace <button className="user-menu" onClick={() => setLoginOpen(true)}><span className="user-avatar">{roleData?.label.charAt(0)}</span>{roleData?.label}<ChevronDown size={14} /></button></div></div>{role === "citizen" && <CitizenDashboard challenges={challenges} onUpload={() => setUploadOpen(true)} onOpen={setSelectedChallenge} />}{role === "university" && <UniversityDashboard challenges={challenges} events={events} onOpen={setSelectedChallenge} onCreateEvent={() => setEventOpen(true)} />}{role === "industry" && <IndustryDashboard challenges={challenges} events={events} onOpen={setSelectedChallenge} onSponsor={handleSponsor} />}</main>}
    {loginOpen && <LoginPanel onClose={() => setLoginOpen(false)} onChoose={chosen => { setRole(chosen); setLoginOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}{uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onSubmitted={reference => { setUploadOpen(false); showNotice(`Challenge received — your reference is ${reference}.`); }} />}{eventOpen && <EventModal onClose={() => setEventOpen(false)} onCreated={() => { setEventOpen(false); showNotice("Tech event published. Partner invitations are ready to go."); }} />}{selectedChallenge && <DetailModal challenge={selectedChallenge} role={role || "university"} onClose={() => setSelectedChallenge(null)} onClaim={handleClaim} onUpdate={handleUpdate} onSolution={handleSolution} onDelete={deleteChallenge} canDelete={Boolean(user?.openId && selectedChallenge.creatorOpenId === user.openId)} />}{notice && <div className="toast"><BadgeCheck size={17} /><span>{notice}</span></div>}
  </div>;
}

function ArrowUpRightIcon() { return <ArrowRight size={14} />; }
