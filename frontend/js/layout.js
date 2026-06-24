/**
 * Shared layout helpers v4.2
 * CSS is injected via injectStyles() — works even if <style> tag missing
 */
import { esc, getUser, logout, ai } from "/js/api.js";

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#f1f5f9;color:#0f172a;min-height:100vh}#app{display:flex;min-height:100vh}
.sidebar{width:265px;background:#fff;display:flex;flex-direction:column;flex-shrink:0;height:100vh;position:sticky;top:0;border-right:1px solid #e2e8f0;overflow-y:auto}
.sidebar-brand{padding:22px 20px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #f1f5f9}
.brand-icon{width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#4f46e5;flex-shrink:0}
.sidebar-brand h2{font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-0.3px}
.sidebar-brand p{font-size:11.5px;color:#64748b;margin-top:2px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.school-meta{margin:12px 16px;background:#f8fafc;border-radius:10px;padding:10px 12px;border:1px solid #e2e8f0}
.meta-row{display:flex;justify-content:space-between;font-size:11.5px;padding:2px 0}
.meta-row span{color:#94a3b8;font-weight:600}
.meta-row strong{color:#0f172a;font-weight:700}
.nav{flex:1;padding:8px 12px}
.nav-item{padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;border-radius:10px;color:#64748b;margin-bottom:2px;transition:all .15s;user-select:none}
.nav-item:hover{background:#f1f5f9;color:#0f172a}
.nav-item.active{background:#4f46e5;color:#fff;box-shadow:0 4px 12px rgba(79,70,229,.25)}
.nav-icon{width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.icon-svg{width:1em;height:1em;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;display:inline-block;vertical-align:-.15em}
.brand-icon .icon-svg{width:28px;height:28px}
.nav-icon .icon-svg{width:18px;height:18px}
.btn-logout .icon-svg{width:15px;height:15px;margin-right:6px}
.sidebar-footer{padding:16px;border-top:1px solid #f1f5f9}
.user-card{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.user-info strong{display:block;font-size:13px;color:#0f172a;font-weight:700}
.role-badge{font-size:10px;font-weight:700;background:#e0e7ff;color:#4338ca;padding:2px 7px;border-radius:20px;display:inline-block;margin-top:2px}
.btn-logout{background:#f1f5f9;border:none;color:#ef4444;padding:10px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;width:100%;transition:all .2s;font-family:inherit;display:flex;align-items:center;justify-content:center}
.btn-logout:hover{background:#fee2e2}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{background:#fff;padding:16px 28px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:12px}
.topbar h3{font-size:18px;font-weight:700;color:#0f172a}
.topbar-right{font-size:12.5px;color:#64748b;font-weight:500;text-align:right}
.content{flex:1;overflow-y:auto;padding:24px 28px}
.panel{display:none}.panel.active{display:block}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border-radius:14px;padding:20px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.stat-card .val{font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-1px}
.stat-card .lbl{font-size:12.5px;color:#64748b;margin-top:4px;font-weight:600}
.stat-card .sub{font-size:11.5px;color:#94a3b8;margin-top:2px}
.card{background:#fff;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden;margin-bottom:20px}
.card-hdr{padding:16px 22px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.card-hdr h4{font-size:14.5px;font-weight:700;color:#0f172a}
.card-body{padding:16px 22px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f8fafc;padding:10px 16px;text-align:left;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td{padding:13px 16px;border-bottom:1px solid #f8fafc;color:#0f172a;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafbff}
.btn{padding:9px 16px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s;font-family:inherit;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.btn-primary{background:#4f46e5;color:#fff}.btn-primary:hover{background:#4338ca;box-shadow:0 4px 12px rgba(79,70,229,.3)}
.btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
.btn-ghost{background:#f1f5f9;color:#64748b}.btn-ghost:hover{background:#e2e8f0;color:#0f172a}
.btn-sm{padding:5px 10px;font-size:11.5px;border-radius:7px}
.btn-warn{background:#f59e0b;color:#fff}.btn-warn:hover{background:#d97706}
.btn-success{background:#10b981;color:#fff}.btn-success:hover{background:#059669}
.btn-loading{position:relative;color:transparent!important;pointer-events:none}
.btn-loading::after{content:"";position:absolute;width:15px;height:15px;top:50%;left:50%;margin:-7.5px 0 0 -7.5px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:cbc-spin .6s linear infinite}
@keyframes cbc-spin{to{transform:rotate(360deg)}}
.badge{padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;display:inline-block}
.bg{background:#dcfce7;color:#15803d}.br{background:#fee2e2;color:#b91c1c}
.bb{background:#e0e7ff;color:#4338ca}.by{background:#fef9c3;color:#854d0e}
.bpurple{background:#f3e8ff;color:#7e22ce}.bgray{background:#f1f5f9;color:#64748b}
.bteal{background:#ccfbf1;color:#0f766e}
/* ── Modals — perfectly centred on every screen ── */
.modal-bg{display:none;position:fixed!important;inset:0!important;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center;padding:16px;overflow-y:auto}
.modal-bg.open{display:flex}
.modal{background:#fff;border-radius:18px;padding:28px;width:100%;max-width:540px;box-shadow:0 24px 48px rgba(0,0,0,.18);margin:auto;position:relative;max-height:calc(100vh - 32px);overflow-y:auto}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.modal-hdr h3{font-size:17px;font-weight:700;color:#0f172a}
.modal-close{background:none;border:none;font-size:24px;cursor:pointer;color:#94a3b8;line-height:1;padding:4px;border-radius:6px;transition:color .15s}
.modal-close:hover{color:#0f172a}
.fg{margin-bottom:14px}
.fg label{display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
.fg input,.fg select,.fg textarea{width:100%;padding:10px 14px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13.5px;color:#0f172a;font-family:inherit;outline:none;transition:border-color .15s}
.fg input:focus,.fg select:focus,.fg textarea:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
.fg textarea{resize:vertical;min-height:70px}
.fg-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.modal-actions{display:flex;gap:10px;margin-top:22px;justify-content:flex-end;flex-wrap:wrap}
/* ── Mobile hamburger button ── */
.mob-menu-btn{display:none;background:none;border:none;cursor:pointer;padding:6px;color:#0f172a;border-radius:8px;transition:background .15s}
.mob-menu-btn:hover{background:#f1f5f9}
.mob-menu-btn .icon-svg{width:22px;height:22px}
/* ── Sidebar overlay for mobile ── */
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:199}
.sidebar-overlay.show{display:block}
/* ── Responsive breakpoints ── */
@media(max-width:768px){
  #app{flex-direction:column}
  .sidebar{position:fixed;left:-300px;top:0;height:100vh;width:265px;z-index:200;transition:left .25s ease;box-shadow:none;visibility:hidden}
  .sidebar.mob-open{left:0;box-shadow:4px 0 24px rgba(0,0,0,.15);visibility:visible}
  .mob-menu-btn{display:flex;align-items:center;justify-content:center}
  .main{width:100%;min-height:100vh}
  .topbar{padding:12px 16px}
  .topbar h3{font-size:15px}
  .content{padding:16px}
  .stat-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:16px}
  .stat-card .val{font-size:22px}
  .card-hdr{padding:12px 16px;flex-direction:column;align-items:flex-start}
  .card-body{padding:12px 16px}
  .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{min-width:520px}
  .fg-row{grid-template-columns:1fr}
  .modal{padding:20px;border-radius:14px}
  .modal-actions{justify-content:stretch}
  .modal-actions .btn{flex:1;justify-content:center}
  .filter-bar{gap:8px}
  .filter-bar input,.filter-bar select{width:100%;flex:1 1 140px}
  .action-btns{gap:4px}
  .btn{padding:8px 12px;font-size:12.5px}
  .btn-sm{padding:4px 8px;font-size:11px}
}
@media(max-width:480px){
  .stat-grid{grid-template-columns:1fr 1fr}
  .modal-bg{padding:0;align-items:flex-end}
  .modal{border-radius:18px 18px 0 0;max-height:92vh;padding:20px 16px}
}
.alert{padding:11px 14px;border-radius:10px;font-size:13px;margin-top:12px;font-weight:500;border:1px solid transparent}
.alert-err{background:#fee2e2;color:#b91c1c;border-color:#fecaca}
.alert-ok{background:#dcfce7;color:#15803d;border-color:#bbf7d0}
.empty{text-align:center;padding:44px 20px;color:#94a3b8;font-size:14px}
.filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.filter-bar input,.filter-bar select{padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;background:#fff;font-family:inherit;outline:none}
.filter-bar input:focus,.filter-bar select:focus{border-color:#4f46e5}
.table-wrap{overflow-x:auto}
.action-btns{display:flex;gap:5px;flex-wrap:wrap}
.level-EE{background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px;display:inline-block}
.level-ME{background:#e0e7ff;color:#4338ca;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px;display:inline-block}
.level-AE{background:#fef9c3;color:#854d0e;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px;display:inline-block}
.level-BE{background:#fee2e2;color:#b91c1c;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px;display:inline-block}
.net-err{background:#fef9c3;color:#92400e;border:1px solid #fde68a;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px}
/* ── AI Assistant widget ── */
.ai-fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(79,70,229,.35);display:flex;align-items:center;justify-content:center;z-index:500;transition:transform .15s}
.ai-fab:hover{transform:scale(1.06)}
.ai-fab .icon-svg{width:24px;height:24px}
.ai-panel{position:fixed;bottom:24px;right:24px;width:380px;max-height:min(560px,calc(100vh - 48px));background:#fff;border-radius:18px;box-shadow:0 24px 48px rgba(0,0,0,.22);display:none;flex-direction:column;z-index:501;overflow:hidden;border:1px solid #e2e8f0}
.ai-panel.open{display:flex}
.ai-hdr{padding:16px 18px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.ai-hdr-title{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700}
.ai-hdr-title .icon-svg{width:18px;height:18px}
.ai-close{background:rgba(255,255,255,.15);border:none;color:#fff;width:26px;height:26px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1}
.ai-close:hover{background:rgba(255,255,255,.28)}
.ai-quota{font-size:10.5px;color:rgba(255,255,255,.85);margin-top:2px}
.ai-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}
.ai-msg{max-width:88%;padding:10px 13px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
.ai-msg.user{align-self:flex-end;background:#4f46e5;color:#fff;border-radius:12px 12px 2px 12px}
.ai-msg.bot{align-self:flex-start;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px 12px 12px 2px}
.ai-msg.err{align-self:flex-start;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;border-radius:12px}
.ai-msg.typing{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;padding:10px 14px;border-radius:12px 12px 12px 2px}
.ai-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#94a3b8;margin-right:3px;animation:cbc-bounce 1.2s infinite}
.ai-dot:nth-child(2){animation-delay:.15s}.ai-dot:nth-child(3){animation-delay:.3s}
@keyframes cbc-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-3px);opacity:1}}
.ai-empty{text-align:center;color:#94a3b8;font-size:12.5px;padding:24px 12px}
.ai-empty .icon-svg{width:28px;height:28px;margin-bottom:8px;opacity:.5}
.ai-input-row{padding:12px;border-top:1px solid #e2e8f0;display:flex;gap:8px;background:#fff;flex-shrink:0}
.ai-input-row textarea{flex:1;resize:none;border:1.5px solid #e2e8f0;border-radius:12px;padding:9px 12px;font-size:13px;font-family:inherit;outline:none;max-height:90px;min-height:38px}
.ai-input-row textarea:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
.ai-send{width:38px;height:38px;border-radius:10px;background:#4f46e5;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ai-send:hover{background:#4338ca}
.ai-send:disabled{background:#c7d2fe;cursor:not-allowed}
.ai-send .icon-svg{width:16px;height:16px}
@media(max-width:480px){
  .ai-panel{right:8px;left:8px;bottom:8px;width:auto;max-height:min(72vh,560px)}
  .ai-fab{right:16px;bottom:16px}
}
`;

// ── Inject CSS into document <head> — works regardless of DOM state ──
export function injectStyles() {
  if (document.getElementById("cbc-shared-css")) return; // already injected
  const style = document.createElement("style");
  style.id = "cbc-shared-css";
  style.textContent = CSS;
  document.head.appendChild(style);
  // Hoist modals out of flex containers as soon as DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hoistModals);
  } else {
    hoistModals();
  }
}

// Keep SHARED_CSS export for backward compat (some pages assign to <style> tag)
export const SHARED_CSS = CSS;

const ICONS = {
  school: '<path d="M3 21h18"/><path d="M5 21V9l7-4 7 4v12"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01"/><path d="M15 10h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-7"/>',
  student: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  teacher: '<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M19 8h3v8h-3"/>',
  clipboard: '<path d="M9 5h6"/><path d="M9 3h6v4H9z"/><path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M8 12h8"/><path d="M8 16h6"/>',
  attendance: '<path d="M20 6 9 17l-5-5"/>',
  assessment: '<path d="M4 20h16"/><path d="M6 18 17.5 6.5a2.1 2.1 0 0 1 3 3L9 21H6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
  scale: '<path d="M12 3v18"/><path d="M5 6h14"/><path d="M6 6l-3 7h6z"/><path d="M18 6l-3 7h6z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5a2 2 0 0 0-2-2h-5"/>',
  sparkle: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M16.3 16.3l2.1 2.1"/><path d="M5.6 18.4l2.1-2.1"/><path d="M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="2.5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>'
};

export function icon(name, label = "") {
  const paths = ICONS[name] || ICONS.clipboard;
  const aria = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<svg class="icon-svg" viewBox="0 0 24 24"${aria}>${paths}</svg>`;
}

// ── Sidebar HTML builder ──────────────────────────────────────────
export function buildSidebar(navItems, activePanel) {
  const user = getUser();
  const initials = (user?.name || "U").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return `
  <div class="sidebar-overlay" id="sidebarOverlay"></div>
  <aside class="sidebar" id="mainSidebar">
    <div class="sidebar-brand">
      <div class="brand-icon">${icon("school", "School")}</div>
      <div>
        <h2>Kadem & Zetu School Management System</h2>
        <p>${esc(user?.school_name || "System Admin")}</p>
      </div>
    </div>
    <div class="school-meta">
      <div class="meta-row"><span>Code</span><strong>${esc(user?.school_code || "–")}</strong></div>
      <div class="meta-row"><span>Year</span><strong>${esc(user?.academic_year || "–")}</strong></div>
      <div class="meta-row"><span>Term</span><strong>Term ${esc(String(user?.current_term || "–"))}</strong></div>
    </div>
    <nav class="nav" id="mainNav">
      ${navItems.map(n => `
        <div class="nav-item${n.panel === activePanel ? " active" : ""}" data-panel="${esc(n.panel)}">
          <span class="nav-icon">${icon(n.icon, n.label)}</span>${esc(n.label)}
        </div>`).join("")}
    </nav>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="avatar">${esc(initials)}</div>
        <div class="user-info">
          <strong>${esc(user?.name || "User")}</strong>
          <span class="role-badge">${esc(user?.role || "")}</span>
        </div>
      </div>
      <button class="btn-logout" id="logoutBtn">${icon("logout")} Sign Out</button>
    </div>
  </aside>`;
}

// ── Mobile sidebar helpers ────────────────────────────────────────
function openSidebar() {
  document.body.classList.add("sidebar-open");
  document.body.style.overflow = "hidden";
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  document.body.style.overflow = "";
}

// ── Nav & logout wiring ───────────────────────────────────────────
export function setupNav(loaders) {
  // Hamburger button
  document.getElementById("mobMenuBtn")?.addEventListener("click", openSidebar);
  // Overlay click closes sidebar
  document.getElementById("sidebarOverlay")?.addEventListener("click", closeSidebar);

  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
      el.classList.add("active");
      const panel = el.dataset.panel;
      document.getElementById("panel-" + panel)?.classList.add("active");
      document.getElementById("pageTitle").textContent = el.textContent.trim();
      loaders[panel]?.();
      // Close sidebar on mobile after navigation
      closeSidebar();
    });
  });
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    const b = document.getElementById("logoutBtn");
    b.disabled = true; b.textContent = "Signing out...";
    await logout();
  });
}

// ── Modal helpers ─────────────────────────────────────────────────
// Move all .modal-bg elements to end of <body> so they are never
// trapped inside a flex/grid container, which breaks fixed positioning.
export function hoistModals() {
  document.querySelectorAll(".modal-bg").forEach(el => document.body.appendChild(el));
}

export function openModal(id)  {
  const el = document.getElementById(id);
  if (!el) return;
  // Ensure it's a direct body child every time (safe to call repeatedly)
  document.body.appendChild(el);
  el.classList.add("open");
  document.body.style.overflow = "hidden";
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("open");
  // Only restore scroll if no other modal is open
  if (!document.querySelector(".modal-bg.open")) {
    document.body.style.overflow = "";
  }
}
export function resetModal(id) {
  document.querySelectorAll(`#${id} input,#${id} textarea`).forEach(el => el.value = "");
  document.querySelectorAll(`#${id} select`).forEach(el => el.selectedIndex = 0);
  document.querySelectorAll(`#${id} [data-alert]`).forEach(el => el.innerHTML = "");
}

// ── Alert & loading helpers ───────────────────────────────────────
export function showAlert(el, msg, type = "err") {
  if (typeof el === "string") el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type === "ok" ? "ok" : "err"}">${esc(msg)}</div>`;
}

export function setLoading(btn, on) {
  if (typeof btn === "string") btn = document.getElementById(btn);
  if (!btn) return;
  on ? btn.classList.add("btn-loading") : btn.classList.remove("btn-loading");
  btn.disabled = on;
}

// ── AI Assistant widget — floating button + chat panel ─────────────
// Shared across every dashboard. Calls POST /ai/assist via api.js,
// which is already gated server-side by subscription + rate limits.
// Call buildAiWidget() once into the page, then setupAiWidget() after
// the DOM is in place.
export function buildAiWidget() {
  return `
  <button class="ai-fab" id="aiFab" aria-label="Open AI Assistant">${icon("sparkle", "AI Assistant")}</button>
  <div class="ai-panel" id="aiPanel">
    <div class="ai-hdr">
      <div>
        <div class="ai-hdr-title">${icon("sparkle")} AI Assistant</div>
        <div class="ai-quota" id="aiQuotaLabel"></div>
      </div>
      <button class="ai-close" id="aiClose" aria-label="Close">×</button>
    </div>
    <div class="ai-body" id="aiBody">
      <div class="ai-empty">${icon("sparkle")}<div>Ask about attendance, fees, report comments, CBC guidance, or anything school-admin related.</div></div>
    </div>
    <div class="ai-input-row">
      <textarea id="aiInput" rows="1" placeholder="Ask the assistant…" maxlength="4000"></textarea>
      <button class="ai-send" id="aiSend" aria-label="Send">${icon("send")}</button>
    </div>
  </div>`;
}

export function setupAiWidget() {
  const fab    = document.getElementById("aiFab");
  const panel  = document.getElementById("aiPanel");
  const closeB = document.getElementById("aiClose");
  const body   = document.getElementById("aiBody");
  const input  = document.getElementById("aiInput");
  const sendB  = document.getElementById("aiSend");
  const quotaL = document.getElementById("aiQuotaLabel");
  if (!fab || !panel) return;

  fab.addEventListener("click", () => {
    panel.classList.add("open");
    fab.style.display = "none";
    input.focus();
  });
  closeB.addEventListener("click", () => {
    panel.classList.remove("open");
    fab.style.display = "flex";
  });

  function addMsg(text, cls) {
    // ai-empty placeholder gets cleared on first real message
    const placeholder = body.querySelector(".ai-empty");
    if (placeholder) placeholder.remove();
    const div = document.createElement("div");
    div.className = "ai-msg " + cls;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  function addTyping() {
    const div = document.createElement("div");
    div.className = "ai-msg typing";
    div.innerHTML = '<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>';
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sendB.disabled) return;
    addMsg(text, "user");
    input.value = "";
    input.style.height = "auto";
    sendB.disabled = true;
    const typingEl = addTyping();
    try {
      const r = await ai.assist({ prompt: text });
      typingEl.remove();
      if (r?.success) {
        addMsg(r.output || "(No response)", "bot");
        if (r.quota) quotaL.textContent = `${r.quota.remaining} requests left today`;
      } else if (r?.code === "AI_DAILY_LIMIT_REACHED") {
        addMsg(r.message || "Daily AI limit reached. Try again tomorrow.", "err");
      } else if (r?.code === "AI_RATE_LIMITED") {
        addMsg(r.message || "Slow down a little — try again in a moment.", "err");
      } else if (r?.code === "SUBSCRIPTION_REQUIRED" || r?.code === "AI_NOT_ON_PLAN") {
        addMsg(r.message || "AI isn't available on the current plan.", "err");
      } else {
        addMsg(r?.message || "Something went wrong. Please try again.", "err");
      }
    } catch (e) {
      typingEl.remove();
      addMsg("Network error — please try again.", "err");
    } finally {
      sendB.disabled = false;
    }
  }

  sendB.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 90) + "px";
  });
}
