import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const USERS = [
  { username: "Peconi", password: "Gracanica038?", role: "admin" },
  { username: "Filip", password: "Jecmenic@2026", role: "worker" },
  { username: "Mirela", password: "M!ReL@2026", role: "worker" },
];
const ST = {
  novo: { label: "Za unos", color: "#60a5fa", bg: "rgba(96,165,250,0.15)", icon: "🆕" },
  uneto: { label: "Uneto u sistem", color: "#a78bfa", bg: "rgba(167,139,250,0.15)", icon: "📋" },
  poslato_nedja: { label: "Poslato po Nedji", color: "#fb923c", bg: "rgba(251,146,60,0.15)", icon: "🚐" },
  poslato_kupcu: { label: "Poslato kupcu", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", icon: "📦" },
  isporuceno: { label: "Isporučeno", color: "#34d399", bg: "rgba(52,211,153,0.15)", icon: "✅" },
  odbijeno: { label: "Odbijeno", color: "#f87171", bg: "rgba(248,113,113,0.15)", icon: "❌" },
};
const FT = { uplata: { label: "Uplata radnika", color: "#34d399" }, retur: { label: "Retur poštarina", color: "#f87171" }, ostalo: { label: "Ostalo", color: "#a78bfa" } };

const getDispSt = (o) => {
  const base = ST[o.status] || ST.novo;
  if (o.status === "poslato_nedja" && o.fromInventory) {
    return { label: "Spremno za slanje", icon: "📦", color: "#22c55e", bg: "rgba(34,197,94,0.15)" };
  }
  return base;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fd = d => d ? new Date(d).toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const fdt = d => d ? fd(d) + " " + new Date(d).toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" }) : "—";
const fm = n => new Intl.NumberFormat("sr-RS").format(n || 0) + " RSD";
const tdy = () => new Date().toISOString().slice(0, 10);
const dk = d => new Date(d).toISOString().slice(0, 10);

// Phone formatting — Viber needs +381XXXXXXXXX (no spaces), tel: needs raw number
const fmtPhoneIntl = (p) => {
  if (!p) return "";
  let c = String(p).replace(/[\s\-\(\)]/g, "");
  if (c.startsWith("+381")) return c;
  if (c.startsWith("00381")) return "+" + c.slice(2);
  if (c.startsWith("0")) return "+381" + c.slice(1);
  return "+381" + c;
};
const fmtPhoneForTel = (p) => fmtPhoneIntl(p);
const fmtPhoneForViber = (p) => fmtPhoneIntl(p); // viber://chat?number= needs +381...

// PostExpress tracking URL
const trackUrl = (px) => `https://posta.rs/alati/pracenje-posiljaka.aspx?code=${encodeURIComponent(px || "")}`;

// Notification helpers
const notifSupported = () => typeof window !== "undefined" && "Notification" in window;
const notifPermission = () => notifSupported() ? Notification.permission : "denied";
async function requestNotifPerm() {
  if (!notifSupported()) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}
function showNotif(title, body, tag, onClick) {
  if (!notifSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag, icon: "/icon-192.png", badge: "/icon-192.png", requireInteraction: false });
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch (e) { console.error("Notif error:", e); }
}

// Track which urgent orders already notified (localStorage, per-day)
const NOTIF_KEY = "ecom-notified-urgent";
function getNotified() {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || "{}"); } catch { return {}; }
}
function setNotified(obj) {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify(obj)); } catch {}
}
const PER_PAGE = 15;

const SK = "ecom-v1";
const blank = () => ({ orders: [], finances: [], inventory: [], history: [], models: [], costs: [], adSpend: [] });

// ─── Konverzija JS ↔ DB nazivi kolona ───
const camelToSnake = (s) => s.replace(/[A-Z]/g, l => "_" + l.toLowerCase());
const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
function toDbRow(obj) {
  const out = {};
  for (const k in obj) {
    if (obj[k] === undefined) continue;
    out[camelToSnake(k)] = obj[k];
  }
  return out;
}
function fromDbRow(row) {
  if (!row) return row;
  const out = {};
  for (const k in row) {
    out[snakeToCamel(k)] = row[k];
  }
  return out;
}

// ─── Učitavanje svih podataka iz tabela ───
async function ld() {
  if (!supabase) {
    try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : blank(); } catch { return blank(); }
  }
  try {
    const [oRes, fRes, iRes, mRes, cRes, aRes, hRes] = await Promise.all([
      supabase.from("orders").select("*").order("date_created", { ascending: false }),
      supabase.from("finances").select("*").order("date", { ascending: false }),
      supabase.from("inventory").select("*").order("date_added", { ascending: false }),
      supabase.from("models").select("*").order("date_added", { ascending: false }),
      supabase.from("costs").select("*"),
      supabase.from("ad_spend").select("*").order("date", { ascending: false }),
      supabase.from("history").select("*").order("date", { ascending: false }).limit(500),
    ]);
    return {
      orders: (oRes.data || []).map(fromDbRow),
      finances: (fRes.data || []).map(fromDbRow),
      inventory: (iRes.data || []).map(fromDbRow),
      models: (mRes.data || []).map(fromDbRow),
      costs: (cRes.data || []).map(fromDbRow),
      adSpend: (aRes.data || []).map(fromDbRow),
      history: (hRes.data || []).map(fromDbRow),
    };
  } catch (e) { console.error("Load error:", e); return blank(); }
}

// ─── Pojedinačne operacije po entitetu ───
// Konvencija: naziv tabele (TBL) i polje u lokalnom data objektu (KEY) se razlikuju u 2 slučaja:
const TBL_MAP = { orders: "orders", finances: "finances", inventory: "inventory", models: "models", costs: "costs", adSpend: "ad_spend", history: "history" };

async function dbUpsert(entity, row) {
  if (!supabase) return;
  try {
    const dbRow = toDbRow(row);
    console.log(`[dbUpsert] ${entity}:`, dbRow);
    const { data, error } = await supabase.from(TBL_MAP[entity]).upsert(dbRow).select();
    if (error) {
      console.error(`❌ Upsert ${entity} FAILED:`, error.message, error);
      alert(`Upsert ${entity} greška: ${error.message}`);
    } else {
      console.log(`✅ Upsert ${entity} OK:`, data);
    }
  } catch (e) { console.error("Upsert exception:", e); }
}

async function dbDelete(entity, id) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from(TBL_MAP[entity]).delete().eq("id", id);
    if (error) console.error(`Delete ${entity} error:`, error);
  } catch (e) { console.error(e); }
}

// Backward-compat: sv() snima ceo state u localStorage kao fallback
async function sv(d) {
  if (!supabase) {
    try { localStorage.setItem(SK, JSON.stringify(d)); } catch {}
  }
}

// ─── Generički diff sync: poredi staro i novo stanje, šalje samo promene u DB ───
// Ovo je srce novog sistema — svako setData automatski sinhronizuje samo ono što se promenilo
async function syncDiff(oldData, newData) {
  if (!supabase) {
    // localStorage fallback — samo snimi sve
    try { localStorage.setItem(SK, JSON.stringify(newData)); } catch {}
    return;
  }
  const entities = ["orders", "finances", "inventory", "models", "costs", "adSpend", "history"];
  let totalOps = 0;
  for (const ent of entities) {
    const oldArr = oldData?.[ent] || [];
    const newArr = newData?.[ent] || [];
    const oldMap = new Map(oldArr.map(x => [x.id, x]));
    const newMap = new Map(newArr.map(x => [x.id, x]));

    // Brisani (u old a nema u new)
    for (const [id] of oldMap) {
      if (!newMap.has(id)) {
        console.log(`[syncDiff] DELETE ${ent}/${id}`);
        totalOps++;
        await dbDelete(ent, id);
      }
    }
    // Dodati ili izmenjeni
    for (const [id, row] of newMap) {
      const oldRow = oldMap.get(id);
      if (!oldRow) {
        // Novi zapis
        console.log(`[syncDiff] INSERT ${ent}/${id}`);
        totalOps++;
        await dbUpsert(ent, row);
      } else {
        // Proveri da li je promenjen (plitko poređenje kroz JSON)
        try {
          if (JSON.stringify(oldRow) !== JSON.stringify(row)) {
            console.log(`[syncDiff] UPDATE ${ent}/${id}`);
            totalOps++;
            await dbUpsert(ent, row);
          }
        } catch { await dbUpsert(ent, row); }
      }
    }
  }
  console.log(`[syncDiff] Done. Total ops: ${totalOps}`);
}

function copyText(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

const F = `'Outfit',sans-serif`, FM = `'JetBrains Mono',monospace`;
const C = { bg: "#0a0a0d", s1: "#131318", s2: "#1a1a21", s3: "#222230", border: "#2a2a35", text: "#eaeaf0", dim: "#7a7a8e", accent: "#f59e0b", accentBg: "rgba(245,158,11,0.1)", danger: "#ef4444", dangerBg: "rgba(239,68,68,0.1)", success: "#22c55e", successBg: "rgba(34,197,94,0.1)", info: "#3b82f6", infoBg: "rgba(59,130,246,0.1)", purple: "#a78bfa", purpleBg: "rgba(167,139,250,0.1)" };
const bb = { border: "none", borderRadius: 10, cursor: "pointer", fontFamily: F, fontWeight: 600, fontSize: 14, transition: "all 0.15s", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 };
const S = {
  inp: { width: "100%", padding: "11px 14px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontFamily: F, outline: "none", boxSizing: "border-box" },
  sel: { width: "100%", padding: "11px 14px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontFamily: F, outline: "none", boxSizing: "border-box", appearance: "none" },
  ta: { width: "100%", padding: "11px 14px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontFamily: F, outline: "none", boxSizing: "border-box", resize: "vertical", minHeight: 80 },
  lb: { fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 5, display: "block", textTransform: "uppercase", letterSpacing: 0.8 },
  card: { background: C.s1, borderRadius: 14, border: `1px solid ${C.border}`, padding: 16, marginBottom: 10 },
  btn: { ...bb, padding: "11px 18px", background: C.accent, color: "#000" },
  btn2: { ...bb, padding: "9px 14px", background: C.s2, color: C.text, border: `1px solid ${C.border}` },
  btnD: { ...bb, padding: "9px 14px", background: C.dangerBg, color: C.danger },
  btnS: { ...bb, padding: "5px 11px", fontSize: 12 },
  badge: (c, bg) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: c, background: bg, whiteSpace: "nowrap" }),
  stat: { background: C.s2, borderRadius: 12, padding: 12 },
  stL: { fontSize: 10, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 },
  stV: { fontSize: 20, fontWeight: 800, fontFamily: FM, letterSpacing: -0.5 },
  over: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 },
  modal: { background: C.s1, borderRadius: "20px 20px 0 0", padding: "20px 18px 28px", width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", border: `1px solid ${C.border}`, borderBottom: "none" },
};
function Fl({ label, children }) { return <div style={{ marginBottom: 12 }}><label style={S.lb}>{label}</label>{children}</div>; }
function Ic({ d, size = 20, color = "currentColor" }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>; }
const I = { plus: "M12 5v14M5 12h14", search: "M11 3a8 8 0 100 16 8 8 0 000-16zM21 21l-4.35-4.35", logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9", edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z", trash: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2", x: "M18 6L6 18M6 6l12 12", orders: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", finance: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", inventory: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z", history: "M12 8v4l3 3M3 12a9 9 0 1018 0 9 9 0 00-18 0", shoe: "M2 18l1.7-5.1a2 2 0 011.9-1.4h.7a2 2 0 001.7-1L10 7a2 2 0 013.4 0l2 3.5a2 2 0 001.7 1h.7a2 2 0 011.9 1.4L22 18", check: "M20 6L9 17l-5-5", archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4", more: "M12 5v.01M12 12v.01M12 19v.01", alert: "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" };

function useWW() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 480);
  useEffect(() => { const h = () => setW(window.innerWidth); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return w;
}

function Modal({ title, onClose, children }) {
  return <div style={S.over} onClick={onClose}><div style={S.modal} onClick={e => e.stopPropagation()}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}><h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{title}</h2><button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, padding: 4 }}><Ic d={I.x} /></button></div>{children}</div></div>;
}

function Pager({ page, total, setPage }) {
  const pages = Math.ceil(total / PER_PAGE);
  if (pages <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "14px 0" }}>
      <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ ...S.btnS, background: C.s2, color: page === 0 ? C.border : C.text, border: `1px solid ${C.border}`, padding: "7px 14px" }}>‹ Preth</button>
      <span style={{ fontSize: 13, color: C.dim, fontFamily: FM }}>{page + 1}/{pages}</span>
      <button onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} style={{ ...S.btnS, background: C.s2, color: page >= pages - 1 ? C.border : C.text, border: `1px solid ${C.border}`, padding: "7px 14px" }}>Sled ›</button>
    </div>
  );
}

function Login({ onLogin }) {
  const [u, setU] = useState(() => { try { return localStorage.getItem("ecom-rem-u") || ""; } catch { return ""; } });
  const [p, setP] = useState(() => { try { return localStorage.getItem("ecom-rem-p") || ""; } catch { return ""; } });
  const [err, setErr] = useState(""); const [sh, setSh] = useState(false);
  const [remember, setRemember] = useState(true); // default ON - aplikacija nikad ne izloguje pri refresh
  const go = () => {
    const user = USERS.find(x => x.username === u && x.password === p);
    if (user) {
      try {
        if (remember) { localStorage.setItem("ecom-rem-u", u); localStorage.setItem("ecom-rem-p", p); }
        else { localStorage.removeItem("ecom-rem-u"); localStorage.removeItem("ecom-rem-p"); }
      } catch {}
      onLogin(user);
    } else { setErr("Pogrešno ime ili lozinka"); setTimeout(() => setErr(""), 3e3); }
  };
  // Auto-login if credentials saved
  useEffect(() => {
    try {
      const su = localStorage.getItem("ecom-rem-u");
      const sp = localStorage.getItem("ecom-rem-p");
      if (su && sp) {
        const user = USERS.find(x => x.username === su && x.password === sp);
        if (user) onLogin(user);
      }
    } catch {}
  }, []);
  return <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: F }}><div style={{ width: "100%", maxWidth: 340 }}><div style={{ textAlign: "center", marginBottom: 36 }}><div style={{ fontSize: 44, fontWeight: 900, background: `linear-gradient(135deg,${C.accent},#ef4444)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>👟 eCom</div><div style={{ fontSize: 12, color: C.dim, marginTop: 4, letterSpacing: 3, textTransform: "uppercase" }}>Tracking System</div></div><div style={{ ...S.card, padding: 22 }}><Fl label="Korisničko ime"><input style={S.inp} value={u} onChange={e => setU(e.target.value)} placeholder="Ime..." onKeyDown={e => e.key === "Enter" && go()} /></Fl><Fl label="Lozinka"><div style={{ position: "relative" }}><input style={S.inp} type={sh ? "text" : "password"} value={p} onChange={e => setP(e.target.value)} placeholder="Lozinka..." onKeyDown={e => e.key === "Enter" && go()} /><button onClick={() => setSh(!sh)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 11, fontFamily: F }}>{sh ? "Sakrij" : "Prikaži"}</button></div></Fl>
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 14, padding: "6px 4px" }}>
      <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent, cursor: "pointer" }} />
      <span style={{ fontSize: 13, color: C.dim }}>Zapamti me na ovom uređaju</span>
    </label>
    {err && <div style={{ color: C.danger, fontSize: 13, marginBottom: 10, textAlign: "center" }}>{err}</div>}<button onClick={go} style={{ ...S.btn, width: "100%", padding: "13px", fontSize: 15 }}>Prijavi se</button></div></div></div>;
}

// ═══════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════
function OrdersPage({ data, setData, user, log }) {
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [filterSt, setFilterSt] = useState("all");
  const [filterW, setFilterW] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(0);
  const [idModal, setIdModal] = useState(null);
  const [pxModal, setPxModal] = useState(null);
  const [returModal, setReturModal] = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [bulkNedja, setBulkNedja] = useState(false);
  const [bulkSel, setBulkSel] = useState([]);
  const [undoData, setUndoData] = useState(null);
  const isA = user.role === "admin";

  const [paste, setPaste] = useState("");
  const ef = { name: "", address: "", city: "", phone: "", codAmount: "", models: [{ model: "", custom: "", size: "" }], note: "" };
  const [form, setForm] = useState(ef);

  const parsePaste = () => {
    const lines = paste.trim().split("\n").map(l => l.trim()).filter(Boolean);
    const u2 = {};
    if (lines[0]) u2.name = lines[0]; if (lines[1]) u2.address = lines[1];
    if (lines[2]) u2.city = lines[2]; if (lines[3]) u2.phone = lines[3];
    setForm(f => ({ ...f, ...u2 })); setPaste("");
  };

  const addModelSlot = () => setForm(f => ({ ...f, models: [...f.models, { model: "", custom: "", size: "" }] }));
  const rmModelSlot = i => setForm(f => ({ ...f, models: f.models.filter((_, j) => j !== i) }));
  const upModel = (i, k, v) => setForm(f => ({ ...f, models: f.models.map((m, j) => j === i ? { ...m, [k]: v } : m) }));

  const addOrder = () => {
    if (!form.name || !form.codAmount) return;
    const modelStr = form.models.map(m => { const n = m.model === "__custom" ? m.custom : m.model; return n ? (n + (m.size ? ` (${m.size})` : "")) : ""; }).filter(Boolean).join(" + ");
    const nd = { ...data };
    nd.orders.unshift({ id: uid(), name: form.name, address: form.address, city: form.city, phone: form.phone, codAmount: parseFloat(form.codAmount) || 0, model: modelStr, models: form.models.map(m => ({ name: m.model === "__custom" ? m.custom : m.model, size: m.size })), note: form.note, assignedTo: "", status: "novo", idBroj: "", pxBroj: "", returPostarina: 0, dateCreated: new Date().toISOString(), dateDelivered: null, dateReturned: null, archived: false });
    log(nd, `Nova: ${form.name}, ${modelStr}, ${fm(form.codAmount)}`);
    setData(nd); sv(nd); setShowNew(false); setForm(ef);
  };

  // ID
  const [idVal, setIdVal] = useState("");
  const [fromInv, setFromInv] = useState(false);
  const openId = o => { setIdVal(o.idBroj || ""); setFromInv(false); setIdModal(o); };
  const saveId = () => {
    if (!idVal.trim()) return;
    const nd = { ...data }; const i = nd.orders.findIndex(o => o.id === idModal.id);
    const w = user.role === "worker" ? user.username : (idModal.assignedTo || "Filip");
    // If from inventory, skip "uneto" — goes directly to "poslato_nedja" (displayed as "Spremno za slanje")
    const newStatus = fromInv ? "poslato_nedja" : "uneto";
    nd.orders[i] = { ...nd.orders[i], idBroj: idVal.trim(), assignedTo: w, status: newStatus, fromInventory: !!fromInv };

    // Decrement inventory if checked
    if (fromInv) {
      const order = nd.orders[i];
      const modelsArr = (order.models && order.models.length) ? order.models : [{ name: order.model, size: "" }];
      const decremented = [];
      modelsArr.forEach(m => {
        const tName = (m.name || "").toLowerCase().trim();
        const tSize = (m.size || "").toString().trim();
        let invIdx = nd.inventory.findIndex(inv => (inv.name || "").toLowerCase().trim() === tName && (inv.size || "").toString().trim() === tSize && parseInt(inv.quantity) > 0);
        if (invIdx < 0) invIdx = nd.inventory.findIndex(inv => (inv.name || "").toLowerCase().trim() === tName && parseInt(inv.quantity) > 0);
        if (invIdx >= 0) {
          const newQty = parseInt(nd.inventory[invIdx].quantity) - 1;
          nd.inventory[invIdx] = { ...nd.inventory[invIdx], quantity: newQty };
          decremented.push(`${nd.inventory[invIdx].name} vel.${nd.inventory[invIdx].size}=${newQty}`);
        }
      });
      if (decremented.length) log(nd, `Popis automatski -1: ${decremented.join(", ")} (${order.name})`);
    }

    log(nd, `ID: ${idVal.trim()}, ${nd.orders[i].name}, radnik: ${w}${fromInv ? " [iz popisa]" : ""}`);
    setData(nd); sv(nd); setIdModal(null);
  };

  // Bulk Nedja
  const unetoOrders = data.orders.filter(o => o.status === "uneto" && !o.archived);
  const sendBulk = () => {
    if (!bulkSel.length) return;
    const nd = { ...data };
    bulkSel.forEach(oid => { const i = nd.orders.findIndex(o => o.id === oid); if (i >= 0) nd.orders[i] = { ...nd.orders[i], status: "poslato_nedja" }; });
    log(nd, `Poslato po Nedji: ${bulkSel.length} pošiljki`);
    setData(nd); sv(nd); setBulkNedja(false); setBulkSel([]);
  };

  // PX
  const [pxVal, setPxVal] = useState("");
  const openPx = o => { setPxVal(o.pxBroj || ""); setPxModal(o); };
  const savePx = () => {
    if (!pxVal.trim()) return;
    const nd = { ...data }; const i = nd.orders.findIndex(o => o.id === pxModal.id);
    nd.orders[i] = { ...nd.orders[i], pxBroj: pxVal.trim(), status: "poslato_kupcu", datePx: nd.orders[i].datePx || new Date().toISOString() };
    log(nd, `PX: ${pxVal.trim()}, ${nd.orders[i].name}, zadužen ${nd.orders[i].assignedTo} za ${fm(nd.orders[i].codAmount)}`);
    setData(nd); sv(nd); setPxModal(null);
  };

  // Retur
  const [returVal, setReturVal] = useState("");
  const openRetur = o => { setReturVal(""); setReturModal(o); };
  const saveRetur = () => {
    const rp = parseFloat(returVal) || 0;
    const nd = { ...data }; const i = nd.orders.findIndex(o => o.id === returModal.id); const o = nd.orders[i];
    nd.orders[i] = { ...o, status: "odbijeno", returPostarina: rp, dateReturned: new Date().toISOString() };
    if (rp > 0) nd.finances.unshift({ id: uid(), type: "retur", worker: o.assignedTo, amount: rp, date: new Date().toISOString(), note: `Vraćena: ${o.name}, PX: ${o.pxBroj || "—"}` });
    log(nd, `Odbijeno: ${o.name}, retur: ${fm(rp)}, radnik: ${o.assignedTo}`);
    setData(nd); sv(nd); setReturModal(null);
  };

  // Admin status change
  const [newSt, setNewSt] = useState("");
  const openStatusModal = o => { setNewSt(o.status); setStatusModal(o); };
  const saveStatus = () => {
    const nd = { ...data }; const i = nd.orders.findIndex(o => o.id === statusModal.id);
    const old = nd.orders[i].status;
    nd.orders[i] = { ...nd.orders[i], status: newSt };
    if (newSt === "isporuceno") nd.orders[i].dateDelivered = new Date().toISOString();
    log(nd, `Admin status: ${ST[old]?.label} → ${ST[newSt]?.label} — ${statusModal.name}`);
    setData(nd); sv(nd); setStatusModal(null);
  };

  const setSt = (order, ns) => {
    if (ns === "odbijeno") { openRetur(order); return; }
    const nd = { ...data }; const i = nd.orders.findIndex(o => o.id === order.id);
    nd.orders[i] = { ...nd.orders[i], status: ns };
    if (ns === "isporuceno") nd.orders[i].dateDelivered = new Date().toISOString();
    log(nd, `Status: ${ST[nd.orders[i].status]?.label} → ${ST[ns]?.label} — ${order.name}`);
    setData(nd); sv(nd);
  };

  const archiveO = o => {
    const nd = { ...data }; const i = nd.orders.findIndex(x => x.id === o.id);
    nd.orders[i] = { ...nd.orders[i], archived: true };
    log(nd, `Arhivirano: ${o.name}`); setData(nd); sv(nd);
  };
  const deleteO = o => {
    if (!confirm(`Obriši: ${o.name}?`)) return;
    const nd = { ...data, orders: data.orders.filter(x => x.id !== o.id) };
    log(nd, `Obrisano: ${o.name}`); setData(nd); sv(nd);
  };

  // UNDO
  const wrapAction = (act, fn) => {
    if (user.role === "worker") {
      const prev = JSON.parse(JSON.stringify(data));
      fn(); setUndoData({ prevData: prev, action: act, time: Date.now() });
    } else fn();
  };
  const workerUndo = () => {
    if (!undoData) return;
    const nd = { ...undoData.prevData };
    nd.history.unshift({ id: uid(), action: `UNDO: ${user.username} poništio "${undoData.action}"`, user: user.username, date: new Date().toISOString() });
    setData(nd); sv(nd); setUndoData(null);
  };

  // Inventory matching
  const invLookup = useMemo(() => {
    const m = {};
    data.inventory.forEach(it => {
      const k = (it.name || "").toLowerCase().trim() + "|" + String(it.size || "").trim();
      if ((parseInt(it.quantity) || 0) > 0) m[k] = true;
    });
    return m;
  }, [data.inventory]);

  // Centralni registar rezervacija popisa: ide od najstarije porudžbine ka najnovijoj
  // i "dodeljuje" dostupne pare iz popisa. Svaka porudžbina dobija mapu "koji njeni pari su rezervisani".
  const invAllocation = useMemo(() => {
    const remaining = {};
    (data.inventory || []).forEach(it => {
      const k = (it.name || "").toLowerCase().trim() + "|" + String(it.size || "").trim();
      const qty = parseInt(it.quantity) || 0;
      if (qty > 0) remaining[k] = (remaining[k] || 0) + qty;
    });

    const candidates = (data.orders || [])
      .filter(o => o && !o.archived && o.status === "novo")
      .sort((a, b) => new Date(a.dateCreated || 0) - new Date(b.dateCreated || 0));

    const perOrder = {};
    for (const o of candidates) {
      if (!o || !o.id) continue;
      const items = (Array.isArray(o.models) && o.models.length) ? o.models : [{ name: o.model || "", size: "" }];
      const hits = [], misses = [];
      for (const m of items) {
        if (!m) continue;
        const k = (m.name || "").toLowerCase().trim() + "|" + String(m.size || "").trim();
        if ((remaining[k] || 0) > 0) {
          remaining[k]--;
          hits.push(m);
        } else {
          misses.push(m);
        }
      }
      perOrder[o.id] = { hits, misses };
    }
    return perOrder;
  }, [data.orders, data.inventory]);

  // Detailed inventory status — koristi alokaciju
  const invStatus = (o) => {
    if (!o) return { level: "none", hits: [], misses: [] };
    if (o.status !== "novo" || o.archived) {
      return { level: "none", hits: [], misses: [] };
    }
    const alloc = invAllocation[o.id];
    if (!alloc) return { level: "none", hits: [], misses: [] };
    const { hits, misses } = alloc;
    if (hits.length === 0) return { level: "none", hits, misses };
    if (misses.length === 0) return { level: "full", hits, misses };
    return { level: "partial", hits, misses };
  };

  const hasInInventory = o => invStatus(o).level !== "none";

  const active = data.orders.filter(o => !o.archived);
  const filtered = active.filter(o => {
    const q = search.toLowerCase();
    const ms = !search || o.name?.toLowerCase().includes(q) || o.pxBroj?.toLowerCase().includes(q) || o.phone?.includes(q) || o.idBroj?.toLowerCase().includes(q);
    const mst = filterSt === "all" || o.status === filterSt;
    const mw = filterW === "all" || o.assignedTo === filterW;
    return ms && mst && mw;
  });

  // Sort: inventory matches first
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aInv = hasInInventory(a) ? 0 : 1;
      const bInv = hasInInventory(b) ? 0 : 1;
      if (aInv !== bInv) return aInv - bInv;
      return new Date(b.dateCreated) - new Date(a.dateCreated);
    });
  }, [filtered, invAllocation]);

  const paged = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const getActs = o => {
    const a = [];
    if (o.status === "novo") a.push({ label: "📋 Unesi ID", fn: () => openId(o), color: C.purple });
    if (o.status === "poslato_nedja") a.push({ label: "📦 Pošalji i dodaj PX", fn: () => openPx(o), color: C.accent });
    if (o.status === "poslato_kupcu") {
      a.push({ label: "✅ Isporučeno", fn: () => wrapAction("Isporučeno " + o.name, () => setSt(o, "isporuceno")), color: C.success });
      a.push({ label: "❌ Odbijeno", fn: () => openRetur(o), color: C.danger });
    }
    if ((o.status === "isporuceno" || o.status === "odbijeno") && !o.archived) a.push({ label: "📁 Arhiviraj", fn: () => archiveO(o), color: C.dim });
    return a;
  };

  const stRow1 = [{ v: "all", l: "Sve" }, { v: "novo", l: "Za unos" }, { v: "uneto", l: "Uneto" }, { v: "poslato_nedja", l: "Po Nedji" }];
  const stRow2 = [{ v: "poslato_kupcu", l: "Poslato kupcu" }, { v: "isporuceno", l: "Isporučeno" }, { v: "odbijeno", l: "Odbijeno" }];

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      {user.role === "worker" && undoData && (Date.now() - undoData.time < 6e5) && (
        <div style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13 }}>↩️ <strong>{undoData.action}</strong></div>
          <button onClick={workerUndo} style={{ ...S.btnS, background: "#fb923c", color: "#000", border: "none", padding: "6px 14px" }}>UNDO</button>
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 10 }}>
        <input style={{ ...S.inp, paddingLeft: 36, fontSize: 13 }} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Ime, PX, telefon..." />
        <div style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}><Ic d={I.search} size={16} color={C.dim} /></div>
      </div>

      {/* Status - two rows */}
      <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
        {stRow1.map(f => <button key={f.v} onClick={() => { setFilterSt(f.v); setPage(0); }} style={{ ...S.btnS, flex: 1, background: filterSt === f.v ? C.accent : C.s2, color: filterSt === f.v ? "#000" : C.text, border: `1px solid ${filterSt === f.v ? C.accent : C.border}` }}>{f.l}</button>)}
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {stRow2.map(f => <button key={f.v} onClick={() => { setFilterSt(f.v); setPage(0); }} style={{ ...S.btnS, flex: 1, background: filterSt === f.v ? (ST[f.v]?.color || C.accent) : C.s2, color: filterSt === f.v ? "#000" : C.text, border: `1px solid ${filterSt === f.v ? (ST[f.v]?.color || C.accent) : C.border}` }}>{f.l}</button>)}
      </div>

      <div style={{ height: 1, background: C.border, margin: "14px 0 12px" }} />

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {["all", "Filip", "Mirela"].map(w => <button key={w} onClick={() => { setFilterW(w); setPage(0); }} style={{ ...S.btnS, flex: 1, background: filterW === w ? C.accentBg : C.s2, color: filterW === w ? C.accent : C.text, border: `1px solid ${filterW === w ? C.accent : C.border}` }}>{w === "all" ? "Svi" : w}</button>)}
      </div>

      {isA && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => { setForm(ef); setPaste(""); setShowNew(true); }} style={{ ...S.btn, flex: 1, padding: "10px" }}><Ic d={I.plus} size={16} color="#000" /> Nova</button>
          {unetoOrders.length > 0 && <button onClick={() => { setBulkNedja(true); setBulkSel([]); }} style={{ ...S.btn2, flex: 1, padding: "10px", color: "#fb923c", borderColor: "#fb923c44" }}>🚐 Nedja ({unetoOrders.length})</button>}
        </div>
      )}

      <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Prikazano: {sorted.length}</div>

      {paged.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}>📦 Nema rezultata</div>}

      {paged.map(o => {
        const st = getDispSt(o); const exp = expanded === o.id;
        const acts = getActs(o); const invS = invStatus(o); const inInv = invS.level !== "none";
        return (
          <div key={o.id} style={{ ...S.card, cursor: "pointer", borderColor: invS.level === "full" && !exp ? C.success + "55" : invS.level === "partial" && !exp ? "#fbbf2455" : exp ? C.accent + "44" : C.border }} onClick={() => setExpanded(exp ? null : o.id)}>
            {invS.level === "full" && <div style={{ background: C.successBg, color: C.success, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8, marginBottom: 8, display: "inline-block", border: `1px solid ${C.success}33` }}>📦 IMA SVE U POPISU — spremno za slanje</div>}
            {invS.level === "partial" && (
              <div style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 8, marginBottom: 8, border: `1px solid #fbbf2444`, lineHeight: 1.5 }}>
                ⚠️ DELIMIČNO U POPISU
                <div style={{ fontWeight: 500, marginTop: 3, color: C.text }}>
                  {invS.hits.map((h, i) => <span key={"h"+i} style={{ marginRight: 8, color: C.success }}>✅ {h.name} {h.size}</span>)}
                  {invS.misses.map((m, i) => <span key={"m"+i} style={{ marginRight: 8, color: C.danger }}>❌ {m.name} {m.size}</span>)}
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{o.name}</div><div style={{ fontSize: 12, color: C.dim, marginTop: 1 }}>{o.model || "—"}</div></div>
              <span style={S.badge(st.color, st.bg)}>{st.icon} {st.label}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: C.dim }}>{o.assignedTo || "—"} • {fd(o.dateCreated)}{o.pxBroj && <span style={{ color: C.accent }}> • PX:{o.pxBroj}</span>}</div>
              <div style={{ fontWeight: 800, fontFamily: FM, color: C.accent, fontSize: 14 }}>{fm(o.codAmount)}</div>
            </div>
            {exp && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, marginBottom: 12 }}>
                  <div><span style={{ color: C.dim }}>Tel:</span> {o.phone || "—"}</div>
                  <div><span style={{ color: C.dim }}>Mesto:</span> {o.city || "—"}</div>
                  <div style={{ gridColumn: "1/-1" }}><span style={{ color: C.dim }}>Adresa:</span> {o.address || "—"}</div>
                  <div><span style={{ color: C.dim }}>ID:</span> <span style={{ color: C.purple, fontWeight: 600 }}>{o.idBroj || "—"}</span></div>
                  <div><span style={{ color: C.dim }}>PX:</span> {o.pxBroj ? <a href={trackUrl(o.pxBroj)} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontWeight: 600, textDecoration: "underline", textDecorationStyle: "dotted" }} onClick={e => e.stopPropagation()}>{o.pxBroj}</a> : <span style={{ color: C.dim }}>—</span>}</div>
                  {o.dateDelivered && <div><span style={{ color: C.dim }}>Isporučeno:</span> {fd(o.dateDelivered)}</div>}
                  {o.status === "odbijeno" && <div><span style={{ color: C.dim }}>Retur:</span> <span style={{ color: C.danger }}>{fm(o.returPostarina)}</span></div>}
                  {o.note && <div style={{ gridColumn: "1/-1" }}><span style={{ color: C.dim }}>Napomena:</span> {o.note}</div>}
                </div>
                {acts.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>{acts.map((a, i) => <button key={i} onClick={a.fn} style={{ ...S.btnS, color: a.color, background: a.color + "18", border: `1px solid ${a.color}33`, padding: "8px 13px", fontSize: 13 }}>{a.label}</button>)}</div>}
                {isA && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => setEditModal(o)} style={{ ...S.btn2, flex: "1 1 calc(50% - 3px)", fontSize: 12 }}>✏️ Izmeni</button>
                  <button onClick={() => openStatusModal(o)} style={{ ...S.btn2, flex: "1 1 calc(50% - 3px)", fontSize: 12 }}>🔄 Status</button>
                  <button onClick={() => deleteO(o)} style={{ ...S.btnD, flex: "1 1 100%", fontSize: 12, justifyContent: "center" }}><Ic d={I.trash} size={14} color={C.danger} /> Obriši porudžbinu</button>
                </div>}
              </div>
            )}
          </div>
        );
      })}
      <Pager page={page} total={sorted.length} setPage={setPage} />

      {/* New Order */}
      {showNew && <Modal title="➕ Nova porudžbina" onClose={() => setShowNew(false)}>
        <div style={{ background: C.accentBg, border: `1px solid ${C.accent}33`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ ...S.lb, color: C.accent, marginBottom: 8 }}>⚡ BRZO LEPLJENJE</div>
          <textarea style={{ ...S.ta, minHeight: 75, fontSize: 13, background: C.s1 }} value={paste} onChange={e => setPaste(e.target.value)} placeholder={"Predrag Ristic\nCara Lazara 12\nBeograd\n065555555"} />
          <button onClick={parsePaste} style={{ ...S.btn, marginTop: 8, padding: "9px 16px", fontSize: 13, width: "100%" }}>📋 Popuni polja</button>
        </div>
        <Fl label="Ime i prezime *"><input style={S.inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ime Prezime" /></Fl>
        <Fl label="Adresa"><input style={S.inp} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Ulica i broj" /></Fl>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Fl label="Mesto"><input style={S.inp} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Grad" /></Fl><Fl label="Telefon"><input style={S.inp} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="06x..." type="tel" /></Fl></div>
        <Fl label="Otkupni iznos (RSD) *"><input style={S.inp} type="number" value={form.codAmount} onChange={e => setForm({ ...form, codAmount: e.target.value })} placeholder="3500" /></Fl>
        {form.models.map((m, idx) => (
          <div key={idx} style={{ background: idx > 0 ? C.s2 : "transparent", borderRadius: 10, padding: idx > 0 ? 12 : 0, marginBottom: 10, border: idx > 0 ? `1px solid ${C.border}` : "none" }}>
            {idx > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Patika #{idx + 1}</span><button onClick={() => rmModelSlot(idx)} style={{ ...S.btnS, background: C.dangerBg, color: C.danger, border: "none", padding: "3px 8px", fontSize: 11 }}>✕</button></div>}
            <Fl label={idx === 0 ? "Model patika" : "Model"}>
              <select style={S.sel} value={m.model} onChange={e => upModel(idx, "model", e.target.value)}><option value="">— Izaberi —</option>{data.models.map(md => <option key={md.id} value={md.name}>{md.name}</option>)}<option value="__custom">✏️ Ručno</option></select>
            </Fl>
            {m.model === "__custom" && <Fl label="Naziv"><input style={S.inp} value={m.custom} onChange={e => upModel(idx, "custom", e.target.value)} placeholder="Naziv..." /></Fl>}
            <Fl label="Broj patika"><input style={S.inp} value={m.size} onChange={e => upModel(idx, "size", e.target.value)} placeholder="42" /></Fl>
          </div>
        ))}
        <button onClick={addModelSlot} style={{ ...S.btn2, width: "100%", marginBottom: 12, fontSize: 13, color: C.accent, borderColor: C.accent + "44" }}>➕ Dodaj još pari patika</button>
        <Fl label="Napomena"><input style={S.inp} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Info..." /></Fl>
        <button onClick={addOrder} style={{ ...S.btn, width: "100%", marginTop: 4, padding: "13px", fontSize: 15 }}>Dodaj porudžbinu</button>
      </Modal>}

      {idModal && <Modal title="📋 Unesi ID broj" onClose={() => setIdModal(null)}>
        <div style={{ ...S.card, background: C.s2, marginBottom: 14 }}><div style={{ fontWeight: 700 }}>{idModal.name}</div><div style={{ fontSize: 13, color: C.dim }}>{idModal.model} • {fm(idModal.codAmount)}</div></div>
        {user.role === "worker" && <div style={{ background: C.infoBg, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>Dodeljuje se tebi — <strong>{user.username}</strong></div>}
        <Fl label="ID broj *"><input style={S.inp} value={idVal} onChange={e => setIdVal(e.target.value)} placeholder="ID broj..." autoFocus /></Fl>
        {hasInInventory(idModal) && (
          <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: 13, background: C.successBg, borderRadius: 10, border: `1px solid ${C.success}44`, marginBottom: 14 }}>
            <input type="checkbox" checked={fromInv} onChange={e => setFromInv(e.target.checked)} style={{ width: 20, height: 20, accentColor: C.success, cursor: "pointer", flexShrink: 0 }} />
            <div style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 700, color: C.success }}>📦 Ide iz popisa</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Automatski će umanjiti količinu u popisu za 1 po paru</div>
            </div>
          </label>
        )}
        {isA && <Fl label="Radnik"><select style={S.sel} defaultValue="Filip"><option value="Filip">Filip</option><option value="Mirela">Mirela</option></select></Fl>}
        <button onClick={() => wrapAction("ID " + idVal, saveId)} style={{ ...S.btn, width: "100%", padding: "13px", fontSize: 15 }}>Potvrdi</button>
      </Modal>}

      {pxModal && <Modal title="📮 Pošalji porudžbinu i dodaj PX broj" onClose={() => setPxModal(null)}>
        <div style={{ ...S.card, background: C.s2, marginBottom: 14 }}><div style={{ fontWeight: 700 }}>{pxModal.name}</div><div style={{ fontSize: 13, color: C.dim }}>ID: <span style={{ color: C.purple }}>{pxModal.idBroj}</span> • {pxModal.assignedTo}</div></div>
        <div style={{ background: C.accentBg, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, border: `1px solid ${C.accent}33` }}>⚠️ <strong>{pxModal.assignedTo}</strong> se zadužuje za <strong>{fm(pxModal.codAmount)}</strong></div>
        <Fl label="PX broj *"><input style={S.inp} value={pxVal} onChange={e => setPxVal(e.target.value)} placeholder="RR123456789RS" autoFocus /></Fl>
        <button onClick={() => wrapAction("PX " + pxVal, savePx)} style={{ ...S.btn, width: "100%", padding: "13px", fontSize: 15 }}>Potvrdi PX</button>
      </Modal>}

      {returModal && <Modal title="❌ Odbijeno" onClose={() => setReturModal(null)}>
        <div style={{ ...S.card, background: C.s2, marginBottom: 14 }}><div style={{ fontWeight: 700 }}>{returModal.name}</div><div style={{ fontSize: 13, color: C.dim }}>PX: {returModal.pxBroj || "—"} • {returModal.assignedTo} • {fm(returModal.codAmount)}</div></div>
        <div style={{ background: C.dangerBg, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>Otkupnina {fm(returModal.codAmount)} biće oduzeta iz zaduženja za {returModal.assignedTo}.</div>
        <Fl label="Retur poštarina (RSD)"><input style={S.inp} type="number" value={returVal} onChange={e => setReturVal(e.target.value)} placeholder="0" autoFocus /></Fl>
        <button onClick={() => wrapAction("Odbijeno " + returModal.name, saveRetur)} style={{ ...S.btnD, width: "100%", padding: "13px", fontSize: 15, background: C.danger, color: "#fff", border: "none" }}>Označi odbijeno</button>
      </Modal>}

      {statusModal && <Modal title="🔄 Promeni status" onClose={() => setStatusModal(null)}>
        <div style={{ ...S.card, background: C.s2, marginBottom: 14 }}><div style={{ fontWeight: 700 }}>{statusModal.name}</div><div style={{ fontSize: 13, color: C.dim }}>Trenutni: {ST[statusModal.status]?.label}</div></div>
        <Fl label="Novi status">
          <select style={S.sel} value={newSt} onChange={e => setNewSt(e.target.value)}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select>
        </Fl>
        <button onClick={saveStatus} style={{ ...S.btn, width: "100%", padding: "13px", fontSize: 15 }}>Sačuvaj status</button>
      </Modal>}

      {editModal && <EditOrderModal order={editModal} data={data} setData={setData} log={log} onClose={() => setEditModal(null)} />}

      {bulkNedja && <Modal title="🚐 Pošalji po Nedji" onClose={() => setBulkNedja(false)}>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 14 }}>Označi pošiljke. Uneto: {unetoOrders.length}</div>
        <button onClick={() => setBulkSel(bulkSel.length === unetoOrders.length ? [] : unetoOrders.map(o => o.id))} style={{ ...S.btn2, width: "100%", marginBottom: 12, fontSize: 13 }}>{bulkSel.length === unetoOrders.length ? "Odselektuj" : "Selektuj sve"}</button>
        <div style={{ maxHeight: 350, overflowY: "auto" }}>{unetoOrders.map(o => (
          <div key={o.id} onClick={() => setBulkSel(s => s.includes(o.id) ? s.filter(x => x !== o.id) : [...s, o.id])} style={{ ...S.card, cursor: "pointer", borderColor: bulkSel.includes(o.id) ? C.accent : C.border, background: bulkSel.includes(o.id) ? C.accentBg : C.s1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</div><div style={{ fontSize: 12, color: C.dim }}>{o.model} • {o.assignedTo}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontFamily: FM, fontWeight: 700, color: C.accent, fontSize: 13 }}>{fm(o.codAmount)}</span><div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${bulkSel.includes(o.id) ? C.accent : C.border}`, background: bulkSel.includes(o.id) ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{bulkSel.includes(o.id) && <Ic d={I.check} size={14} color="#000" />}</div></div>
          </div>))}</div>
        {bulkSel.length > 0 && <button onClick={sendBulk} style={{ ...S.btn, width: "100%", marginTop: 12, padding: "13px", fontSize: 15 }}>🚐 Pošalji {bulkSel.length}</button>}
      </Modal>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FINANCES
// ═══════════════════════════════════════════════════════════════
function FinancesPage({ data, setData, user, log }) {
  const [showAdd, setShowAdd] = useState(false);
  const [fType, setFType] = useState("uplata"); const [fWorker, setFWorker] = useState("Filip");
  const [fAmount, setFAmount] = useState(""); const [fDate, setFDate] = useState(tdy());
  const [fNote, setFNote] = useState(""); const [expandedW, setExpandedW] = useState(null);
  const isA = user.role === "admin";
  const [recPages, setRecPages] = useState({ Filip: 0, Mirela: 0 });

  const addFin = () => {
    if (!fAmount) return; const nd = { ...data };
    nd.finances.unshift({ id: uid(), type: fType, worker: fWorker, amount: parseFloat(fAmount), date: fDate ? new Date(fDate + "T12:00:00").toISOString() : new Date().toISOString(), note: fNote });
    log(nd, `Fin: ${FT[fType]?.label}, ${fWorker}, ${fm(fAmount)}${fNote ? ` — ${fNote}` : ""}`);
    setData(nd); sv(nd); setShowAdd(false); setFAmount(""); setFNote(""); setFType("uplata");
  };
  const delFin = f => { if (!confirm(`Obriši: ${fm(f.amount)}?`)) return; const nd = { ...data, finances: data.finances.filter(x => x.id !== f.id) }; log(nd, `Obrisan fin: ${f.worker}, ${fm(f.amount)}`); setData(nd); sv(nd); };

  const calc = w => {
    const wo = data.orders.filter(o => o.assignedTo === w);
    const sentOrders = wo.filter(o => o.pxBroj && o.status !== "odbijeno");
    const totalSent = sentOrders.reduce((s, o) => s + (o.codAmount || 0), 0);
    const sentCount = sentOrders.length;
    const totalDel = wo.filter(o => o.status === "isporuceno").reduce((s, o) => s + (o.codAmount || 0), 0);
    const totalPaid = data.finances.filter(f => f.worker === w && f.type === "uplata").reduce((s, f) => s + (f.amount || 0), 0);
    const totalRet = data.finances.filter(f => f.worker === w && f.type === "retur").reduce((s, f) => s + (f.amount || 0), 0);
    return { totalSent, sentCount, totalDel, totalPaid, totalRet, debt: totalDel - totalPaid - totalRet };
  };

  const WS = ({ name }) => {
    const s = calc(name); const exp = expandedW === name;
    const recs = data.finances.filter(f => f.worker === name).sort((a, b) => new Date(b.date) - new Date(a.date));
    const rp = recPages[name] || 0;
    const pagedRecs = recs.slice(rp * PER_PAGE, (rp + 1) * PER_PAGE);

    return (
      <div style={{ ...S.card, borderColor: exp ? C.accent + "44" : C.border }}>
        <div onClick={() => setExpandedW(exp ? null : name)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>{name === "Filip" ? "👨‍💼" : "👩‍💼"} {name}</span>
            <span style={{ fontSize: 12, color: C.dim, fontWeight: 500 }}>({s.sentCount} pošiljki)</span>
          </div>
          <span style={{ fontSize: 11, color: C.dim }}>{exp ? "▲" : "▼"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={S.stat}><div style={S.stL}>Ukupno poslato</div><div style={{ ...S.stV, fontSize: 15, color: C.info }}>{fm(s.totalSent)}</div></div>
          <div style={S.stat}><div style={S.stL}>Isporučeno</div><div style={{ ...S.stV, fontSize: 15, color: C.success }}>{fm(s.totalDel)}</div></div>
          <div style={S.stat}><div style={S.stL}>Uplaćeno</div><div style={{ ...S.stV, fontSize: 15, color: C.accent }}>{fm(s.totalPaid)}</div></div>
          <div style={{ ...S.stat, background: s.debt > 0 ? C.dangerBg : C.successBg }}><div style={S.stL}>Trenutni dug</div><div style={{ ...S.stV, fontSize: 15, color: s.debt > 0 ? C.danger : C.success }}>{fm(s.debt)}</div></div>
        </div>
        {s.totalRet > 0 && <div style={{ ...S.stat, marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ ...S.stL, margin: 0 }}>Retur poštarina</span><span style={{ fontWeight: 800, fontFamily: FM, fontSize: 14, color: C.danger }}>{fm(s.totalRet)}</span></div>}
        {exp && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Zapisi ({recs.length})</div>
            {recs.length === 0 && <div style={{ fontSize: 13, color: C.dim }}>Nema zapisa</div>}
            {pagedRecs.map(r => { const ft = FT[r.type] || FT.ostalo; return (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><span style={S.badge(ft.color, ft.color + "20")}>{ft.label}</span><span style={{ fontWeight: 700, fontFamily: FM, color: ft.color, fontSize: 14 }}>{fm(r.amount)}</span></div><div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>{fd(r.date)}{r.note ? ` • ${r.note}` : ""}</div></div>
                {isA && <button onClick={() => delFin(r)} style={{ ...S.btnD, padding: "5px 7px", marginLeft: 6, flexShrink: 0 }}><Ic d={I.trash} size={13} color={C.danger} /></button>}
              </div>); })}
            <Pager page={rp} total={recs.length} setPage={p => setRecPages(prev => ({ ...prev, [name]: p }))} />
          </div>
        )}
      </div>
    );
  };

  const f = calc("Filip"), m = calc("Mirela"); const td = f.debt + m.debt;
  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, border: `1px solid ${td > 0 ? C.danger + "33" : C.success + "33"}`, background: td > 0 ? C.dangerBg : C.successBg, borderRadius: 14, padding: 14 }}><div style={S.stL}>Ukupan dug</div><div style={{ ...S.stV, fontSize: 26, color: td > 0 ? C.danger : C.success }}>{fm(td)}</div></div>
      {isA && <button onClick={() => setShowAdd(true)} style={{ ...S.btn, width: "100%", marginBottom: 14, padding: "12px" }}><Ic d={I.plus} size={16} color="#000" /> Dodaj zapis</button>}
      <WS name="Filip" /><WS name="Mirela" />
      {showAdd && <Modal title="💰 Dodaj zapis" onClose={() => setShowAdd(false)}>
        <Fl label="Tip"><select style={S.sel} value={fType} onChange={e => setFType(e.target.value)}>{Object.entries(FT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Fl>
        <Fl label="Radnik"><select style={S.sel} value={fWorker} onChange={e => setFWorker(e.target.value)}><option value="Filip">Filip</option><option value="Mirela">Mirela</option></select></Fl>
        <Fl label="Iznos (RSD) *"><input style={S.inp} type="number" value={fAmount} onChange={e => setFAmount(e.target.value)} placeholder="20000" /></Fl>
        <Fl label="Datum"><input style={S.inp} type="date" value={fDate} onChange={e => setFDate(e.target.value)} /></Fl>
        <Fl label="Napomena"><input style={S.inp} value={fNote} onChange={e => setFNote(e.target.value)} placeholder="Uplata na račun..." /></Fl>
        <button onClick={addFin} style={{ ...S.btn, width: "100%", marginTop: 6, padding: "13px", fontSize: 15 }}>Dodaj</button>
      </Modal>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ARCHIVE
// ═══════════════════════════════════════════════════════════════
function ArchivePage({ data, setData, user, log }) {
  const [search, setSearch] = useState(""); const [pg, setPg] = useState(0); const [expanded, setExpanded] = useState(null);
  const archived = data.orders.filter(o => o.archived);
  const filtered = archived.filter(o => { const q = search.toLowerCase(); return !search || o.name?.toLowerCase().includes(q) || o.pxBroj?.toLowerCase().includes(q); });
  const paged = filtered.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
  const unarch = o => { const nd = { ...data }; const i = nd.orders.findIndex(x => x.id === o.id); nd.orders[i] = { ...nd.orders[i], archived: false }; log(nd, `Iz arhive: ${o.name}`); setData(nd); sv(nd); };

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, borderRadius: 14, border: `1px solid ${C.border}`, padding: 14 }}><div style={S.stL}>Arhiva</div><div style={{ ...S.stV, fontSize: 26, color: C.dim }}>{archived.length}</div></div>
      <div style={{ position: "relative", marginBottom: 14 }}><input style={{ ...S.inp, paddingLeft: 36, fontSize: 13 }} value={search} onChange={e => { setSearch(e.target.value); setPg(0); }} placeholder="Pretraži..." /><div style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}><Ic d={I.search} size={16} color={C.dim} /></div></div>
      {paged.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}>📁 Prazno</div>}
      {paged.map(o => { const st = getDispSt(o); const exp = expanded === o.id; return (
        <div key={o.id} style={{ ...S.card, opacity: 0.85, cursor: "pointer" }} onClick={() => setExpanded(exp ? null : o.id)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}><div><div style={{ fontWeight: 700, fontSize: 14 }}>{o.name}</div><div style={{ fontSize: 12, color: C.dim }}>{o.model}</div></div><span style={S.badge(st.color, st.bg)}>{st.icon} {st.label}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.dim }}><span>{o.assignedTo} • {fd(o.dateCreated)}</span><span style={{ fontWeight: 800, fontFamily: FM, color: C.accent }}>{fm(o.codAmount)}</span></div>
          {exp && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }} onClick={e => e.stopPropagation()}><button onClick={() => unarch(o)} style={{ ...S.btn2, width: "100%", fontSize: 12 }}>↩️ Vrati</button></div>}
        </div>); })}
      <Pager page={pg} total={filtered.length} setPage={setPg} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY — grouped by model
// ═══════════════════════════════════════════════════════════════
function InventoryPage({ data, setData, user, log }) {
  const isA = user.role === "admin";
  const [showAdd, setShowAdd] = useState(false); const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState("");
  const ef = { name: "", size: "", quantity: 1, note: "" }; const [form, setForm] = useState(ef);
  const saveIt = () => { if (!form.name) return; const nd = { ...data }; if (editItem) { const i = nd.inventory.findIndex(x => x.id === editItem.id); nd.inventory[i] = { ...nd.inventory[i], ...form, quantity: parseInt(form.quantity) || 0 }; log(nd, `Popis: ${form.name} vel.${form.size}=${form.quantity}`); } else { nd.inventory.unshift({ ...form, id: uid(), quantity: parseInt(form.quantity) || 0, dateAdded: new Date().toISOString() }); log(nd, `Popis+: ${form.name} vel.${form.size}=${form.quantity}`); } setData(nd); sv(nd); setShowAdd(false); };
  const delIt = it => { if (!confirm(`Obriši ${it.name} vel.${it.size}?`)) return; const nd = { ...data, inventory: data.inventory.filter(x => x.id !== it.id) }; log(nd, `Popis-: ${it.name} vel.${it.size}`); setData(nd); sv(nd); };
  const quickChangeQty = (it, delta) => {
    const nd = { ...data }; const i = nd.inventory.findIndex(x => x.id === it.id);
    const newQty = Math.max(0, (parseInt(nd.inventory[i].quantity) || 0) + delta);
    nd.inventory[i] = { ...nd.inventory[i], quantity: newQty };
    log(nd, `Popis ${delta > 0 ? "+" : ""}${delta}: ${it.name} vel.${it.size} = ${newQty}`);
    setData(nd); sv(nd);
  };

  const grouped = useMemo(() => {
    const g = {};
    data.inventory.forEach(it => {
      const name = (it.name || "(bez imena)").trim();
      if (!g[name]) g[name] = [];
      g[name].push(it);
    });
    Object.keys(g).forEach(k => {
      g[k].sort((a, b) => (parseInt(a.size) || 0) - (parseInt(b.size) || 0));
    });
    return g;
  }, [data.inventory]);

  const groupedFiltered = useMemo(() => {
    if (!search) return grouped;
    const q = search.toLowerCase();
    const out = {};
    Object.entries(grouped).forEach(([name, items]) => {
      if (name.toLowerCase().includes(q)) { out[name] = items; return; }
      const matchItems = items.filter(it => it.size?.toString().includes(q));
      if (matchItems.length) out[name] = matchItems;
    });
    return out;
  }, [grouped, search]);

  const tot = data.inventory.reduce((s, i) => s + (parseInt(i.quantity) || 0), 0);
  const modelCount = Object.keys(grouped).length;

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ ...S.stat, textAlign: "center", borderRadius: 14, border: `1px solid ${C.border}`, padding: 14 }}>
          <div style={S.stL}>Ukupno kom.</div>
          <div style={{ ...S.stV, fontSize: 24, color: C.accent }}>{tot}</div>
        </div>
        <div style={{ ...S.stat, textAlign: "center", borderRadius: 14, border: `1px solid ${C.border}`, padding: 14 }}>
          <div style={S.stL}>Modela</div>
          <div style={{ ...S.stV, fontSize: 24, color: C.info }}>{modelCount}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input style={{ ...S.inp, paddingLeft: 36, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži model ili veličinu..." />
          <div style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}><Ic d={I.search} size={16} color={C.dim} /></div>
        </div>
        {isA && <button onClick={() => { setForm(ef); setEditItem(null); setShowAdd(true); }} style={{ ...S.btn, padding: "10px 14px" }}><Ic d={I.plus} size={16} color="#000" /></button>}
      </div>

      {!isA && <div style={{ fontSize: 12, color: C.dim, textAlign: "center", marginBottom: 12, padding: "8px", background: C.s2, borderRadius: 8 }}>👁️ Pregled popisa — izmene može raditi samo administrator</div>}

      {Object.keys(groupedFiltered).length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}><div style={{ fontSize: 32, marginBottom: 6 }}>👟</div>Popis je prazan</div>}

      {Object.entries(groupedFiltered).sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => {
        const groupTotal = items.reduce((s, it) => s + (parseInt(it.quantity) || 0), 0);
        return (
          <div key={name} style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>👟 {name}</div>
              <span style={{ ...S.badge(C.accent, C.accentBg), fontSize: 12 }}>{groupTotal} kom.</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "6px 12px", alignItems: "center" }}>
              {items.map(it => {
                const qty = parseInt(it.quantity) || 0;
                return (
                  <div key={it.id} style={{ display: "contents" }}>
                    <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 14, color: C.dim, minWidth: 32 }}>{it.size || "—"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ height: 6, flex: 1, background: C.s2, borderRadius: 3, overflow: "hidden", maxWidth: 100 }}>
                        <div style={{ height: "100%", width: `${Math.min(100, qty * 20)}%`, background: qty > 0 ? C.accent : C.border, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontFamily: FM, fontWeight: 800, fontSize: 15, color: qty > 0 ? C.text : C.dim, minWidth: 22, textAlign: "right" }}>{qty}</span>
                    </div>
                    <div style={{ display: "flex", gap: 3 }}>
                      {isA ? <>
                        <button onClick={() => quickChangeQty(it, -1)} style={{ ...S.btnS, padding: "3px 9px", background: C.s2, border: `1px solid ${C.border}`, color: C.danger, fontWeight: 800 }}>−</button>
                        <button onClick={() => quickChangeQty(it, 1)} style={{ ...S.btnS, padding: "3px 9px", background: C.s2, border: `1px solid ${C.border}`, color: C.success, fontWeight: 800 }}>+</button>
                        <button onClick={() => { setForm({ name: it.name, size: it.size, quantity: it.quantity, note: it.note }); setEditItem(it); setShowAdd(true); }} style={{ ...S.btnS, padding: "3px 6px", background: C.s2, border: `1px solid ${C.border}` }}><Ic d={I.edit} size={12} /></button>
                        <button onClick={() => delIt(it)} style={{ ...S.btnS, padding: "3px 6px", background: C.dangerBg, border: "none" }}><Ic d={I.trash} size={12} color={C.danger} /></button>
                      </> : <span style={{ width: 8 }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            {items.some(it => it.note) && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.dim }}>
              {items.filter(it => it.note).map(it => <div key={it.id}>📝 vel.{it.size}: {it.note}</div>)}
            </div>}
          </div>
        );
      })}

      {showAdd && <Modal title={editItem ? "Izmeni stavku" : "Dodaj u popis"} onClose={() => setShowAdd(false)}>
        <Fl label="Naziv modela *"><input style={S.inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="RBK TGT" list="models-list" />
          <datalist id="models-list">{[...new Set(data.inventory.map(i => i.name))].map(n => <option key={n} value={n} />)}{data.models.map(m => <option key={m.id} value={m.name} />)}</datalist>
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Fl label="Veličina"><input style={S.inp} value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} placeholder="42" /></Fl>
          <Fl label="Količina"><input style={S.inp} type="number" min="0" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></Fl>
        </div>
        <Fl label="Napomena"><input style={S.inp} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Fl>
        <button onClick={saveIt} style={{ ...S.btn, width: "100%", marginTop: 6, padding: "13px", fontSize: 15 }}>{editItem ? "Sačuvaj" : "Dodaj"}</button>
      </Modal>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MORE / MODELS / HISTORY / PROFIT / EXPORT
// ═══════════════════════════════════════════════════════════════
function NabavkaPage({ data, goBack }) {
  // Generiši spisak: svi modeli+brojevi iz porudžbina sa statusom "novo" (Za unos),
  // preskačući one koji već postoje u popisu, sortirani od najstarije porudžbine
  const spisak = useMemo(() => {
    // Lookup popisa: map "model|size" → preostala količina
    const invRemaining = {};
    (data.inventory || []).forEach(it => {
      const k = (it.name || "").toLowerCase().trim() + "|" + String(it.size || "").trim();
      invRemaining[k] = (invRemaining[k] || 0) + (parseInt(it.quantity) || 0);
    });

    // Sve porudžbine Za unos, od najstarije
    const zaUnos = (data.orders || [])
      .filter(o => o.status === "novo" && !o.archived)
      .sort((a, b) => new Date(a.dateCreated || 0) - new Date(b.dateCreated || 0));

    // Grupisano po modelu, redosled dodavanja sačuvan
    const grouped = {}; // { "DRAGON": ["44", "45", "44", ...] }
    const order = []; // redosled pojavljivanja modela

    for (const o of zaUnos) {
      const items = (o.models && o.models.length) ? o.models : [{ name: o.model, size: "" }];
      for (const m of items) {
        const modelName = (m.name || "").trim();
        const size = String(m.size || "").trim();
        if (!modelName) continue;
        const k = modelName.toLowerCase() + "|" + size;
        // Ako popis ima taj par → preskoči i smanji brojač u popisu
        if ((invRemaining[k] || 0) > 0) {
          invRemaining[k]--;
          continue;
        }
        const key = modelName.toUpperCase();
        if (!grouped[key]) { grouped[key] = []; order.push(key); }
        grouped[key].push(size);
      }
    }
    return { grouped, order, total: order.reduce((s, k) => s + grouped[k].length, 0), dateStr: fd(new Date().toISOString()) };
  }, [data.orders, data.inventory]);

  const textVersion = useMemo(() => {
    const lines = [`🛍️ NABAVKA — ${spisak.dateStr}`, ""];
    for (const model of spisak.order) {
      lines.push(`${model}  ${spisak.grouped[model].join(" ")}`);
    }
    lines.push("", `Ukupno: ${spisak.total} pari`);
    return lines.join("\n");
  }, [spisak]);

  const copyList = () => {
    if (copyText(textVersion)) alert("✅ Spisak kopiran u clipboard");
    else alert("⚠️ Nije moguće kopirati");
  };

  const downloadJPG = () => {
    // Render u canvas pa izvezi kao JPG
    const padding = 40;
    const lineHeight = 44;
    const modelWidth = 260;
    const width = 900;
    const headerHeight = 90;
    const footerHeight = 70;
    const contentHeight = spisak.order.length * lineHeight;
    const height = headerHeight + contentHeight + footerHeight + padding * 2;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Pozadina
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Naslov
    ctx.fillStyle = "#0a0a0d";
    ctx.font = "bold 36px Arial, sans-serif";
    ctx.fillText(`🛍️ NABAVKA — ${spisak.dateStr}`, padding, padding + 40);

    // Linija ispod naslova
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padding, padding + 60);
    ctx.lineTo(width - padding, padding + 60);
    ctx.stroke();

    // Modeli
    let y = padding + headerHeight + 20;
    ctx.font = "bold 28px Arial, sans-serif";
    for (const model of spisak.order) {
      ctx.fillStyle = "#0a0a0d";
      ctx.fillText(model, padding, y);
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 30px 'Courier New', monospace";
      const sizes = spisak.grouped[model].join("  ");
      ctx.fillText(sizes, padding + modelWidth, y);
      ctx.font = "bold 28px Arial, sans-serif";
      y += lineHeight;
    }

    // Footer
    ctx.fillStyle = "#64748b";
    ctx.font = "20px Arial, sans-serif";
    ctx.fillText(`Ukupno: ${spisak.total} pari`, padding, height - padding - 20);
    ctx.font = "14px Arial, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`Generisano: ${new Date().toLocaleString("sr-RS")}`, padding, height - padding);

    // Download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Nabavka-${new Date().toISOString().slice(0, 10)}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/jpeg", 0.95);
  };

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <button onClick={goBack} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Nazad</button>

      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, borderRadius: 14, border: `1px solid #f59e0b33`, background: "rgba(245,158,11,0.08)", padding: 14 }}>
        <div style={S.stL}>🛍️ Ukupno za nabavku</div>
        <div style={{ ...S.stV, fontSize: 28, color: "#f59e0b" }}>{spisak.total} pari</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>Iz porudžbina "Za unos" koje nisu u popisu</div>
      </div>

      {spisak.total === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, ...S.card }}>
          ✅ Nema porudžbina za nabavku<br/>
          <span style={{ fontSize: 12 }}>Sve što je naručeno ili je već u popisu ili nije status "Za unos"</span>
        </div>
      ) : (
        <>
          <div style={{ ...S.card, padding: 18, marginBottom: 14, fontFamily: FM, fontSize: 14, lineHeight: 1.9 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.dim, marginBottom: 10, fontFamily: F }}>📋 Pregled — sortirano od najstarije porudžbine</div>
            {spisak.order.map(model => (
              <div key={model} style={{ display: "flex", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 800, minWidth: 130 }}>{model}</span>
                <span style={{ color: C.accent, fontWeight: 700, letterSpacing: 2 }}>{spisak.grouped[model].join("  ")}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={downloadJPG} style={{ ...S.btn, flex: 1, padding: "13px", fontSize: 14 }}>🖼️ Preuzmi JPG</button>
            <button onClick={copyList} style={{ ...S.btn2, flex: 1, padding: "13px", fontSize: 14 }}>📋 Kopiraj tekst</button>
          </div>
          <div style={{ fontSize: 11, color: C.dim, textAlign: "center", lineHeight: 1.5 }}>
            💡 Tip: "Kopiraj tekst" je zgodan za slanje preko Viber-a ili SMS-a
          </div>
        </>
      )}
    </div>
  );
}

function MorePage({ setPage, user, data }) {
  const now = Date.now();
  const THREE = 3 * 24 * 60 * 60 * 1000;
  const urgentCount = data.orders.filter(o => {
    if (o.archived || !o.pxBroj || o.status === "isporuceno" || o.status === "odbijeno") return false;
    const ref = o.datePx || o.dateCreated;
    return ref && (now - new Date(ref).getTime()) > THREE;
  }).length;

  const exportExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const sOrders = (data.orders || []).map(o => ({
        "Ime i prezime": o.name || "", "Adresa": o.address || "", "Mesto": o.city || "", "Telefon": o.phone || "",
        "Model": o.model || "", "Otkupni iznos": o.codAmount || 0,
        "ID broj": o.idBroj || "", "PX broj": o.pxBroj || "",
        "Status": ST[o.status]?.label || o.status, "Radnik": o.assignedTo || "",
        "Datum kreiranja": o.dateCreated ? fdt(o.dateCreated) : "",
        "Datum isporuke": o.dateDelivered ? fdt(o.dateDelivered) : "",
        "Retur poštarina": o.returPostarina || 0,
        "Iz popisa": o.fromInventory ? "Da" : "Ne",
        "Arhivirano": o.archived ? "Da" : "Ne",
        "Napomena": o.note || "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sOrders), "Porudžbine");

      const sFin = (data.finances || []).map(f => ({
        "Tip": FT[f.type]?.label || f.type, "Radnik": f.worker || "",
        "Iznos (RSD)": f.amount || 0, "Datum": f.date ? fdt(f.date) : "", "Napomena": f.note || "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sFin), "Finansije");

      const sInv = (data.inventory || []).map(i => ({
        "Model": i.name || "", "Veličina": i.size || "", "Količina": i.quantity || 0,
        "Napomena": i.note || "", "Datum dodavanja": i.dateAdded ? fdt(i.dateAdded) : "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sInv), "Popis");

      const sModels = (data.models || []).map(m => ({ "Naziv modela": m.name || "" }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sModels), "Modeli");

      const sCosts = (data.costs || []).map(c => ({ "Model": c.model || "", "Nabavna cena": c.price || 0 }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sCosts), "Nabavne cene");

      const sAds = (data.adSpend || []).map(a => ({ "Datum": a.date || "", "Iznos (RSD)": a.amount || 0 }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sAds), "Reklame");

      const sHist = (data.history || []).map(h => ({
        "Akcija": h.action || "", "Korisnik": h.user || "", "Datum": h.date ? fdt(h.date) : "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sHist), "Istorija");

      const fname = `eCom-Export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e) {
      console.error(e);
      alert("Greška pri izvozu: " + e.message);
    }
  };

  const items = user.role === "admin" ? [
    { id: "urgentno", icon: "⚠️", l: "Urgentno", d: "Više od 3 dana bez isporuke", badge: urgentCount },
    { id: "nabavka", icon: "🛍️", l: "Nabavka", d: "Spisak za kupovinu iz porudžbina" },
    { id: "models", icon: "👟", l: "Modeli patika", d: "Upravljaj modelima" },
    { id: "profit", icon: "📈", l: "Profit", d: "Zarada i troškovi" },
    { id: "history", icon: "📋", l: "Istorija", d: "Zapisi po danima" },
    { id: "export", icon: "📱", l: "Export brojeva", d: "Viber marketing" },
    { id: "__excel", icon: "📊", l: "Excel izvoz", d: "Izvezi sve tabele u .xlsx", action: exportExcel },
  ] : [];
  return <div style={{ padding: "14px 14px 20px" }}><div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>⚙️ Više</div>{items.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}>Nema dodatnih opcija</div>}{items.map(it => <div key={it.id} onClick={() => it.action ? it.action() : setPage(it.id)} style={{ ...S.card, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, borderColor: it.id === "urgentno" && it.badge > 0 ? C.danger + "55" : C.border }}><div style={{ fontSize: 28 }}>{it.icon}</div><div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{it.l}</div><div style={{ fontSize: 12, color: C.dim }}>{it.d}</div></div>{it.badge > 0 && <span style={{ ...S.badge(C.danger, C.dangerBg), fontSize: 13, fontWeight: 800, padding: "4px 12px" }}>{it.badge}</span>}</div>)}</div>;
}

function ModelsPage({ data, setData, log, goBack }) {
  const [showAdd, setShowAdd] = useState(false); const [name, setName] = useState("");
  const [editId, setEditId] = useState(null); const [editName, setEditName] = useState("");
  const add = () => { if (!name.trim()) return; const nd = { ...data }; nd.models.push({ id: uid(), name: name.trim() }); log(nd, `Model+: ${name.trim()}`); setData(nd); sv(nd); setName(""); setShowAdd(false); };
  const del = m => { if (!confirm(`Obriši?`)) return; const nd = { ...data, models: data.models.filter(x => x.id !== m.id) }; log(nd, `Model-: ${m.name}`); setData(nd); sv(nd); };
  const save = () => { if (!editName.trim()) return; const nd = { ...data }; const i = nd.models.findIndex(m => m.id === editId); nd.models[i] = { ...nd.models[i], name: editName.trim() }; log(nd, `Model: ${editName.trim()}`); setData(nd); sv(nd); setEditId(null); };
  return <div style={{ padding: "14px 14px 20px" }}><button onClick={goBack} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Nazad</button><button onClick={() => { setName(""); setShowAdd(true); }} style={{ ...S.btn, width: "100%", marginBottom: 14, padding: "12px" }}><Ic d={I.plus} size={16} color="#000" /> Dodaj</button>{data.models.map(m => <div key={m.id} style={S.card}>{editId === m.id ? <div style={{ display: "flex", gap: 8 }}><input style={{ ...S.inp, flex: 1 }} value={editName} onChange={e => setEditName(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && save()} /><button onClick={save} style={{ ...S.btnS, background: C.successBg, color: C.success, border: "none", padding: "8px" }}><Ic d={I.check} size={14} color={C.success} /></button></div> : <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>👟 {m.name}</span><div style={{ display: "flex", gap: 5 }}><button onClick={() => { setEditId(m.id); setEditName(m.name); }} style={{ ...S.btnS, padding: 5, background: C.s2, border: `1px solid ${C.border}` }}><Ic d={I.edit} size={14} /></button><button onClick={() => del(m)} style={{ ...S.btnS, padding: 5, background: C.dangerBg, border: "none" }}><Ic d={I.trash} size={14} color={C.danger} /></button></div></div>}</div>)}{showAdd && <Modal title="👟 Dodaj model" onClose={() => setShowAdd(false)}><Fl label="Naziv *"><input style={S.inp} value={name} onChange={e => setName(e.target.value)} placeholder="Nike Air Max 90" autoFocus onKeyDown={e => e.key === "Enter" && add()} /></Fl><button onClick={add} style={{ ...S.btn, width: "100%", marginTop: 6, padding: "13px", fontSize: 15 }}>Dodaj</button></Modal>}</div>;
}

function HistoryPage({ data, goBack }) {
  const [selDate, setSelDate] = useState(tdy()); const [search, setSearch] = useState(""); const [pg, setPg] = useState(0);
  const fourM = new Date(); fourM.setMonth(fourM.getMonth() - 4);
  const valid = data.history.filter(h => new Date(h.date) >= fourM);
  const dayLogs = valid.filter(h => dk(h.date) === selDate);
  const filtered = dayLogs.filter(h => !search || h.action?.toLowerCase().includes(search.toLowerCase()));
  const paged = filtered.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
  const daysSet = useMemo(() => { const s = new Set(); valid.forEach(h => s.add(dk(h.date))); return s; }, [valid]);
  const [calM, setCalM] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const calDays = useMemo(() => { const f = new Date(calM.y, calM.m, 1); const last = new Date(calM.y, calM.m + 1, 0).getDate(); const dow = f.getDay() || 7; const d = []; for (let i = 1; i < dow; i++) d.push(null); for (let i = 1; i <= last; i++) d.push(i); return d; }, [calM]);
  const mn = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Avg", "Sep", "Okt", "Nov", "Dec"];
  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <button onClick={goBack} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Nazad</button>
      <div style={{ ...S.card, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button onClick={() => setCalM(c => { const d = new Date(c.y, c.m - 1); return { y: d.getFullYear(), m: d.getMonth() }; })} style={{ ...S.btnS, padding: "4px 10px", background: C.s2, border: `1px solid ${C.border}` }}>‹</button>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{mn[calM.m]} {calM.y}</div>
          <button onClick={() => setCalM(c => { const d = new Date(c.y, c.m + 1); return { y: d.getFullYear(), m: d.getMonth() }; })} style={{ ...S.btnS, padding: "4px 10px", background: C.s2, border: `1px solid ${C.border}` }}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, textAlign: "center" }}>
          {["P", "U", "S", "Č", "P", "S", "N"].map((d, i) => <div key={i} style={{ fontSize: 10, color: C.dim, fontWeight: 700, padding: 4 }}>{d}</div>)}
          {calDays.map((d, i) => {
            if (!d) return <div key={i} />;
            const dks = `${calM.y}-${String(calM.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const has = daysSet.has(dks); const sel = dks === selDate; const td2 = dks === tdy();
            return <button key={i} onClick={() => { setSelDate(dks); setPg(0); }} style={{ padding: 6, fontSize: 13, fontWeight: sel ? 800 : has ? 600 : 400, background: sel ? C.accent : "transparent", color: sel ? "#000" : has ? C.accent : td2 ? C.text : C.dim, borderRadius: 8, border: td2 && !sel ? `1px solid ${C.accent}44` : "none", cursor: "pointer", fontFamily: F, position: "relative" }}>{d}{has && !sel && <div style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: C.accent }} />}</button>;
          })}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>📋 {fd(selDate + "T00:00:00")} — {dayLogs.length} zapisa</div>
      <div style={{ position: "relative", marginBottom: 12 }}><input style={{ ...S.inp, paddingLeft: 36, fontSize: 13 }} value={search} onChange={e => { setSearch(e.target.value); setPg(0); }} placeholder="Pretraži..." /><div style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}><Ic d={I.search} size={16} color={C.dim} /></div></div>
      {paged.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.dim }}>Nema zapisa</div>}
      {paged.map((h, i) => <div key={h.id || i} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{h.action}</div><div style={{ fontSize: 11, color: C.dim }}>{h.user} • {fdt(h.date)}</div></div>)}
      <Pager page={pg} total={filtered.length} setPage={setPg} />
    </div>
  );
}

function ProfitPage({ data, setData, log, goBack }) {
  const [tab, setTab] = useState("main");
  const [showCost, setShowCost] = useState(false); const [cm, setCm] = useState(""); const [cp, setCp] = useState("");
  const [showAd, setShowAd] = useState(false); const [ad, setAd] = useState(tdy()); const [aa, setAa] = useState("");
  const addC = () => { if (!cm || !cp) return; const nd = { ...data }; nd.costs.push({ id: uid(), model: cm, price: parseFloat(cp) }); log(nd, `Cena: ${cm}=${fm(cp)}`); setData(nd); sv(nd); setShowCost(false); setCm(""); setCp(""); };
  const delC = c => { if (!confirm(`Obriši nabavnu cenu za ${c.model} (${fm(c.price)})?`)) return; const nd = { ...data, costs: data.costs.filter(x => x.id !== c.id) }; log(nd, `Obrisana nabavna cena: ${c.model}, ${fm(c.price)}`); setData(nd); sv(nd); };
  const addA = () => { if (!aa) return; const nd = { ...data }; nd.adSpend.push({ id: uid(), date: ad, amount: parseFloat(aa) }); log(nd, `Reklame ${ad}: ${fm(aa)}`); setData(nd); sv(nd); setShowAd(false); setAa(""); };
  const delA = a => { if (!confirm(`Obriši zapis reklame od ${fm(a.amount)} (${fd(a.date + "T00:00:00")})?`)) return; const nd = { ...data, adSpend: data.adSpend.filter(x => x.id !== a.id) }; log(nd, `Obrisana reklama: ${fd(a.date + "T00:00:00")}, ${fm(a.amount)}`); setData(nd); sv(nd); };

  const getCost = ms => { let t = 0; for (const c of data.costs) { if (ms?.toLowerCase().includes(c.model.toLowerCase())) t += c.price; } return t; };
  const daily = useMemo(() => {
    const d = {}; data.orders.forEach(o => { if (o.status === "odbijeno") return; const k = dk(o.dateCreated); if (!d[k]) d[k] = { rev: 0, cost: 0, ads: 0, n: 0 }; d[k].rev += o.codAmount || 0; d[k].cost += getCost(o.model); d[k].n++; });
    data.adSpend.forEach(a => { const k = a.date; if (!d[k]) d[k] = { rev: 0, cost: 0, ads: 0, n: 0 }; d[k].ads += a.amount || 0; });
    return Object.entries(d).sort((a, b) => b[0].localeCompare(a[0])).map(([date, v]) => ({ date, ...v, profit: v.rev - v.cost - v.ads }));
  }, [data.orders, data.adSpend, data.costs]);
  const totP = daily.reduce((s, d) => s + d.profit, 0);
  const totR = daily.reduce((s, d) => s + d.rev, 0);
  const totC = daily.reduce((s, d) => s + d.cost, 0);
  const totA = daily.reduce((s, d) => s + d.ads, 0);
  const [pg, setPg] = useState(0);
  const pagedD = daily.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);

  if (tab === "costs") return <div style={{ padding: "14px 14px 20px" }}><button onClick={() => setTab("main")} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Profit</button><button onClick={() => setShowCost(true)} style={{ ...S.btn, width: "100%", marginBottom: 14, padding: "12px" }}><Ic d={I.plus} size={16} color="#000" /> Dodaj cenu</button>{data.costs.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}>💰 Nema zapisa</div>}{data.costs.map(c => <div key={c.id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontWeight: 700 }}>{c.model}</div><div style={{ fontSize: 13, color: C.accent, fontFamily: FM, fontWeight: 700 }}>{fm(c.price)}</div></div><button onClick={() => delC(c)} style={{ ...S.btnD, padding: "5px 7px" }}><Ic d={I.trash} size={14} color={C.danger} /></button></div>)}{showCost && <Modal title="Nabavna cena" onClose={() => setShowCost(false)}><Fl label="Model"><select style={S.sel} value={cm} onChange={e => setCm(e.target.value)}><option value="">—</option>{data.models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select></Fl><Fl label="Cena (RSD) *"><input style={S.inp} type="number" value={cp} onChange={e => setCp(e.target.value)} placeholder="1500" /></Fl><button onClick={addC} style={{ ...S.btn, width: "100%", padding: "13px", fontSize: 15 }}>Sačuvaj</button></Modal>}</div>;

  if (tab === "ads") {
    const adsSorted = [...(data.adSpend || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return <div style={{ padding: "14px 14px 20px" }}>
      <button onClick={() => setTab("main")} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Profit</button>
      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, borderRadius: 14, border: `1px solid #fb923c33`, background: "rgba(251,146,60,0.08)", padding: 14 }}>
        <div style={S.stL}>Ukupno reklame</div>
        <div style={{ ...S.stV, fontSize: 24, color: "#fb923c" }}>{fm(adsSorted.reduce((s, a) => s + (a.amount || 0), 0))}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{adsSorted.length} zapisa</div>
      </div>
      <button onClick={() => setShowAd(true)} style={{ ...S.btn, width: "100%", marginBottom: 14, padding: "12px" }}><Ic d={I.plus} size={16} color="#000" /> Dodaj reklamu</button>
      {adsSorted.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}>📢 Nema zapisa reklama</div>}
      {adsSorted.map(a => <div key={a.id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{fd(a.date + "T00:00:00")}</div>
          <div style={{ fontSize: 14, color: "#fb923c", fontFamily: FM, fontWeight: 700, marginTop: 2 }}>{fm(a.amount)}</div>
        </div>
        <button onClick={() => delA(a)} style={{ ...S.btnD, padding: "7px 10px" }}><Ic d={I.trash} size={14} color={C.danger} /></button>
      </div>)}
      {showAd && <Modal title="📢 Nova reklama" onClose={() => setShowAd(false)}><Fl label="Datum"><input style={S.inp} type="date" value={ad} onChange={e => setAd(e.target.value)} /></Fl><Fl label="Iznos *"><input style={S.inp} type="number" value={aa} onChange={e => setAa(e.target.value)} placeholder="5000" /></Fl><button onClick={addA} style={{ ...S.btn, width: "100%", marginTop: 6, padding: "13px", fontSize: 15 }}>Sačuvaj</button></Modal>}
    </div>;
  }

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <button onClick={goBack} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Nazad</button>
      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, borderRadius: 14, border: `1px solid ${totP > 0 ? C.success + "33" : C.danger + "33"}`, background: totP > 0 ? C.successBg : C.dangerBg, padding: 16 }}><div style={S.stL}>Ukupan profit</div><div style={{ ...S.stV, fontSize: 28, color: totP > 0 ? C.success : C.danger }}>{fm(totP)}</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}><div style={S.stat}><div style={S.stL}>Otkup</div><div style={{ ...S.stV, fontSize: 14, color: C.info }}>{fm(totR)}</div></div><div style={S.stat}><div style={S.stL}>Nabavka</div><div style={{ ...S.stV, fontSize: 14, color: C.danger }}>{fm(totC)}</div></div><div style={S.stat}><div style={S.stL}>Reklame</div><div style={{ ...S.stV, fontSize: 14, color: "#fb923c" }}>{fm(totA)}</div></div></div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><button onClick={() => setTab("costs")} style={{ ...S.btn2, flex: 1, fontSize: 13 }}>💰 Nabavne cene</button><button onClick={() => setTab("ads")} style={{ ...S.btn2, flex: 1, fontSize: 13, color: "#fb923c", borderColor: "#fb923c44" }}>📢 Reklame</button></div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>📊 Dnevni pregled</div>
      {pagedD.map(d => <div key={d.date} style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{fd(d.date + "T00:00:00")}</div><div style={{ fontWeight: 800, fontFamily: FM, fontSize: 15, color: d.profit > 0 ? C.success : C.danger }}>{fm(d.profit)}</div></div><div style={{ display: "flex", gap: 12, fontSize: 12, color: C.dim, flexWrap: "wrap" }}><span>Otkup: {fm(d.rev)}</span><span>Nabavka: {fm(d.cost)}</span>{d.ads > 0 && <span>Reklame: {fm(d.ads)}</span>}<span>{d.n} nar.</span></div></div>)}
      <Pager page={pg} total={daily.length} setPage={setPg} />
      {showAd && <Modal title="📢 Reklame" onClose={() => setShowAd(false)}><Fl label="Datum"><input style={S.inp} type="date" value={ad} onChange={e => setAd(e.target.value)} /></Fl><Fl label="Iznos *"><input style={S.inp} type="number" value={aa} onChange={e => setAa(e.target.value)} placeholder="5000" /></Fl><button onClick={addA} style={{ ...S.btn, width: "100%", marginTop: 6, padding: "13px", fontSize: 15 }}>Sačuvaj</button></Modal>}
    </div>
  );
}

function ExportPage({ data, goBack }) {
  const [copied, setCopied] = useState("");
  const fmtPhone = p => { if (!p) return null; let c = p.replace(/[\s\-\(\)]/g, ""); if (c.startsWith("+381")) return c; if (c.startsWith("00381")) return "+" + c.slice(2); if (c.startsWith("0")) return "+381" + c.slice(1); return "+381" + c; };
  const contacts = useMemo(() => { const m = {}; data.orders.forEach(o => { if (!o.phone) return; const n = fmtPhone(o.phone); if (!n) return; if (!m[n]) m[n] = { phone: n, name: o.name }; }); return Object.values(m).sort((a, b) => a.name.localeCompare(b.name)); }, [data.orders]);
  const [pg, setPg] = useState(0);
  const paged = contacts.slice(pg * 30, (pg + 1) * 30);

  const doCopy = (type) => {
    const text = type === "phones" ? contacts.map(c => c.phone).join("\n") : contacts.map(c => `${c.phone}\t${c.name}`).join("\n");
    const ok = copyText(text);
    setCopied(ok ? `✅ Kopirano ${contacts.length} ${type === "phones" ? "brojeva" : "kontakata"}!` : "❌ Greška pri kopiranju");
    setTimeout(() => setCopied(""), 3000);
  };

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <button onClick={goBack} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Nazad</button>
      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, borderRadius: 14, border: `1px solid ${C.border}`, padding: 14 }}><div style={S.stL}>Kontakti za Viber</div><div style={{ ...S.stV, fontSize: 26, color: C.accent }}>{contacts.length}</div></div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => doCopy("phones")} style={{ ...S.btn, flex: 1, padding: "10px", fontSize: 13 }}>📋 Samo brojevi</button>
        <button onClick={() => doCopy("both")} style={{ ...S.btn2, flex: 1, padding: "10px", fontSize: 13 }}>📋 Brojevi + Imena</button>
      </div>
      {copied && <div style={{ background: C.successBg, color: C.success, padding: "10px 14px", borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: "center", fontWeight: 700 }}>{copied}</div>}
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>Format: +381XXXXXXXXX</div>
      {paged.map((c, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}><span>{c.name}</span><span style={{ fontFamily: FM, color: C.accent, fontSize: 12 }}>{c.phone}</span></div>)}
      <Pager page={pg} total={contacts.length} setPage={p => setPg(p)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EDIT ORDER MODAL (admin only)
// ═══════════════════════════════════════════════════════════════
function EditOrderModal({ order, data, setData, log, onClose }) {
  const [form, setForm] = useState(() => ({
    name: order.name || "", address: order.address || "", city: order.city || "", phone: order.phone || "",
    codAmount: order.codAmount || "", note: order.note || "",
    assignedTo: order.assignedTo || "", idBroj: order.idBroj || "", pxBroj: order.pxBroj || "",
    models: order.models && order.models.length ? order.models.map(m => ({ model: m.name || "", custom: "", size: m.size || "" })) : [{ model: "", custom: "", size: "" }],
  }));

  const addSlot = () => setForm(f => ({ ...f, models: [...f.models, { model: "", custom: "", size: "" }] }));
  const rmSlot = i => setForm(f => ({ ...f, models: f.models.filter((_, j) => j !== i) }));
  const upM = (i, k, v) => setForm(f => ({ ...f, models: f.models.map((m, j) => j === i ? { ...m, [k]: v } : m) }));

  const save = () => {
    if (!form.name || !form.codAmount) return;
    const modelStr = form.models.map(m => { const n = m.model === "__custom" ? m.custom : m.model; return n ? (n + (m.size ? ` (${m.size})` : "")) : ""; }).filter(Boolean).join(" + ");
    const nd = { ...data }; const i = nd.orders.findIndex(o => o.id === order.id);
    nd.orders[i] = { ...nd.orders[i], name: form.name, address: form.address, city: form.city, phone: form.phone, codAmount: parseFloat(form.codAmount) || 0, note: form.note, assignedTo: form.assignedTo, idBroj: form.idBroj, pxBroj: form.pxBroj, model: modelStr, models: form.models.map(m => ({ name: m.model === "__custom" ? m.custom : m.model, size: m.size })) };
    log(nd, `Admin izmena porudžbine: ${form.name}`);
    setData(nd); sv(nd); onClose();
  };

  return <Modal title="✏️ Izmeni porudžbinu" onClose={onClose}>
    <Fl label="Ime i prezime *"><input style={S.inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Fl>
    <Fl label="Adresa"><input style={S.inp} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Fl>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <Fl label="Mesto"><input style={S.inp} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></Fl>
      <Fl label="Telefon"><input style={S.inp} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} type="tel" /></Fl>
    </div>
    <Fl label="Otkupni iznos (RSD) *"><input style={S.inp} type="number" value={form.codAmount} onChange={e => setForm({ ...form, codAmount: e.target.value })} /></Fl>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <Fl label="Radnik"><select style={S.sel} value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })}><option value="">—</option><option value="Filip">Filip</option><option value="Mirela">Mirela</option></select></Fl>
      <Fl label="ID broj"><input style={S.inp} value={form.idBroj} onChange={e => setForm({ ...form, idBroj: e.target.value })} /></Fl>
    </div>
    <Fl label="PX broj"><input style={S.inp} value={form.pxBroj} onChange={e => setForm({ ...form, pxBroj: e.target.value })} /></Fl>
    {form.models.map((m, idx) => (
      <div key={idx} style={{ background: idx > 0 ? C.s2 : "transparent", borderRadius: 10, padding: idx > 0 ? 12 : 0, marginBottom: 10, border: idx > 0 ? `1px solid ${C.border}` : "none" }}>
        {idx > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>Patika #{idx + 1}</span><button onClick={() => rmSlot(idx)} style={{ ...S.btnS, background: C.dangerBg, color: C.danger, border: "none", padding: "3px 8px", fontSize: 11 }}>✕</button></div>}
        <Fl label={idx === 0 ? "Model patika" : "Model"}>
          <select style={S.sel} value={m.model} onChange={e => upM(idx, "model", e.target.value)}><option value="">— Izaberi —</option>{data.models.map(md => <option key={md.id} value={md.name}>{md.name}</option>)}<option value="__custom">✏️ Ručno</option></select>
        </Fl>
        {m.model === "__custom" && <Fl label="Naziv"><input style={S.inp} value={m.custom} onChange={e => upM(idx, "custom", e.target.value)} /></Fl>}
        <Fl label="Broj patika"><input style={S.inp} value={m.size} onChange={e => upM(idx, "size", e.target.value)} /></Fl>
      </div>
    ))}
    <button onClick={addSlot} style={{ ...S.btn2, width: "100%", marginBottom: 12, fontSize: 13, color: C.accent, borderColor: C.accent + "44" }}>➕ Dodaj još pari patika</button>
    <Fl label="Napomena"><input style={S.inp} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Fl>
    <button onClick={save} style={{ ...S.btn, width: "100%", marginTop: 4, padding: "13px", fontSize: 15 }}>💾 Sačuvaj izmene</button>
  </Modal>;
}

// ═══════════════════════════════════════════════════════════════
// URGENTNO PAGE (admin only)
// ═══════════════════════════════════════════════════════════════
function UrgentnoPage({ data, setData, user, log, goBack }) {
  const [expanded, setExpanded] = useState(null);
  const [notifPerm, setNotifPerm] = useState(() => notifPermission());
  const now = Date.now();
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

  const urgent = useMemo(() => {
    return data.orders.filter(o => {
      if (o.archived) return false;
      if (!o.pxBroj) return false;
      if (o.status === "isporuceno" || o.status === "odbijeno") return false;
      const ref = o.datePx || o.dateCreated;
      if (!ref) return false;
      return (now - new Date(ref).getTime()) > THREE_DAYS;
    }).map(o => {
      const ref = o.datePx || o.dateCreated;
      const daysAgo = Math.floor((now - new Date(ref).getTime()) / (24 * 60 * 60 * 1000));
      return { ...o, daysAgo };
    }).sort((a, b) => b.daysAgo - a.daysAgo);
  }, [data.orders]);

  const markCalled = o => {
    const nd = { ...data }; const i = nd.orders.findIndex(x => x.id === o.id);
    nd.orders[i] = { ...nd.orders[i], calledAt: new Date().toISOString(), calledBy: user.username };
    log(nd, `Pozvan kupac: ${o.name}, tel: ${o.phone}`);
    setData(nd); sv(nd);
  };

  const enableNotif = async () => {
    const result = await requestNotifPerm();
    setNotifPerm(result);
    if (result === "granted") {
      showNotif("✅ Notifikacije uključene", "Dobijaćeš obaveštenje za urgentne porudžbine.", "test");
    }
  };

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <button onClick={goBack} style={{ ...S.btn2, marginBottom: 14, fontSize: 13 }}>← Nazad</button>

      {/* Notif permission bar */}
      {notifSupported() && notifPerm !== "granted" && (
        <div style={{ ...S.card, background: notifPerm === "denied" ? C.dangerBg : C.infoBg, borderColor: notifPerm === "denied" ? C.danger + "44" : C.info + "44", padding: 14 }}>
          {notifPerm === "denied" ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.danger, marginBottom: 6 }}>🔕 Notifikacije blokirane</div>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5 }}>Notifikacije su blokirane u browseru. Da ih uključiš: klikni katanac/info ikonu levo od adrese sajta → Notifications → Allow.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>🔔 Uključi notifikacije</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 10, lineHeight: 1.5 }}>Dobijaj obaveštenje čim se neka porudžbina ne isporuči u roku od 3 dana.</div>
              <button onClick={enableNotif} style={{ ...S.btn, padding: "9px 16px", fontSize: 13, width: "100%" }}>🔔 Uključi notifikacije</button>
            </>
          )}
        </div>
      )}
      {notifSupported() && notifPerm === "granted" && (
        <div style={{ fontSize: 11, color: C.success, textAlign: "center", marginBottom: 10 }}>🔔 Notifikacije su aktivne</div>
      )}

      <div style={{ ...S.stat, textAlign: "center", marginBottom: 14, border: `1px solid ${C.danger}33`, background: C.dangerBg, borderRadius: 14, padding: 14 }}>
        <div style={{ ...S.stL, color: C.danger }}>⚠️ URGENTNO — više od 3 dana bez isporuke</div>
        <div style={{ ...S.stV, fontSize: 28, color: C.danger }}>{urgent.length}</div>
      </div>

      {urgent.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.dim }}><div style={{ fontSize: 32, marginBottom: 6 }}>✅</div>Nema urgentnih porudžbina</div>}

      {urgent.map(o => {
        const st = getDispSt(o);
        const exp = expanded === o.id;
        const wasCalled = !!o.calledAt;
        return (
          <div key={o.id} style={{ ...S.card, cursor: "pointer", borderColor: wasCalled ? C.success + "55" : C.danger + "55", background: wasCalled ? C.s1 : "rgba(239,68,68,0.05)" }} onClick={() => setExpanded(exp ? null : o.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{o.name}</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 1 }}>{o.model || "—"}</div>
              </div>
              <span style={S.badge(C.danger, C.dangerBg)}>⏰ {o.daysAgo} dana</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: wasCalled ? 6 : 0 }}>
              <div style={{ fontSize: 12, color: C.dim }}>{o.assignedTo} • PX: <span style={{ color: C.accent }}>{o.pxBroj}</span></div>
              <span style={S.badge(st.color, st.bg)}>{st.icon} {st.label}</span>
            </div>
            {wasCalled && <div style={{ fontSize: 11, color: C.success, fontWeight: 600, marginTop: 4 }}>✅ Pozvan ({fdt(o.calledAt)} — {o.calledBy})</div>}

            {exp && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, marginBottom: 12 }}>
                  <div><span style={{ color: C.dim }}>Telefon:</span> <a href={`tel:${fmtPhoneForTel(o.phone)}`} style={{ color: C.accent, fontWeight: 700, textDecoration: "none" }}>{o.phone || "—"}</a></div>
                  <div><span style={{ color: C.dim }}>Mesto:</span> {o.city || "—"}</div>
                  <div style={{ gridColumn: "1/-1" }}><span style={{ color: C.dim }}>Adresa:</span> {o.address || "—"}</div>
                  <div><span style={{ color: C.dim }}>Iznos:</span> <span style={{ color: C.accent, fontWeight: 700, fontFamily: FM }}>{fm(o.codAmount)}</span></div>
                  <div><span style={{ color: C.dim }}>PX dobijen:</span> {fd(o.datePx || o.dateCreated)}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {o.phone && <a href={`tel:${fmtPhoneForTel(o.phone)}`} onClick={() => markCalled(o)} style={{ ...S.btn, textDecoration: "none", flex: "1 1 calc(50% - 3px)", fontSize: 13, padding: "10px", justifyContent: "center" }}>📞 Pozovi</a>}
                  {o.phone && <a href={`viber://chat?number=${fmtPhoneForViber(o.phone)}`} style={{ ...S.btn2, textDecoration: "none", flex: "1 1 calc(50% - 3px)", fontSize: 13, padding: "10px", justifyContent: "center", color: "#7360f2", borderColor: "#7360f244" }}>💬 Viber</a>}
                  {o.pxBroj && <a href={trackUrl(o.pxBroj)} target="_blank" rel="noopener noreferrer" style={{ ...S.btn2, textDecoration: "none", flex: "1 1 calc(50% - 3px)", fontSize: 13, padding: "10px", justifyContent: "center", color: C.accent, borderColor: C.accent + "44" }}>📦 Prati PX</a>}
                  <button onClick={() => markCalled(o)} style={{ ...S.btn2, flex: "1 1 calc(50% - 3px)", fontSize: 13, color: C.success, borderColor: C.success + "44", padding: "10px", justifyContent: "center" }}>✅ Pozvan</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(() => {
    // Auto-login at app mount - no flash of login screen on refresh
    try {
      const su = localStorage.getItem("ecom-rem-u");
      const sp = localStorage.getItem("ecom-rem-p");
      if (su && sp) return USERS.find(x => x.username === su && x.password === sp) || null;
    } catch {}
    return null;
  });
  const [page, setPage] = useState("orders");
  const [data, setDataRaw] = useState(blank()); const [loading, setLoading] = useState(true);
  const dataRef = useRef(data);
  const lastSyncedRef = useRef(blank()); // what's actually in DB (source of truth for prev)
  const skipSyncRef = useRef(false);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Smart setData that auto-syncs changes to DB (per-entity diff)
  const setData = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(dataRef.current) : updater;
    dataRef.current = next;
    setDataRaw(next);
    if (!skipSyncRef.current) {
      // Use lastSyncedRef as "prev" - this is what DB currently has
      const prev = lastSyncedRef.current;
      console.log("[setData] syncing (orders:", prev.orders?.length || 0, "→", next.orders?.length || 0, ")");
      // Update lastSyncedRef BEFORE syncDiff with deep clone so subsequent calls see the current state
      lastSyncedRef.current = JSON.parse(JSON.stringify(next));
      syncDiff(prev, next).catch(e => console.error("syncDiff error:", e));
    } else {
      // Remote update — still update lastSynced to match
      lastSyncedRef.current = JSON.parse(JSON.stringify(next));
    }
  }, []);

  // Load data WITHOUT triggering sync
  const loadFromDb = useCallback(async () => {
    skipSyncRef.current = true;
    try {
      const d = await ld();
      dataRef.current = d;
      lastSyncedRef.current = JSON.parse(JSON.stringify(d));
      setDataRaw(d);
    } finally {
      skipSyncRef.current = false;
    }
  }, []);
  const ww = useWW();
  const isDesktop = ww >= 900;
  useEffect(() => { loadFromDb().then(() => setLoading(false)); }, []);

  // Real-time sync: listen for changes from other users on ALL tables
  useEffect(() => {
    if (!user || !supabase) return;
    let reloadTimer = null;
    const scheduleReload = () => {
      if (reloadTimer) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        loadFromDb().catch(e => console.error("Reload error:", e));
      }, 500); // debounce — wait 500ms to batch multiple changes
    };
    const ch = supabase.channel("ecom-all-tables")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "finances" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "models" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "costs" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "ad_spend" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "history" }, scheduleReload)
      .subscribe();
    return () => { if (reloadTimer) clearTimeout(reloadTimer); supabase.removeChannel(ch); };
  }, [user]);

  // Fallback polling when Supabase not used
  useEffect(() => {
    if (!user || supabase) return;
    const iv = setInterval(() => { loadFromDb(); }, 20000);
    return () => clearInterval(iv);
  }, [user]);

  // Urgent notifications — samo za administratora
  useEffect(() => {
    if (!user || user.role !== "admin") return;
    const check = () => {
      const now = Date.now();
      const THREE = 3 * 24 * 60 * 60 * 1000;
      const urgent = (data.orders || []).filter(o => {
        if (o.archived || !o.pxBroj || o.status === "isporuceno" || o.status === "odbijeno") return false;
        if (o.calledAt) return false; // already called
        const ref = o.datePx || o.dateCreated;
        return ref && (now - new Date(ref).getTime()) > THREE;
      });
      if (urgent.length === 0) return;
      if (notifPermission() !== "granted") return;
      const notified = getNotified();
      const todayKey = new Date().toISOString().slice(0, 10);
      // Clean old days (older than 2 days)
      Object.keys(notified).forEach(k => {
        if (k !== todayKey && k !== new Date(Date.now() - 864e5).toISOString().slice(0, 10)) delete notified[k];
      });
      if (!notified[todayKey]) notified[todayKey] = {};
      const newOnes = urgent.filter(o => !notified[todayKey][o.id]);
      if (newOnes.length === 0) return;
      // Single summary notification per batch
      if (newOnes.length === 1) {
        const o = newOnes[0];
        const daysAgo = Math.floor((Date.now() - new Date(o.datePx || o.dateCreated).getTime()) / 864e5);
        showNotif(`⚠️ Urgentno: ${o.name}`, `${daysAgo} dana bez isporuke • PX: ${o.pxBroj}`, "urgent-" + o.id, () => setPage("urgentno"));
      } else {
        showNotif(`⚠️ ${newOnes.length} urgentnih porudžbina`, `Ima više od 3 dana bez isporuke. Klikni za detalje.`, "urgent-batch", () => setPage("urgentno"));
      }
      newOnes.forEach(o => { notified[todayKey][o.id] = true; });
      setNotified(notified);
    };
    // Check odmah + na svakih 30 min
    const t1 = setTimeout(check, 3000);
    const iv = setInterval(check, 30 * 60 * 1000);
    return () => { clearTimeout(t1); clearInterval(iv); };
  }, [user, data.orders]);
  const log = useCallback((d, action) => { d.history.unshift({ id: uid(), action, user: user?.username || "Sistem", date: new Date().toISOString() }); }, [user]);
  const handleLogin = u => { setUser(u); const nd = { ...data }; nd.history.unshift({ id: uid(), action: `${u.username} prijavljen/a`, user: u.username, date: new Date().toISOString() }); setData(nd); sv(nd); };
  if (!user) return <Login onLogin={handleLogin} />;
  if (loading) return <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F, color: C.dim }}>Učitavanje...</div>;
  const isA = user.role === "admin";
  const navItems = [{ id: "orders", l: "Porudžbine", ic: I.orders }, { id: "finance", l: "Finansije", ic: I.finance }, { id: "archive", l: "Arhiva", ic: I.archive }, { id: "inventory", l: "Popis", ic: I.inventory }, { id: "more", l: "Više", ic: I.more }];
  const titles = { orders: "📦 Porudžbine", finance: "💰 Finansije", archive: "📁 Arhiva", inventory: "👟 Popis", more: "⚙️ Više", models: "🏷️ Modeli", profit: "📈 Profit", history: "📋 Istorija", export: "📱 Export", urgentno: "⚠️ Urgentno", nabavka: "🛍️ Nabavka" };
  const mainP = ["orders", "finance", "archive", "inventory", "more"];
  const activeP = mainP.includes(page) ? page : "more";

  const maxW = isDesktop ? 900 : 480;

  return (
    <div style={{ fontFamily: F, background: C.bg, color: C.text, minHeight: "100vh", maxWidth: maxW, margin: "0 auto", position: "relative", paddingBottom: isDesktop ? 20 : 76 }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ padding: "14px 16px", background: C.s1, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: isDesktop ? 20 : 8, flex: isDesktop ? 1 : "initial" }}>
          <span style={{ fontSize: 18, fontWeight: 900, background: `linear-gradient(135deg,${C.accent},#ef4444)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>eCom</span>
          {!isDesktop && <span style={{ fontSize: 12, color: C.dim }}>{titles[page]}</span>}
          {isDesktop && (
            <div style={{ display: "flex", gap: 4, marginLeft: 20 }}>
              {navItems.map(n => (
                <button key={n.id} onClick={() => setPage(n.id)} style={{ padding: "6px 12px", fontSize: 13, fontWeight: activeP === n.id ? 700 : 500, color: activeP === n.id ? C.accent : C.dim, background: activeP === n.id ? C.accentBg : "transparent", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: F, display: "flex", alignItems: "center", gap: 6 }}>
                  <Ic d={n.ic} size={15} color={activeP === n.id ? C.accent : C.dim} />
                  {n.l}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: isA ? "rgba(239,68,68,0.15)" : C.accentBg, color: isA ? "#ef4444" : C.accent, fontWeight: 700 }}>{user.username}{isA ? " ★" : ""}</span>
          <button onClick={() => { try { localStorage.removeItem("ecom-rem-u"); localStorage.removeItem("ecom-rem-p"); } catch {} setUser(null); setPage("orders"); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 3 }}><Ic d={I.logout} size={17} color={C.dim} /></button>
        </div>
      </div>
      {page === "orders" && <OrdersPage data={data} setData={setData} user={user} log={log} />}
      {page === "finance" && <FinancesPage data={data} setData={setData} user={user} log={log} />}
      {page === "archive" && <ArchivePage data={data} setData={setData} user={user} log={log} />}
      {page === "inventory" && <InventoryPage data={data} setData={setData} user={user} log={log} />}
      {page === "more" && <MorePage setPage={setPage} user={user} data={data} />}
      {page === "models" && <ModelsPage data={data} setData={setData} log={log} goBack={() => setPage("more")} />}
      {page === "profit" && <ProfitPage data={data} setData={setData} log={log} goBack={() => setPage("more")} />}
      {page === "history" && <HistoryPage data={data} goBack={() => setPage("more")} />}
      {page === "export" && <ExportPage data={data} goBack={() => setPage("more")} />}
      {page === "urgentno" && isA && <UrgentnoPage data={data} setData={setData} user={user} log={log} goBack={() => setPage("more")} />}
      {page === "nabavka" && isA && <NabavkaPage data={data} goBack={() => setPage("more")} />}
      {!isDesktop && (
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: maxW, background: C.s1, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {navItems.map(n => <button key={n.id} onClick={() => setPage(n.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "9px 2px", fontSize: 10, fontWeight: activeP === n.id ? 700 : 500, color: activeP === n.id ? C.accent : C.dim, background: "none", border: "none", cursor: "pointer", fontFamily: F, position: "relative" }}>{activeP === n.id && <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 3, background: C.accent, borderRadius: "0 0 3px 3px" }} />}<Ic d={n.ic} size={19} color={activeP === n.id ? C.accent : C.dim} />{n.l}</button>)}
        </div>
      )}
    </div>
  );
}
