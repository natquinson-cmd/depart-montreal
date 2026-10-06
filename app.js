// Départ pour Montréal : checklist privée.
// Le dépôt est public, mais il ne contient AUCUNE donnée : le contenu (tâches, enfants, alertes)
// et l'état (coches, date de départ) sont dans Firebase, lisibles seulement par les comptes
// Google autorisés par le propriétaire (règles : canada, canadaAcces, canadaDemandes).

const firebaseConfig = {
  apiKey: "AIzaSyA2QeMTVgKgHaeyGYXcs-AXpi1rO7GikIo",
  authDomain: "portfolio-dashboard-f0c69.firebaseapp.com",
  databaseURL: "https://portfolio-dashboard-f0c69-default-rtdb.firebaseio.com",
  projectId: "portfolio-dashboard-f0c69",
  storageBucket: "portfolio-dashboard-f0c69.firebasestorage.app",
  messagingSenderId: "444106868590",
  appId: "1:444106868590:web:682fbc10b01ccb7bfbe37f"
};
const OWNER = "3TeVRklUsThrykDDWlGKM3S5IPK2";
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const PHASES = { now: "Dès maintenant", m12: "6 à 12 mois avant", m3: "1 à 3 mois avant", arr: "À l'arrivée", perso: "Ajoutée" };
const FR = ["PS", "MS", "GS", "CP", "CE1", "CE2", "CM1", "CM2", "6e", "5e", "4e", "3e", "2nde", "1re", "Terminale"];
const QC_BY_FR = { PS: "Maternelle 4 ans", MS: "Maternelle 4 ans", GS: "Maternelle 5 ans", CP: "1re année", CE1: "2e année", CE2: "3e année", CM1: "4e année", CM2: "5e année", "6e": "6e année", "5e": "Secondaire 1", "4e": "Secondaire 2", "3e": "Secondaire 3", "2nde": "Secondaire 4", "1re": "Secondaire 5", "Terminale": "Cégep, 1re année" };
const FR_LABEL = { PS: "Petite section", MS: "Moyenne section", GS: "Grande section" };
const DEFAULT_DEP = "2027-08-15";
const CACHE_KEY = "dm-cache-v1";
const LEAF_VB = "2850 300 3900 4200";
const SVGNS = "http://www.w3.org/2000/svg";

let content = null;                                   // canada/contenu
let etat = { checks: {}, custom: {}, departure: DEFAULT_DEP };  // canada/etat
let user = null, niveau = null;                       // "owner" | "complet" | "lecture"
let filter = "all", hideDone = false;
let live = [];                                        // écouteurs Firebase actifs

const $ = s => document.querySelector(s);
const canWrite = () => niveau === "owner" || niveau === "complet";

// ---------- Outils DOM (aucun HTML interprété : tout le texte passe par textContent) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach(k => { if (k) el.append(k); });
  return el;
}
function icon(id, cls, viewBox) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", viewBox || "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  const u = document.createElementNS(SVGNS, "use");
  u.setAttribute("href", "#" + id);
  s.append(u);
  return s;
}
const hasIcon = id => !!document.getElementById(id);

// ---------- Dates ----------
function parseDate(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const fmtMonth = d => d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
const fmtLong = d => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const fmtDay = d => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
const depDate = () => parseDate(etat.departure) || parseDate(DEFAULT_DEP);
function windows() {
  const d = depDate();
  return { m12: { from: addMonths(d, -12), to: addMonths(d, -6) }, m3: { from: addMonths(d, -3), to: d } };
}
// « {dep-4} » dans un texte = mois situé 4 mois avant la date de départ
const fill = s => String(s || "").replace(/\{dep([+-]\d+)\}/g, (_, n) => fmtLong(addMonths(depDate(), +n)));

// ---------- Copie locale (affichage hors connexion) ----------
function saveCache() {
  if (!user || !content) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: user.uid, niveau, content, etat })); } catch (e) {}
}
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
}
function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }
try { hideDone = localStorage.getItem("dm-hide") === "1"; } catch (e) {}
$("#hideDone").checked = hideDone;

// ---------- Écrans ----------
function showGate(msg, { login = false, logout = false } = {}) {
  $("#app").hidden = true;
  $("#gate").hidden = false;
  $("#gateMsg").textContent = msg;
  $("#btnLogin").hidden = !login;
  $("#btnLogout2").hidden = !logout;
}
function showApp() { $("#gate").hidden = true; $("#app").hidden = false; }
function setSync(t) { $("#sync").textContent = t; }
function banner(t) { $("#banner").hidden = !t; $("#banner").textContent = t || ""; }

function renderAccount() {
  const box = $("#acct");
  const kids = [];
  if (user) {
    kids.push(h("span", {}, document.createTextNode("Connecté : "), h("b", { text: user.email || user.displayName || "compte Google" })));
    if (niveau && !canWrite()) kids.push(h("span", { class: "pill ro", text: "Lecture seule" }));
    if (niveau === "owner") kids.push(h("span", { class: "pill", text: "Propriétaire" }));
    kids.push(h("button", { class: "linkbtn", type: "button", id: "btnLogout", text: "Se déconnecter" }));
  }
  box.replaceChildren(...kids);
}

// ---------- En-tête, trajet, effets ----------
function updateHeader() {
  const d = depDate();
  if (document.activeElement !== $("#depDate")) $("#depDate").value = etat.departure || DEFAULT_DEP;
  $("#depDate").disabled = !canWrite();
  $("#depMonth").textContent = fmtLong(d);
  $("#eyebrow").textContent = (content && content.famille ? content.famille + " · " : "") + "Projet Canada";
  const days = Math.round((d - today()) / 86400000);
  const months = (d.getFullYear() - today().getFullYear()) * 12 + d.getMonth() - today().getMonth();
  $("#countdown").textContent = days <= 0 ? "Bienvenue au Québec" : days <= 62 ? "Départ dans " + days + " jours" : "Départ dans ~" + months + " mois";
  const w = windows();
  document.querySelectorAll(".chip").forEach(c => {
    const p = c.dataset.phase;
    const kids = [document.createTextNode(p === "all" ? "Tout" : PHASES[p])];
    if (w[p]) kids.push(h("span", { class: "win", text: fmtMonth(w[p].from) + " → " + fmtMonth(w[p].to) }));
    c.replaceChildren(...kids);
  });
  const al = (content && content.alertes) || [];
  $("#alertsBox").hidden = !al.length;
  $("#alerts").replaceChildren(...al.map(t => h("li", { text: fill(t) })));
}
function updateRoute(pct) {
  const path = $("#routePath"), flown = $("#routeFlown"), plane = $("#plane");
  const len = path.getTotalLength();
  flown.style.strokeDasharray = len;
  flown.style.strokeDashoffset = len * (1 - pct / 100);
  const at = Math.max(0.02, Math.min(0.98, pct / 100)) * len;
  const p = path.getPointAtLength(at), q = path.getPointAtLength(Math.min(len, at + 1));
  const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
  plane.setAttribute("transform", "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ") rotate(" + ang.toFixed(1) + ")");
}
function burst(x, y) {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 7; i++) {
    const s = icon("leaf", "leaf-fx", LEAF_VB);
    const a = (Math.PI * 2 * i) / 7 + Math.random() * .6;
    const d = 30 + Math.random() * 30;
    s.style.left = (x - 7) + "px"; s.style.top = (y - 7) + "px";
    s.style.setProperty("--dx", (Math.cos(a) * d).toFixed(0) + "px");
    s.style.setProperty("--dy", (Math.sin(a) * d - 18).toFixed(0) + "px");
    s.style.setProperty("--rot", ((Math.random() - .5) * 300).toFixed(0) + "deg");
    document.body.append(s);
    setTimeout(() => s.remove(), 950);
  }
}

// ---------- Classes des enfants selon la date d'arrivée ----------
function qcByAge(age) {
  if (age <= 3) return "Pas encore à l'école";
  if (age === 4) return "Maternelle 4 ans";
  if (age === 5) return "Maternelle 5 ans";
  if (age === 6) return "1re année";
  if (age <= 11) return (age - 5) + "e année";
  if (age <= 16) return "Secondaire " + (age - 11);
  return "Après le secondaire";
}
function kidsBlock() {
  const kidsData = (content && content.kids) || [];
  if (!kidsData.length) return null;
  const d = depDate();
  const S = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  const midYear = !(d.getMonth() === 6 || d.getMonth() === 7);
  const ref = new Date(S, 8, 30);
  const rows = kidsData.map(k => {
    const b = parseDate(k.born);
    if (!b) return null;
    const age = S - b.getFullYear() - (b.getMonth() > 8 ? 1 : 0);
    const idx = FR.indexOf(k.fr2026) + (S - 2026);
    const fr = idx < 0 ? "Pas encore à l'école" : idx >= FR.length ? "Après le bac" : (FR_LABEL[FR[idx]] || FR[idx]);
    const qc = idx < 0 ? qcByAge(age) : idx >= FR.length ? "Études après le cégep" : QC_BY_FR[FR[idx]];
    const notes = [];
    const byAge = qcByAge(age);
    if (byAge !== qc) notes.push("Selon l'âge seul : " + byAge.toLowerCase() + ". L'école tranche avec le dossier.");
    if (age >= 16) notes.push("18 ans le " + fmtDay(new Date(b.getFullYear() + 18, b.getMonth(), b.getDate())) + ".");
    return h("tr", {},
      h("td", {}, h("span", { class: "who", text: k.name }), h("span", { class: "born", text: "Naissance : " + fmtDay(b) })),
      h("td", { text: age + " ans" }),
      h("td", { text: fr }),
      h("td", { class: "qc", text: qc }),
      h("td", { class: "note", text: notes.join(" ") }));
  });
  return h("div", { class: "kids" },
    h("div", { class: "kids-cap", text: (midYear ? "Arrivée en cours d'année scolaire " : "Rentrée ") + S + "-" + (S + 1) + " · âges au " + fmtDay(ref) }),
    h("div", { class: "kids-scroll" }, h("table", { class: "kt" },
      h("thead", {}, h("tr", {}, ["Enfant", "Âge", "Ce serait en France", "Au Québec", "À savoir"].map(t => h("th", { text: t })))),
      h("tbody", {}, rows))),
    h("p", { class: "kids-foot", text: "Équivalence courante : 6e en France = 6e année du primaire, puis 5e = secondaire 1, jusqu'à 1re = secondaire 5 (niveau du DES). Le Québec compte l'âge au 30 septembre, la France l'année civile : un enfant né d'octobre à décembre serait placé un niveau plus bas. Le centre de services scolaire décide." }));
}

// ---------- Liste ----------
const isDone = id => { const c = (etat.checks || {})[id]; return !!(c && (c === true || c.done)); };
function customList() {
  return Object.entries(etat.custom || {}).map(([id, v]) => Object.assign({ id }, v || {})).sort((a, b) => (a.created || 0) - (b.created || 0));
}
function render() {
  if (!content) return;
  const focusId = document.activeElement && document.activeElement.id;
  const w = windows(), now = today(), ro = !canWrite();
  const custom = customList();
  let total = 0, done = 0;
  const sections = (content.groups || []).map(g => {
    const items = (g.tasks || []).map(t => ({ id: t[0], label: t[1], detail: t[2], phase: t[3], urgent: !!t[4] }))
      .concat(custom.filter(c => c.group === g.id).map(c => ({ id: String(c.id), label: String(c.text || ""), detail: "", phase: "perso", custom: true })));
    const gDone = items.filter(i => isDone(i.id)).length;
    const full = items.length > 0 && gDone === items.length;
    total += items.length; done += gDone;
    const visible = items.filter(i => (filter === "all" || i.phase === filter || i.phase === "perso") && !(hideDone && isDone(i.id)));
    const rows = visible.map(i => {
      const cid = "c-" + i.id;
      const input = h("input", { type: "checkbox", id: cid, "data-id": i.id, disabled: ro });
      input.checked = isDone(i.id);
      const late = !isDone(i.id) && w[i.phase] && w[i.phase].to < now;
      const tagText = (late ? "À rattraper · " : i.urgent ? "Prioritaire · " : "") + (PHASES[i.phase] || "");
      return h("li", { class: "task" + (isDone(i.id) ? " done" : "") },
        h("div", { class: "cb" }, input, h("span", {}, icon("i-check"))),
        h("div", { class: "t-body" },
          h("label", { class: "t-label", for: cid, text: fill(i.label) }),
          i.detail ? h("span", { class: "t-detail", text: fill(i.detail) }) : null,
          i.custom && !ro ? h("button", { class: "del", type: "button", "data-del": i.id, text: "Supprimer" }) : null),
        h("span", { class: "tag" + (late ? " late" : i.urgent ? " urgent" : ""), text: tagText }));
    });
    const bar = h("i", {}); bar.style.width = (items.length ? gDone / items.length * 100 : 0) + "%";
    const count = h("span", { class: "g-count" }, full ? icon("leaf", null, LEAF_VB) : null, document.createTextNode(full ? "Terminé" : gDone + " / " + items.length));
    const ico = full ? "i-check" : (hasIcon("i-" + g.id) ? "i-" + g.id : "i-check");
    return h("section", { class: "group" + (full ? " full" : ""), id: "g-" + g.id },
      h("div", { class: "g-head" },
        h("div", { class: "g-ico" }, icon(ico)),
        h("h2", { text: g.title }),
        count,
        h("div", { class: "g-bar" }, bar)),
      g.kids ? kidsBlock() : null,
      rows.length ? h("ul", { class: "tasks" }, rows) : h("p", { class: "empty-filter", text: "Rien à afficher pour ce filtre." }),
      ro ? null : h("form", { class: "add", "data-group": g.id },
        h("input", { id: "add-" + g.id, placeholder: "Ajouter une tâche à ce groupe", "aria-label": "Nouvelle tâche, " + g.title, maxlength: "200" }),
        h("button", { type: "submit", text: "Ajouter" })));
  });
  const drafts = {};
  document.querySelectorAll(".add input").forEach(i => { if (i.value) drafts[i.id] = i.value; });
  $("#groups").replaceChildren(...sections);
  Object.entries(drafts).forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
  const pct = total ? Math.round(done / total * 100) : 0;
  $("#ptxt").textContent = done + " / " + total + " tâches faites · " + pct + " %";
  updateHeader();
  updateRoute(pct);
  renderAccount();
  if (focusId && focusId !== "depDate" && document.getElementById(focusId)) document.getElementById(focusId).focus();
}

// ---------- Écritures ----------
const errMsg = e => (e && (e.code || e.message)) || "erreur";
function write(path, value) {
  if (!canWrite()) return Promise.resolve();
  const p = value === null ? db.ref(path).remove() : db.ref(path).set(value);
  return p.catch(e => setSync("Modification refusée (" + errMsg(e) + ")."));
}

document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "hideDone") {
    hideDone = el.checked;
    try { localStorage.setItem("dm-hide", hideDone ? "1" : "0"); } catch (x) {}
    render(); return;
  }
  if (el.id === "depDate") {
    if (!parseDate(el.value) || el.value === etat.departure) return;
    etat.departure = el.value; render(); saveCache();
    write("canada/etat/departure", el.value);
    return;
  }
  if (el.id === "importFile") { importContent(el.files && el.files[0]); el.value = ""; return; }
  const id = el.dataset && el.dataset.id;
  if (!id) return;
  if (el.checked) { const r = el.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2); }
  etat.checks = Object.assign({}, etat.checks, { [id]: el.checked ? { done: true } : null });
  if (!el.checked) delete etat.checks[id];
  render(); saveCache();
  write("canada/etat/checks/" + id, el.checked ? { done: true, at: firebase.database.ServerValue.TIMESTAMP, by: user.uid } : null);
});

document.addEventListener("submit", e => {
  const form = e.target.closest("form.add");
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector("input");
  const text = input.value.trim();
  if (!text) return;
  const id = "u" + Date.now().toString(36);
  const item = { group: form.dataset.group, text, created: Date.now(), by: user.uid };
  etat.custom = Object.assign({}, etat.custom, { [id]: item });
  input.value = "";
  render(); saveCache();
  write("canada/etat/custom/" + id, item);
});

document.addEventListener("click", e => {
  if (e.target.closest("#btnLogin")) { login(); return; }
  if (e.target.closest("#btnLogout") || e.target.closest("#btnLogout2")) { logout(); return; }
  const chip = e.target.closest(".chip");
  if (chip) {
    filter = chip.dataset.phase;
    document.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", c === chip ? "true" : "false"));
    render(); return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    if (etat.custom) delete etat.custom[id];
    if (etat.checks) delete etat.checks[id];
    render(); saveCache();
    write("canada/etat/custom/" + id, null).then(() => write("canada/etat/checks/" + id, null));
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act) adminAction(act);
});

// ---------- Connexion ----------
function login() {
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  auth.signInWithPopup(p).catch(err => {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment")) return auth.signInWithRedirect(p);
    if (err && err.code === "auth/popup-closed-by-user") return;
    showGate("La connexion a échoué (" + errMsg(err) + "). Réessaie.", { login: true });
  });
}
function logout() {
  stopLive(); clearCache();
  content = null; niveau = null;
  auth.signOut();
}
function stopLive() { live.forEach(off => off()); live = []; }
function on(ref, cb, onErr) {
  ref.on("value", cb, onErr);
  live.push(() => ref.off("value", cb));
}

auth.onAuthStateChanged(async u => {
  stopLive();
  user = u;
  if (!u) {
    const c = loadCache();
    if (navigator.onLine === false && c && c.content) return; // hors connexion : on garde la copie locale affichée
    content = null; niveau = null;
    showGate("Cette page est privée. Connecte-toi avec ton compte Google : si tu n'as pas encore accès, une demande sera envoyée à Nathanaël.", { login: true });
    return;
  }
  if (u.uid === OWNER) { niveau = "owner"; startLive(); return; }
  showGate("Vérification de ton accès…");
  on(db.ref("canadaAcces/" + u.uid), snap => {
    const v = snap.val();
    if (v) {
      const n = v.niveau === "complet" ? "complet" : "lecture";
      if (niveau && niveau !== n) { location.reload(); return; } // changement de niveau : on repart proprement
      if (!niveau) { niveau = n; startLive(); }
    } else {
      if (niveau) { niveau = null; content = null; clearCache(); stopLive(); }
      askAccess(u);
    }
  }, err => showGate("Impossible de vérifier l'accès pour le moment (" + errMsg(err) + ").", { logout: true }));
});

function askAccess(u) {
  const ref = db.ref("canadaDemandes/" + u.uid);
  ref.set({ email: String(u.email || "").slice(0, 200), nom: String(u.displayName || "").slice(0, 200), at: Date.now() })
    .then(() => showGate("Demande d'accès envoyée pour " + (u.email || "ce compte") + ". La page s'ouvrira toute seule dès que Nathanaël l'aura acceptée.", { logout: true }))
    .catch(err => showGate("La demande d'accès n'a pas pu être envoyée (" + errMsg(err) + ").", { logout: true }));
  // Réécoute l'accès : la fonction on() précédente a été arrêtée si l'accès vient d'être retiré
  if (!live.length) on(db.ref("canadaAcces/" + u.uid), snap => { if (snap.val()) location.reload(); });
}

function startLive() {
  // On garde l'écoute de canadaAcces (pour un non-propriétaire) et on ajoute contenu + état
  showApp();
  renderAccount();
  setSync("Connexion à la base…");
  const cached = loadCache();
  if (cached && cached.uid === user.uid && cached.content) { content = cached.content; etat = cached.etat || etat; render(); }
  on(db.ref("canada/contenu"), snap => {
    content = snap.val();
    if (!content) {
      $("#groups").replaceChildren(h("p", { class: "muted", text: niveau === "owner" ? "La base ne contient pas encore la checklist : importe le fichier checklist_contenu.json dans le cadre « Accès à la page » ci-dessus." : "La checklist n'a pas encore été chargée par Nathanaël." }));
      $("#alertsBox").hidden = true;
      updateHeader(); renderAccount();
    } else render();
    $("#contentInfo").textContent = content ? "Version " + (content.version || "?") + ", mise à jour du " + (content.maj || "?") + "." : "Aucun contenu dans la base.";
    saveCache();
  }, err => setSync("Lecture refusée (" + errMsg(err) + ")."));
  on(db.ref("canada/etat"), snap => {
    const v = snap.val() || {};
    etat = { checks: v.checks || {}, custom: v.custom || {}, departure: parseDate(v.departure) ? v.departure : DEFAULT_DEP };
    render(); saveCache();
  });
  on(db.ref(".info/connected"), snap => {
    const ok = !!snap.val();
    setSync(ok ? (canWrite() ? "Enregistré en ligne, partagé entre les comptes autorisés" : "Lecture seule") : "Hors connexion : dernier état connu, les coches seront envoyées au retour du réseau");
    banner(ok ? "" : (content ? "Hors connexion : tu vois la dernière version enregistrée sur cet appareil." : ""));
  });
  $("#admin").hidden = niveau !== "owner";
  if (niveau === "owner") startAdmin();
}

// ---------- Gestion des accès (propriétaire) ----------
let demandes = {}, acces = {}, confirmDel = null;
function startAdmin() {
  on(db.ref("canadaDemandes"), s => { demandes = s.val() || {}; renderAdmin(); });
  on(db.ref("canadaAcces"), s => { acces = s.val() || {}; renderAdmin(); });
}
function personLine(uid, v) {
  return h("div", { class: "id" }, h("b", { text: (v && (v.nom || v.email)) || uid }), h("small", { text: [v && v.email, v && v.at ? "le " + fmtDay(new Date(v.at)) : ""].filter(Boolean).join(" · ") }));
}
function renderAdmin() {
  const dk = Object.keys(demandes).filter(uid => !acces[uid]);
  $("#demandes").replaceChildren(...(dk.length ? dk.map(uid => h("div", { class: "who-row" },
    personLine(uid, demandes[uid]),
    h("button", { class: "btn small", type: "button", "data-act": "grant", "data-uid": uid, "data-niv": "complet", text: "Accès complet" }),
    h("button", { class: "btn ghost small", type: "button", "data-act": "grant", "data-uid": uid, "data-niv": "lecture", text: "Lecture" }),
    h("button", { class: "linkbtn", type: "button", "data-act": "refuse", "data-uid": uid, text: "Refuser" }))) : [h("p", { class: "muted", text: "Aucune demande." })]));
  const ak = Object.keys(acces);
  $("#acces").replaceChildren(...(ak.length ? ak.map(uid => {
    const v = acces[uid] || {};
    const other = v.niveau === "complet" ? "lecture" : "complet";
    return h("div", { class: "who-row" },
      personLine(uid, v),
      h("span", { class: "pill" + (v.niveau === "complet" ? "" : " ro"), text: v.niveau === "complet" ? "Complet" : "Lecture" }),
      h("button", { class: "btn ghost small", type: "button", "data-act": "level", "data-uid": uid, "data-niv": other, text: "Passer en " + (other === "complet" ? "complet" : "lecture") }),
      h("button", { class: "linkbtn", type: "button", "data-act": "remove", "data-uid": uid, text: confirmDel === uid ? "Confirmer le retrait" : "Retirer" }));
  }) : [h("p", { class: "muted", text: "Personne pour l'instant." })]));
}
function adminAction(btn) {
  if (niveau !== "owner") return;
  const uid = btn.dataset.uid, act = btn.dataset.act;
  if (act === "grant") {
    const d = demandes[uid] || {};
    db.ref("canadaAcces/" + uid).set({ niveau: btn.dataset.niv, email: d.email || "", nom: d.nom || "", at: Date.now() })
      .then(() => db.ref("canadaDemandes/" + uid).remove())
      .catch(e => setSync("Accès non accordé (" + errMsg(e) + ")."));
  } else if (act === "refuse") {
    db.ref("canadaDemandes/" + uid).remove().catch(e => setSync("Erreur (" + errMsg(e) + ")."));
  } else if (act === "level") {
    db.ref("canadaAcces/" + uid + "/niveau").set(btn.dataset.niv).catch(e => setSync("Erreur (" + errMsg(e) + ")."));
  } else if (act === "remove") {
    if (confirmDel !== uid) { confirmDel = uid; renderAdmin(); return; }
    confirmDel = null;
    db.ref("canadaAcces/" + uid).remove().catch(e => setSync("Erreur (" + errMsg(e) + ")."));
  }
}

// ---------- Import du contenu (propriétaire) ----------
function importContent(file) {
  if (!file || niveau !== "owner") return;
  const msg = t => { $("#importMsg").textContent = t; };
  const r = new FileReader();
  r.onload = async () => {
    let data;
    try { data = JSON.parse(r.result); } catch (e) { msg("Fichier illisible : ce n'est pas du JSON valide."); return; }
    const c = data && (data.contenu || data);
    if (!c || !Array.isArray(c.groups) || !c.groups.length) { msg("Ce fichier ne contient pas de checklist (liste « groups » absente)."); return; }
    try {
      await db.ref("canada/contenu").set(c);
      const cur = (await db.ref("canada/etat").once("value")).val();
      if (!cur && data.etatInitial) await db.ref("canada/etat").set(data.etatInitial);
      const n = c.groups.reduce((s, g) => s + ((g.tasks || []).length), 0);
      msg("Contenu importé : " + c.groups.length + " groupes, " + n + " tâches. Les coches existantes sont conservées.");
    } catch (e) { msg("Import refusé (" + errMsg(e) + ")."); }
  };
  r.readAsText(file);
}

// ---------- Démarrage ----------
showGate("Chargement…");
// Hors connexion avec une copie locale : on l'affiche tout de suite (la connexion Google se rétablira seule)
(function offlineFirst() {
  const c = loadCache();
  if (navigator.onLine === false && c && c.content) {
    user = { uid: c.uid, email: "" }; niveau = "lecture"; content = c.content; etat = c.etat || etat; // pas d'écriture sans session
    showApp(); render(); banner("Hors connexion : tu vois la dernière version enregistrée sur cet appareil.");
  }
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
