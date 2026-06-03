/**
 * Shared layout helpers — sidebar, topbar, modals, alerts
 */
import { esc, getUser, logout } from "/js/api.js";

export function buildSidebar(navItems, activePanel) {
  const user = getUser();
  const initials = (user?.name || "U").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  return `
  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-icon">🏫</div>
      <div>
        <h2>CBC School ERP</h2>
        <p>${esc(user?.school_name || "System")}</p>
      </div>
    </div>
    <div class="school-meta">
      <div class="meta-row"><span>Code</span><strong>${esc(user?.school_code||"–")}</strong></div>
      <div class="meta-row"><span>Year</span><strong>${esc(user?.academic_year||"–")}</strong></div>
      <div class="meta-row"><span>Term</span><strong>Term ${esc(String(user?.current_term||"–"))}</strong></div>
    </div>
    <nav class="nav" id="mainNav">
      ${navItems.map(n=>`
        <div class="nav-item${n.panel===activePanel?" active":""}" data-panel="${esc(n.panel)}">
          <span class="nav-icon">${n.icon}</span>${esc(n.label)}
        </div>`).join("")}
    </nav>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="avatar">${esc(initials)}</div>
        <div class="user-info">
          <strong>${esc(user?.name||"User")}</strong>
          <span class="role-badge">${esc(user?.role||"")}</span>
        </div>
      </div>
      <button class="btn-logout" id="logoutBtn">🚪 Sign Out</button>
    </div>
  </aside>`;
}

export function setupNav(loaders) {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
      el.classList.add("active");
      const panel = el.dataset.panel;
      document.getElementById("panel-"+panel)?.classList.add("active");
      document.getElementById("pageTitle").textContent = el.textContent.trim();
      loaders[panel]?.();
    });
  });
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    const b = document.getElementById("logoutBtn");
    b.disabled = true; b.textContent = "Signing out…";
    await logout();
  });
}

export function openModal(id)  { document.getElementById(id)?.classList.add("open"); }
export function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }
export function resetModal(id) {
  document.querySelectorAll(`#${id} input,#${id} textarea`).forEach(el=>el.value="");
  document.querySelectorAll(`#${id} select`).forEach(el=>el.selectedIndex=0);
  document.querySelectorAll(`#${id} [data-alert]`).forEach(el=>el.innerHTML="");
}

export function showAlert(el, msg, type="err") {
  if (typeof el === "string") el = document.getElementById(el);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type==="ok"?"ok":"err"}">${esc(msg)}</div>`;
}

export function setLoading(btn, on) {
  if (typeof btn === "string") btn = document.getElementById(btn);
  if (!btn) return;
  on ? btn.classList.add("btn-loading") : btn.classList.remove("btn-loading");
  btn.disabled = on;
}

export const SHARED_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#f1f5f9;color:#0f172a;min-height:100vh;display:flex}
.sidebar{width:265px;background:#fff;display:flex;flex-direction:column;flex-shrink:0;height:100vh;position:sticky;top:0;border-right:1px solid #e2e8f0;overflow-y:auto}
.sidebar-brand{padding:22px 20px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #f1f5f9}
.brand-icon{font-size:28px;line-height:1}
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
.nav-icon{font-size:16px;width:20px;text-align:center}
.sidebar-footer{padding:16px;border-top:1px solid #f1f5f9}
.user-card{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.user-info strong{display:block;font-size:13px;color:#0f172a;font-weight:700}
.role-badge{font-size:10px;font-weight:700;background:#e0e7ff;color:#4338ca;padding:2px 7px;border-radius:20px;display:inline-block;margin-top:2px}
.btn-logout{background:#f1f5f9;border:none;color:#ef4444;padding:10px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;width:100%;transition:all .2s;font-family:inherit}
.btn-logout:hover{background:#fee2e2}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{background:#fff;padding:16px 28px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.topbar h3{font-size:18px;font-weight:700;color:#0f172a}
.topbar-right{font-size:12.5px;color:#64748b;font-weight:500}
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
.btn{padding:9px 16px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.btn-primary{background:#4f46e5;color:#fff}.btn-primary:hover{background:#4338ca;box-shadow:0 4px 12px rgba(79,70,229,.3)}
.btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
.btn-ghost{background:#f1f5f9;color:#64748b}.btn-ghost:hover{background:#e2e8f0;color:#0f172a}
.btn-sm{padding:5px 10px;font-size:11.5px;border-radius:7px}
.btn-warn{background:#f59e0b;color:#fff}.btn-warn:hover{background:#d97706}
.btn-success{background:#10b981;color:#fff}.btn-success:hover{background:#059669}
.btn-loading{position:relative;color:transparent!important;pointer-events:none}
.btn-loading::after{content:"";position:absolute;width:15px;height:15px;top:50%;left:50%;margin:-7.5px 0 0 -7.5px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.badge{padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap}
.bg{background:#dcfce7;color:#15803d}.br{background:#fee2e2;color:#b91c1c}
.bb{background:#e0e7ff;color:#4338ca}.by{background:#fef9c3;color:#854d0e}
.bpurple{background:#f3e8ff;color:#7e22ce}.bgray{background:#f1f5f9;color:#64748b}
.bteal{background:#ccfbf1;color:#0f766e}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:300;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 20px}
.modal-bg.open{display:flex}
.modal{background:#fff;border-radius:18px;padding:28px;width:100%;max-width:540px;box-shadow:0 24px 48px rgba(0,0,0,.18);margin:auto}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.modal-hdr h3{font-size:17px;font-weight:700;color:#0f172a}
.modal-close{background:none;border:none;font-size:24px;cursor:pointer;color:#94a3b8;line-height:1;padding:0}
.modal-close:hover{color:#0f172a}
.fg{margin-bottom:14px}
.fg label{display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
.fg input,.fg select,.fg textarea{width:100%;padding:10px 14px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13.5px;color:#0f172a;font-family:inherit;outline:none;transition:border-color .15s}
.fg input:focus,.fg select:focus,.fg textarea:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
.fg textarea{resize:vertical;min-height:70px}
.fg-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fg-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.modal-actions{display:flex;gap:10px;margin-top:22px;justify-content:flex-end}
.alert{padding:11px 14px;border-radius:10px;font-size:13px;margin-top:12px;font-weight:500;border:1px solid transparent}
.alert-err{background:#fee2e2;color:#b91c1c;border-color:#fecaca}
.alert-ok{background:#dcfce7;color:#15803d;border-color:#bbf7d0}
.empty{text-align:center;padding:44px 20px;color:#94a3b8;font-size:14px}
.filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.filter-bar input,.filter-bar select{padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;background:#fff;font-family:inherit;outline:none}
.filter-bar input:focus,.filter-bar select:focus{border-color:#4f46e5}
.table-wrap{overflow-x:auto}
.action-btns{display:flex;gap:5px}
.level-EE{background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px}
.level-ME{background:#e0e7ff;color:#4338ca;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px}
.level-AE{background:#fef9c3;color:#854d0e;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px}
.level-BE{background:#fee2e2;color:#b91c1c;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px}
`;
