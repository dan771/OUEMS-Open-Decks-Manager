import {
  EXPERIENCE,
  nextTerm,
  parseCSV,
  discover,
  generateSlots,
  formatTime,
  availabilityFor,
  preferredPeriods,
  periodBounds,
  instancePeriod,
  slotPeriod,
  automaticPlan,
  timeMinutes,
} from "./lib/domain.js";
const $ = (s) => document.querySelector(s);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  plus: "M8 3v10M3 8h10",
  search: "M11 11l4 4M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  close: "M4 4l8 8M12 4l-8 8",
  comment: "M2 3h12v8H7l-4 3v-3H2z",
  vinyl:
    "M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0M4 5l1-1M11 12l1-1",
  grip: "M5 3h.1M10 3h.1M5 8h.1M10 8h.1M5 13h.1M10 13h.1",
  configure: "M2 4h12M2 12h12M5 2v4M11 10v4",
  refresh: "M13 6a5 5 0 1 0 0 5M13 2v4H9",
  copy: "M6 6h8v8H6zM10 6V2H2v8h4",
  download: "M8 1v9M5 7l3 3 3-3M2 11v4h12v-4",
  arrow: "M3 8h10M9 4l4 4-4 4",
  info: "M8 7v5M8 4h.1M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0",
  check: "M3 8l3 3 7-7",
  left: "M10 3L5 8l5 5",
  right: "M6 3l5 5-5 5",
  university: "M1 5l7-4 7 4H1zM2 14h12M3 7v5M6 7v5M10 7v5M13 7v5",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${icons[name] || icons.info}"/></svg>`;
const dateLabel = (date, options = { day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: "Europe/London",
  }).format(new Date(date + "T12:00:00Z"));
let state,
  meta = {},
  activeId = localStorage.getItem("ouems-term"),
  filters = { search: "", experience: "", vinyl: "" },
  dragId = null,
  busy = false,
  polling = false,
  dialogVersion = null,
  dialogInstance = null,
  focusReturn = null,
  createDraft = null,
  compact = localStorage.getItem("ouems-compact") === "true",
  demographicCards =
    localStorage.getItem("ouems-card-details") === "demographics",
  toastTimer;
let planDraft = null;
const canEdit = () => ["administrator", "manager"].includes(meta.user?.role);
const isAdmin = () => meta.user?.role === "administrator";
const roleName = (role) =>
  ({ administrator: "Administrator", manager: "Manager", viewer: "Viewer" })[
    role
  ] || "";
const initials = (name) => {
  const words = name.trim().split(/\s+/);
  return (
    words.length > 1 ? words[0][0] + words.at(-1)[0] : words[0].slice(0, 2)
  ).toUpperCase();
};
function accountMenu(user) {
  return `<div class="account-control"><button type="button" class="avatar" data-action="toggle-account" aria-label="Account menu for ${escape(user)}" aria-expanded="false" aria-controls="account-menu" title="${escape(user)}">${escape(initials(user))}</button><div id="account-menu" class="account-dropdown" hidden><div class="account-identity"><strong>${escape(user)}</strong><span>${escape(meta.user.username)} · ${roleName(meta.user.role)}</span></div>${meta.local ? '<p class="account-context">Local workspace · fictional demo DJs. Changes save on this computer.</p>' : ""}<button data-action="account">Change password</button>${isAdmin() ? `<div class="account-section"><span>Administration</span><button data-action="users">Users & roles</button><button data-action="history">Edit history & saved states</button>${current() ? '<button class="danger" data-action="delete-board">Delete current board</button>' : ""}<a href="/api/export" aria-label="Export workspace">${icon("download")}Export workspace</a></div>` : ""}<button data-action="logout" class="account-signout">Sign out</button></div></div>`;
}
function closeAccountMenu(restoreFocus = false) {
  const trigger = $('[data-action="toggle-account"]');
  const menu = $("#account-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger.focus({ preventScroll: true });
}
const collapseKey = (nightId, period) => `ouems-collapsed-${nightId}-${period}`;
const periodLabel = (period) => (period === "late" ? "Late" : "Early");
const boardHint =
  "Drag cards into Early or Late. Add moves a card; Duplicate makes another.";
const current = () =>
  state?.terms.find((t) => t.id === activeId) || state?.terms.at(-1);
const mobileViewport = window.matchMedia("(max-width: 800px)");
const pageIds = (term) => ["unassigned", ...term.nights.map((n) => n.id)];
function selectedPage(term) {
  const saved = localStorage.getItem(`ouems-night-${term.id}`);
  return pageIds(term).includes(saved) ? saved : "unassigned";
}
function selectPage(id, term = current()) {
  if (!term) return;
  localStorage.setItem(`ouems-night-${term.id}`, id || "unassigned");
  document.querySelectorAll(".board > .column").forEach((column) => {
    column.classList.toggle(
      "mobile-active",
      (column.dataset.nightColumn || "unassigned") === selectedPage(term),
    );
  });
  if (mobileViewport.matches && $(".board")) $(".board").scrollLeft = 0;
}
function columnHeading(term, id, title, count) {
  const pages = pageIds(term),
    index = pages.indexOf(id);
  return `<div class="column-heading"><button class="mobile-night-nav" data-action="previous-night" data-page="${pages[index - 1] || ""}" aria-label="Previous night" ${index === 0 ? "disabled" : ""}>${icon("left")}</button><h2>${title} <span class="count">${count}</span></h2><span class="mobile-page-count" aria-label="Page ${index + 1} of ${pages.length}">${index + 1}/${pages.length}</span><button class="mobile-night-nav" data-action="next-night" data-page="${pages[index + 1] || ""}" aria-label="Next night" ${index === pages.length - 1 ? "disabled" : ""}>${icon("right")}</button></div>`;
}
mobileViewport.addEventListener("change", () => {
  if (current()) selectPage(selectedPage(current()));
});
function notify(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.className = `visible${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = ""), 5500);
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "Content-Type": "application/json", "X-CSRF-Token": meta.csrf || "" }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Cannot reach the app. Check your connection or sign in again.",
    );
  }
  if (!response.ok) {
    if (response.status === 401) {
      state = null;
      meta = {};
      $("#dialog").close();
      $("#app").replaceChildren();
      window.location.replace("/login");
    }
    const e = new Error(data.error || "Request failed.");
    e.status = response.status;
    throw e;
  }
  return data;
}
async function refresh(initial = false) {
  if (!meta.user && !initial) return;
  if (polling || busy) return;
  polling = true;
  try {
    const data = await api("/api/state");
    // A poll started before a save can finish after it. Never adopt older data.
    if (state && data.state.version < state.version) return;
    const changed =
      !state ||
      state.version !== data.state.version ||
      meta.user?.role !== data.user.role;
    const roleChanged = meta.user && meta.user.role !== data.user.role;
    state = data.state;
    meta = data;
    if (roleChanged) {
      $("#dialog").close();
      dialogInstance = null;
      planDraft = null;
      render();
    }
    if (!activeId || !state.terms.some((t) => t.id === activeId))
      activeId = current()?.id;
    if (initial || changed) {
      if (!$("#dialog").open && !dragId) render();
    }
  } catch (e) {
    if (initial) {
      $("#app").innerHTML =
        `<div class="empty-board"><h2>Open Decks is waiting</h2><p>${escape(e.message)}</p><button data-action="retry">Try again</button></div>`;
    } else notify(e.message, true);
  } finally {
    polling = false;
  }
}
async function mutation(path, input, version = state.version) {
  if (busy) return false;
  busy = true;
  try {
    const out = await api(path, { ...input, version });
    state = out.state;
    if (out.result?.termId) activeId = out.result.termId;
    if (input.type === "move" && "nightId" in input) selectPage(input.nightId);
    return out;
  } catch (e) {
    if (e.status === 409) {
      const data = await api("/api/state");
      state = data.state;
    }
    showError(e.message);
    if (e.status === 409 && dialogInstance) {
      const reload = document.createElement("button");
      reload.dataset.action = "review-latest";
      reload.textContent = "Review latest DJ";
      reload.style.marginTop = "10px";
      $("#dialog .inline-error").append(document.createElement("br"), reload);
    }
    return false;
  } finally {
    busy = false;
    if (!$("#dialog").open) render();
  }
}
function showError(message) {
  if ($("#dialog").open) {
    let el = $("#dialog .inline-error");
    if (!el) {
      el = document.createElement("div");
      el.className = "inline-error";
      el.setAttribute("role", "alert");
      $("#dialog .modal-body").prepend(el);
    }
    el.textContent = message;
    el.scrollIntoView({ block: "nearest" });
  } else notify(message, true);
}
const matchesProfile = (p, search) =>
  !search ||
  [p.name, p.fullName, p.genres, p.college, p.ethnicity, p.gender].some((s) =>
    String(s || "")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
const visibleProfile = (p) =>
  matchesProfile(p, filters.search) &&
  (!filters.experience || p.experience === filters.experience) &&
  (!filters.vinyl || p.vinyl === filters.vinyl);
const profileFor = (term, instance) =>
  term.profiles.find((p) => p.id === instance.profileId);
const demographicText = (p, labelled = true) =>
  [
    p.ethnicity && (labelled ? `Ethnicity: ${p.ethnicity}` : p.ethnicity),
    p.gender && (labelled ? `Gender: ${p.gender}` : p.gender),
  ]
    .filter(Boolean)
    .join(" · ") || "Ethnicity / gender not specified";
const cardDetails = (p) =>
  demographicCards
    ? demographicText(p, !compact)
    : p.genres || "Genres to be confirmed";
const responsiveLabel = (label, short) =>
  `<span class="control-label">${escape(label)}</span><span class="control-label-short" aria-hidden="true">${escape(short)}</span>`;
function availabilityDots(term, profile) {
  const labels = {
    available: "Available",
    outside: "Outside preferred half",
    unavailable: "Unavailable",
    unknown: "Availability not specified",
  };
  const dots = term.nights.flatMap((night) =>
    ["early", "late"].map((period) => {
      const status = availabilityFor(profile, night, period);
      const label = `${dateLabel(night.date)} · ${periodLabel(period)}: ${labels[status]}`;
      return { status, label };
    }),
  );
  return `<span class="card-availability" role="img" aria-label="${escape(`Availability by night, Early then Late. ${dots.map((dot) => dot.label).join("; ")}`)}" title="${escape(`Columns follow the nights from left to right; Early on top, Late below.\n${dots.map((dot) => dot.label).join("\n")}`)}">${dots.map((dot) => `<span class="availability-dot ${dot.status}" title="${escape(dot.label)}" aria-hidden="true"></span>`).join("")}</span>`;
}
function card(term, instance) {
  const p = profileFor(term, instance);
  const duplicates = term.instances.filter((i) => i.profileId === p.id).length;
  const badge = p.experience.replaceAll(" ", "-");
  const night = term.nights.find((n) => n.id === instance.nightId);
  const slot =
    night && instance.slot != null ? generateSlots(night)[instance.slot] : null;
  const status = night
    ? availabilityFor(p, night, slot || instancePeriod(term, instance))
    : "unknown";
  const warning =
    status === "outside"
      ? "Outside preferred time · override"
      : status === "unavailable"
        ? "Not available for this night · override"
        : "";
  return `<article class="dj-card placement-${status} ${night && canEdit() ? "can-remove" : ""}" draggable="${canEdit()}" data-instance="${instance.id}" data-confirmed="${instance.confirmed === true}" data-testid="dj-card" title="${escape(warning || p.name)}"><button class="card-open" data-action="edit-card" data-id="${instance.id}" aria-label="${canEdit() ? "Edit" : "View"} ${escape(p.name)}"><div class="card-title"><span>${escape(p.name)}</span>${canEdit() && !night ? icon("grip", "grip") : ""}</div>${availabilityDots(term, p)}<p class="genres" data-card-details="${demographicCards ? "demographics" : "genres"}" title="${escape(demographicCards ? demographicText(p) : cardDetails(p))}">${slot ? `<span class="set-time">${formatTime(slot.start)}–${formatTime(slot.end)} · </span>` : ""}${escape(cardDetails(p))}</p><div class="card-footer"><span class="badge ${badge}" title="${escape(p.experience)}">${escape(p.experience)}</span><span class="card-symbols">${p.college?.trim() ? `<span class="college-marker" title="${escape(p.college)}" aria-label="College: ${escape(p.college)}">${icon("university")}</span>` : ""}${["yes", "learn"].includes(p.vinyl) ? `<span class="vinyl-marker" title="${escape(vinylText(p.vinyl))}" aria-label="Vinyl">${icon("vinyl")}</span>` : ""}${p.comments.length ? `<span title="${p.comments.length} comment${p.comments.length === 1 ? "" : "s"}" aria-label="${p.comments.length} comments">${icon("comment")}${p.comments.length}</span>` : ""}${duplicates > 1 ? `<span title="${duplicates} linked cards" aria-label="${duplicates} linked cards">${icon("copy")}</span>` : ""}</span></div>${warning ? `<div class="placement-warning">${warning}</div>` : ""}</button>${night ? confirmationControl(p, instance, night) : ""}${night && canEdit() ? `<button class="card-remove" data-action="unassign" data-id="${instance.id}" title="Move to Unassigned" aria-label="Remove ${escape(p.name)} from night">${icon("close")}</button>` : ""}</article>`;
}
function confirmationControl(profile, instance, night) {
  const confirmed = instance.confirmed === true;
  const label = `Final confirmation for ${profile.name} on ${dateLabel(night.date)}`;
  const title = confirmed
    ? "Final confirmation received"
    : "Awaiting DJ's final confirmation";
  return canEdit()
    ? `<button class="card-confirmation ${confirmed ? "is-confirmed" : ""}" type="button" data-action="confirm-card" data-id="${instance.id}" aria-label="${escape(label)}" aria-pressed="${confirmed}" title="${title} · Click to toggle">${icon("check")}</button>`
    : `<span class="card-confirmation ${confirmed ? "is-confirmed" : ""}" role="img" aria-label="${escape(`${label}: ${title}`)}" title="${title}">${icon("check")}</span>`;
}
function vinylText(value) {
  return {
    yes: "Vinyl",
    learn: "Interested in learning vinyl",
    either: "Not specified",
    no: "Digital only",
  }[value];
}
function captureBoardView() {
  const board = $(".board");
  if (!board) return null;
  return {
    termId: board.dataset.term,
    left: board.scrollLeft,
    top: board.scrollTop,
    windowX: window.scrollX,
    windowY: window.scrollY,
    columns: [...board.querySelectorAll(".column")].map((column) => ({
      nightId: column.dataset.nightColumn || null,
      top: column.querySelector(".column-content, .cards").scrollTop,
    })),
  };
}
function restoreBoardView(view) {
  const board = $(".board");
  if (!view || !board || board.dataset.term !== view.termId) return;
  for (const column of board.querySelectorAll(".column")) {
    const saved = view.columns.find(
      (item) => item.nightId === (column.dataset.nightColumn || null),
    );
    if (!saved) continue;
    column.querySelector(".column-content, .cards").scrollTop = saved.top;
  }
  board.scrollLeft = mobileViewport.matches ? 0 : view.left;
  board.scrollTop = view.top;
  window.scrollTo({
    left: view.windowX,
    top: view.windowY,
    behavior: "instant",
  });
}
function render(view = captureBoardView()) {
  if (!state || !meta.user) return;
  document.body.classList.toggle("compact", compact);
  const term = current();
  const assigned = term?.instances.filter((i) => i.nightId).length || 0;
  const user = meta.user.name || meta.user.username;
  $("#app").innerHTML =
    `<header class="topbar"><div class="brand"><img src="/assets/ouems-logo.png" alt="Oxford Electronic Music Society"><span class="brand-divider"></span><h1 class="workspace-title">Open <span>Decks.</span></h1></div><nav class="nav-actions" aria-label="Workspace"><label for="term-select" class="visually-hidden">Oxford term</label><select id="term-select" class="term-select">${state.terms.map((t) => `<option value="${t.id}" ${t.id === term?.id ? "selected" : ""}>${t.code}${t.demo ? " · demo" : ""}</option>`).join("") || "<option>No terms</option>"}</select><button data-action="create" class="primary" aria-label="Create Open Decks" title="Create Open Decks">${icon("plus")}<span class="create-label">Create Open Decks</span><span class="create-label-short" aria-hidden="true">Create</span></button>${accountMenu(user)}</nav></header>${term ? `<section class="toolbar" aria-label="Board filters"><div class="filters"><label class="search"><span class="visually-hidden">Search DJs, genres, college, ethnicity or gender</span>${icon("search")}<input id="search" type="search" placeholder="Search DJs or details…" value="${escape(filters.search)}"></label><label class="visually-hidden" for="experience-filter">Filter experience</label><select id="experience-filter"><option value="">All experience</option>${EXPERIENCE.map((e) => `<option ${filters.experience === e ? "selected" : ""}>${e}</option>`).join("")}</select><label class="visually-hidden" for="vinyl-filter">Filter vinyl</label><select id="vinyl-filter"><option value="">All formats</option>${["yes", "learn", "no", "either"].map((v) => `<option value="${v}" ${filters.vinyl === v ? "selected" : ""}>${vinylText(v)}</option>`).join("")}</select></div><div class="toolbar-right"><button data-action="toggle-compact" class="small compact-toggle" aria-label="Compact mode" aria-pressed="${compact}">${responsiveLabel("Compact mode", "Compact")}</button><button data-action="toggle-card-details" class="small card-details-toggle" aria-label="${demographicCards ? "Show genres" : "Show ethnicity and gender"}" aria-pressed="${demographicCards}" title="${demographicCards ? "Showing ethnicity and gender; switch to genres" : "Showing genres; switch to ethnicity and gender"}">${responsiveLabel(demographicCards ? "Ethnicity / gender" : "Genres", demographicCards ? "E/G" : "Genres")}</button><span class="import-status ${term.importError ? "error" : ""}">${term.importError ? escape(term.importError) : term.sheetUrl ? `<i class="live-dot"></i>New responses checked every 5 min${term.lastImport ? `<br>Last checked ${escape(new Date(term.lastImport).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }))}` : ""}` : "Manual imports · edits saved automatically"}</span><button data-action="import" class="small" aria-label="${term.sheetUrl ? "Check responses" : "Import CSV"}" title="${term.sheetUrl ? "Check responses" : "Import CSV"}">${icon("refresh")}${responsiveLabel(term.sheetUrl ? "Check responses" : "Import CSV", "Import")}</button></div></section><div class="board-help"><span id="drag-help">${boardHint}</span><div class="legend"><span><i></i>Available</span><span class="outside"><i></i>Outside preferred time</span><span class="unavailable"><i></i>Unavailable · can override</span></div></div><main class="board" aria-label="${term.code} Open Decks board">${boardHTML(term)}</main><footer class="footnote"><span>${term.code} / ${term.instances.length} cards · ${term.profiles.length} DJs · ${term.nights.length} nights · ${assigned} assigned</span><span>${meta.local ? "Local saves" : "Shared saves"} · Times in Europe/London · ${escape(user)}</span></footer>` : `<main class="empty-board"><h2>Your next lineup starts here.</h2><p>Create a term and link its Google Form response sheet.</p><button class="primary" data-action="create">${icon("plus")}Create Open Decks</button></main>`}`;
  $(".board")?.setAttribute("data-term", term?.id || "");
  if (term && canEdit())
    $(".toolbar-right").insertAdjacentHTML(
      "afterbegin",
      '<button class="small" data-action="add-night" aria-label="Add a night" title="Add a night"><span class="control-label">Add a night</span><span class="control-label-short" aria-hidden="true">Night</span></button>',
    );
  if (!canEdit()) {
    document
      .querySelectorAll(
        '#app [data-action="create"], #app [data-action="import"], #app .add-card, #app [data-action="configure"], #app [data-action="plan-sets"]',
      )
      .forEach((el) => el.remove());
    $("#drag-help")?.replaceChildren(
      document.createTextNode(
        "View the lineup, set times and DJ availability.",
      ),
    );
    $(".empty-board p")?.replaceChildren(
      document.createTextNode("Your organisers have not created a lineup yet."),
    );
  }
  restoreBoardView(view);
  if (term) selectPage(selectedPage(term));
}
function boardHTML(term) {
  const free = term.instances.filter(
    (i) => !i.nightId && visibleProfile(profileFor(term, i)),
  );
  return `<section class="column unassigned">
    <header class="column-header drop-zone" data-night=""><p class="column-kicker">The starting point ${icon("vinyl")}</p>
    ${columnHeading(term, "unassigned", "Unassigned", term.instances.filter((i) => !i.nightId).length)}
    <div class="night-meta">Find a night. Find your sound.</div></header>
    <div class="cards drop-zone" data-night="">${free.map((i) => card(term, i)).join("") || '<p class="empty-message">No unassigned DJs match.<br>Move cards here to unschedule them.</p>'}</div>
    <button class="add-card" data-action="add-new">${icon("plus")}Add a DJ</button>
  </section>${term.nights.map((night, index) => nightHTML(term, night, index)).join("")}`;
}
function nightHTML(term, night, index) {
  const instances = term.instances.filter((i) => i.nightId === night.id);
  const bounds = periodBounds(night);
  const groups = ["early", "late"]
    .map((period) => {
      const all = instances
        .filter((i) => instancePeriod(term, i) === period)
        .sort((a, b) => (a.slot ?? 10000) - (b.slot ?? 10000));
      const shown = all.filter((i) => visibleProfile(profileFor(term, i)));
      const collapsed =
        localStorage.getItem(collapseKey(night.id, period)) === "true";
      const label = periodLabel(period);
      return `<section class="period-list drop-zone" data-night="${night.id}" data-period="${period}">
      <header class="period-heading"><button data-action="toggle-period" data-id="${night.id}" data-period="${period}" aria-expanded="${!collapsed}" aria-controls="cards-${night.id}-${period}" aria-label="${collapsed ? "Expand" : "Collapse"} ${label}"><span class="chevron">${collapsed ? "▸" : "▾"}</span><strong>${label}</strong><span class="period-time">${formatTime(bounds[period].start)}–${formatTime(bounds[period].end)}</span><span class="count">${all.length}</span></button></header>
      <div class="cards ${shown.length ? "" : "is-empty"}" id="cards-${night.id}-${period}" ${collapsed ? "hidden" : ""}>${inlineSets(term, night, shown) || `<span class="empty-message">${all.length ? "DJs hidden by filters" : canEdit() ? `Drop DJs into ${label.toLowerCase()}` : "No DJs assigned"}</span>`}</div>
    </section>`;
    })
    .join("");
  return `<section class="column" data-night-column="${night.id}">
    <header class="column-header drop-zone" data-night="${night.id}">
      <p class="column-kicker"><strong>${escape(night.venue || "Venue to be confirmed")}</strong><span>${night.week ? "Week " + night.week : dateLabel(night.date, { weekday: "long" })}</span></p>
      ${columnHeading(term, night.id, dateLabel(night.date), instances.length)}
      <div class="night-meta"><span>${dateLabel(night.date, { weekday: "short" })} · ${night.start}—${night.end}</span><button data-action="configure" data-id="${night.id}">${icon("configure")}Configure</button></div>
    </header>
    <div class="column-content">
      ${groups}
    </div>
    ${canEdit() ? `<div class="night-actions"><button class="small" data-action="plan-sets" data-id="${night.id}">${icon("configure")}Plan sets</button><button class="small" data-action="add-picker" data-id="${night.id}">${icon("plus")}Add a DJ to this night</button></div>` : ""}
  </section>`;
}
function inlineSets(term, night, shown) {
  const used = new Set();
  return shown
    .map((instance) => {
      if (used.has(instance.id)) return "";
      if (instance.slot == null) return card(term, instance);
      const group = shown.filter((i) => i.slot === instance.slot);
      group.forEach((i) => used.add(i.id));
      const slot = generateSlots(night)[instance.slot];
      if (!slot) return card(term, instance);
      const b2b =
        (night.plan?.[instance.slot]?.instanceIds.length || group.length) === 2;
      return `<div class="scheduled-set drop-zone" data-night="${night.id}" data-slot="${instance.slot}" data-period="${slotPeriod(night, slot)}"><div class="scheduled-time">${formatTime(slot.start)}–${formatTime(slot.end)} <span>${slot.end - slot.start} min${b2b ? " · B2B" : ""}${slot.end > 1440 ? " · +1 day" : ""}</span></div>${group.map((i) => card(term, i)).join("")}</div>`;
    })
    .join("");
}
function rerenderBoard() {
  const view = captureBoardView();
  if ($(".board")) $(".board").innerHTML = boardHTML(current());
  restoreBoardView(view);
  if (current()) selectPage(selectedPage(current()));
}
function openDialog(
  title,
  subtitle,
  content,
  footer = "",
  eyebrow = "OPEN DECKS",
) {
  focusReturn = document.activeElement;
  const dialog = $("#dialog");
  dialog.innerHTML = `<div class="modal-header"><div><p class="eyebrow">${escape(eyebrow)}</p><h2 id="dialog-title">${escape(title)}</h2><p>${escape(subtitle)}</p></div><button class="ghost small" data-action="close" aria-label="Close dialog">${icon("close")}</button></div><div class="modal-body">${content}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}`;
  if (!dialog.open) dialog.showModal();
  dialogVersion = state.version;
}
function closeDialog() {
  const view = captureBoardView();
  const dialog = $("#dialog");
  dialog.close();
  dialogInstance = null;
  createDraft = null;
  planDraft = null;
  render(view);
  const target = focusReturn?.isConnected
    ? focusReturn
    : [...document.querySelectorAll("#app [data-action], #app [id]")].find(
        (el) =>
          (focusReturn?.id && el.id === focusReturn.id) ||
          (focusReturn?.dataset.action &&
            el.dataset.action === focusReturn.dataset.action &&
            el.dataset.id === focusReturn.dataset.id &&
            el.dataset.period === focusReturn.dataset.period),
      );
  (target || $("#term-select"))?.focus({ preventScroll: true });
}
function field(label, name, value, type = "text", extra = "") {
  return `<div class="field"><label for="${name}">${escape(label)}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" ${extra}></div>`;
}
function experienceSelect(value) {
  return `<div class="field"><label for="experience">Experience</label><select id="experience" name="experience">${EXPERIENCE.map((e) => `<option ${e === value ? "selected" : ""}>${e}</option>`).join("")}</select></div>`;
}
function vinylSelect(value) {
  return `<div class="field"><label for="vinyl">Vinyl</label><select id="vinyl" name="vinyl">${["no", "yes", "learn", "either"].map((e) => `<option value="${e}" ${e === value ? "selected" : ""}>${vinylText(e)}</option>`).join("")}</select></div>`;
}
function availabilitySummary(profile, term) {
  return term.nights
    .map((night) => {
      const periods = preferredPeriods(profile, night);
      const label =
        periods === null
          ? "Not specified"
          : !periods.length
            ? profile.availability[night.date]?.available
              ? "Outside night hours"
              : "Unavailable"
            : periods.map(periodLabel).join(" & ");
      return `<div class="availability-result ${periods?.length ? "is-available" : ""}">${escape(label)} · ${dateLabel(night.date, { weekday: "long", day: "numeric", month: "short" })}</div>`;
    })
    .join("");
}
function editCard(id) {
  const term = current();
  const instance = term.instances.find((i) => i.id === id);
  const p = profileFor(term, instance);
  if (!canEdit()) {
    openDialog(
      p.name,
      "DJ profile",
      `<p>${escape(p.genres || "Genres to be confirmed")}</p><p>${escape(demographicText(p))}</p>${p.college ? `<p>College: ${escape(p.college)}</p>` : ""}<p><span class="badge">${escape(p.experience)}</span> · ${escape(vinylText(p.vinyl))}</p><p class="section-label">Availability</p>${availabilitySummary(p, term)}`,
      '<button data-action="close">Close</button>',
      term.code,
    );
    return;
  }
  dialogInstance = id;
  const location = instance.nightId
    ? `${periodLabel(instancePeriod(term, instance))} · ${dateLabel(term.nights.find((n) => n.id === instance.nightId).date)}`
    : "Unassigned";
  openDialog(
    p.name,
    `Shared profile · ${term.instances.filter((i) => i.profileId === p.id).length} card instance(s) · ${location}`,
    `<form id="edit-form"><div class="form-grid">${field("DJ name", "name", p.name, "text", 'required maxlength="2000"')}${field("Full name", "fullName", p.fullName)}<div class="field wide"><label for="genres">Genres</label><input id="genres" name="genres" value="${escape(p.genres)}"></div>${field("Ethnicity", "ethnicity", p.ethnicity || "", "text", 'maxlength="2000"')}${field("Gender", "gender", p.gender || "", "text", 'maxlength="2000"')}${field("College", "college", p.college || "", "text", 'maxlength="2000"')}${experienceSelect(p.experience)}${vinylSelect(p.vinyl)}</div>${p.needsReview ? '<p class="hint">The experience answer was ambiguous. Check the transcript and choose the best label.</p>' : ""}<p class="section-label">Available dates & preferred halves</p><div id="availability-summary" class="availability-summary" aria-live="polite">${availabilitySummary(p, term)}</div><p class="hint">First half / early → Early. Second half / late → Late. Don’t mind → both. Edit availability or timing below to update this interpretation.</p><div class="availability-editor">${term.nights
      .map((n, index) => {
        const pref = p.availability[n.date] || { available: null, timing: "" };
        return `<label class="date-pref" for="available-${index}">${dateLabel(n.date, { weekday: "short", day: "numeric", month: "short" })}</label><div><select id="available-${index}" name="available-${index}" aria-label="Availability for ${dateLabel(n.date)}"><option value="true" ${pref.available === true ? "selected" : ""}>Available</option><option value="false" ${pref.available === false ? "selected" : ""}>Unavailable</option><option value="unknown" ${pref.available === null ? "selected" : ""}>Not specified</option></select><input name="timing-${index}" aria-label="Timing preference for ${dateLabel(n.date)}" value="${escape(pref.timing)}" placeholder="Don't mind, or e.g. 6-9pm" style="margin-top:6px"></div>`;
      })
      .join(
        "",
      )}</div><details class="transcript"><summary>Full form response · ${p.transcript.length} answers</summary><p class="hint">Answers are editable here. DJ fields above are managed separately. The original submission remains available below.</p>${p.transcript.map((a, i) => `<div class="field"><label for="answer-${i}">${escape(a.question)}</label><textarea id="answer-${i}" name="answer-${i}">${escape(a.answer)}</textarea></div>`).join("")}<details class="original-response"><summary>View initial response (read only)</summary><dl>${p.original.transcript.map((a) => `<dt>${escape(a.question)}</dt><dd>${escape(a.answer || "—")}</dd>`).join("")}</dl></details></details></form><section class="comment-section"><p class="section-label">Team comments <span class="count">${p.comments.length}</span></p><div id="comments">${commentsHTML(p)}</div><div class="comment-composer"><label class="visually-hidden" for="new-comment">Add a comment</label><textarea id="new-comment" placeholder="Leave a note for the team…" maxlength="5000"></textarea><button data-action="comment">${icon("plus")}Add comment</button></div></section><details class="transcript"><summary>Move this card</summary><label for="move-destination">Night / set</label><select id="move-destination" style="width:100%"><option value="">Unassigned</option>${term.nights
      .map(
        (n) =>
          `<optgroup label="${dateLabel(n.date)}">${["early", "late"].map((period) => `<option value="${n.id}:${period}">${periodLabel(period)} · ${dateLabel(n.date)}</option>`).join("")}${generateSlots(
            n,
          )
            .map(
              (s, i) =>
                `<option value="${n.id}:slot:${i}">${dateLabel(n.date)} · ${formatTime(s.start)}—${formatTime(s.end)}</option>`,
            )
            .join("")}</optgroup>`,
      )
      .join(
        "",
      )}</select><p class="hint">Moving to an occupied set swaps the two card placements.</p><button data-action="move-dialog">${icon("arrow")}Move card</button></details>`,
    `<button class="small danger push-left" data-action="revert">${icon("refresh")}Revert to initial response</button><button data-action="duplicate">${icon("copy")}Duplicate</button><button class="primary" type="submit" form="edit-form">${icon("check")}Save changes</button>`,
    term.code,
  );
  if (!isAdmin()) $('#dialog [data-action="revert"]')?.remove();
}
function commentsHTML(p) {
  return (
    p.comments
      .map(
        (c) =>
          `<article class="comment"><div class="comment-meta">${escape(c.author)} · ${escape(new Date(c.at).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</div><p>${escape(c.text)}</p></article>`,
      )
      .join("") ||
    '<p class="hint">No comments yet. Notes are shared across duplicate cards.</p>'
  );
}
function editPayload() {
  const term = current();
  const f = new FormData($("#edit-form"));
  const p = profileFor(
    term,
    term.instances.find((i) => i.id === dialogInstance),
  );
  return {
    type: "edit",
    termId: term.id,
    profileId: p.id,
    fields: {
      name: f.get("name"),
      fullName: f.get("fullName"),
      genres: f.get("genres"),
      college: f.get("college"),
      ethnicity: f.get("ethnicity"),
      gender: f.get("gender"),
      experience: f.get("experience"),
      vinyl: f.get("vinyl"),
      availability: Object.fromEntries(
        term.nights.map((n, i) => [
          n.date,
          {
            available:
              f.get(`available-${i}`) === "unknown"
                ? null
                : f.get(`available-${i}`) === "true",
            timing: f.get(`timing-${i}`),
          },
        ]),
      ),
    },
    transcript: p.transcript.map((a, i) => ({
      question: a.question,
      answer: f.get(`answer-${i}`),
    })),
  };
}
function configureNight(id) {
  selectPage(id);
  const n = current().nights.find((n) => n.id === id);
  openDialog(
    `Configure ${dateLabel(n.date)}`,
    "Set the timings for this night. Cards survive changes to the schedule.",
    `<form id="configure-form" data-night="${id}"><div class="form-grid">${field("Venue name", "venue", n.venue || "Venue to be confirmed", "text", 'required maxlength="100"')}${field("Start time", "start", n.start, "time", "required")}${field("End time", "end", n.end, "time", "required")}${field("Set length (minutes)", "setLength", n.setLength, "number", 'min="10" max="240" required')}${field("Early ends / Late starts", "splitTime", n.splitTime || "", "time")}</div><label class="checkbox-label"><input type="checkbox" name="autoTime" value="true" checked> Automatically time all assigned DJs using this set length</label><p class="hint">B2B pairs stay together. Use Plan sets to reorder DJs, pair them or change individual durations (for example a 60-minute closing set). Uncheck automatic timing to keep your custom durations. An earlier end time means the next day.</p><div class="source-preview" id="slot-preview">${generateSlots(n).length} sets · ${n.setLength} minutes each</div></form>`,
    `<button class="danger push-left" data-action="delete-night" data-id="${id}">Delete night</button><button data-action="close">Cancel</button><button class="primary" form="configure-form" type="submit">Save configuration</button>`,
    current().code,
  );
}
function deletionDialog(type, id) {
  const term = current();
  const night = term.nights.find((n) => n.id === id);
  const board = type === "delete-board";
  const count = board
    ? term.instances.length
    : term.instances.filter((i) => i.nightId === id).length;
  openDialog(
    board
      ? `Delete Open Decks ${term.code}?`
      : `Delete ${dateLabel(night.date)}?`,
    "A saved state will be created before anything is deleted.",
    `<p>${board ? `This removes this entire board, including its ${term.nights.length} nights, ${term.profiles.length} DJ profiles and ${count} cards.` : `This removes the night at ${escape(night.venue || "Venue to be confirmed")}. Its ${count} cards will return to Unassigned, with their set times and final confirmations cleared.`}</p><p>An administrator can revert this deletion through Account menu &rarr; Edit history &amp; saved states. Restoring a saved state replaces the whole workspace.</p><p class="hint">Deletion will stop if the saved state cannot be created.</p>`,
    `<button data-action="close">Cancel</button><button class="danger" data-action="confirm-deletion" data-type="${type}" data-id="${id || ""}">${board ? "Delete board" : "Delete night"}</button>`,
    term.code,
  );
}
function addPicker(nightId) {
  selectPage(nightId);
  const term = current();
  const night = term.nights.find((n) => n.id === nightId);
  openDialog(
    `Add to ${dateLabel(night.date)}`,
    "Choose an existing card to move here, or add a new DJ.",
    `<div class="field"><label for="picker-period">Move into</label><select id="picker-period"><option value="early">Early</option><option value="late">Late</option></select></div><label class="search" style="display:block;margin-bottom:15px"><span class="visually-hidden">Find a DJ</span>${icon("search")}<input id="picker-search" placeholder="Find a DJ…"></label><div class="picker-list" data-night="${nightId}">${pickerHTML(term, nightId, "")}</div>`,
    `<button data-action="add-new" data-id="${nightId}">${icon("plus")}Add a new DJ</button>`,
    term.code,
  );
}
function pickerHTML(
  term,
  nightId,
  search,
  period = $("#picker-period")?.value || "early",
) {
  return (
    term.instances
      .filter(
        (i) =>
          (i.nightId !== nightId || instancePeriod(term, i) !== period) &&
          matchesProfile(profileFor(term, i), search),
      )
      .map((i) => {
        const p = profileFor(term, i);
        return `<button class="picker-item" data-action="pick-move" data-id="${i.id}" data-night="${nightId}"><div><strong>${escape(p.name)}</strong><span>${escape(cardDetails(p))} · ${i.nightId ? dateLabel(term.nights.find((n) => n.id === i.nightId).date) : "Unassigned"}</span></div>${icon("arrow")}</button>`;
      })
      .join("") ||
    '<p class="hint">No other cards match. Use Duplicate on an existing card to make another instance.</p>'
  );
}
function addNew(nightId = "", period = "early") {
  openDialog(
    "Add a DJ",
    "Create a new shared profile and one card.",
    `<form id="add-form" data-night="${nightId}" data-period="${period}"><div class="form-grid">${field("DJ name", "name", "", "text", "required")}${field("Full name", "fullName", "")}${field("Genres", "genres", "")}${field("Ethnicity", "ethnicity", "", "text", 'maxlength="2000"')}${field("Gender", "gender", "", "text", 'maxlength="2000"')}${field("College", "college", "", "text", 'maxlength="2000"')}${experienceSelect("beginner")}${vinylSelect("either")}</div><p class="hint">Availability starts as “not specified”. Open the card to set it.</p></form>`,
    `<button data-action="close">Cancel</button><button class="primary" form="add-form" type="submit">Add DJ</button>`,
    current().code,
  );
}
function createDialog() {
  createDraft = {};
  openDialog(
    "Create Open Decks",
    "One Oxford term. One response sheet. Your whole lineup.",
    `<form id="preview-form"><div class="form-grid">${field("Oxford term", "code", nextTerm(), "text", 'required pattern="[MmHhTt][Tt][0-9]{2}" placeholder="MT26"')}${field("Google Sheets response link", "sheetUrl", "", "url", 'placeholder="https://docs.google.com/spreadsheets/d/…"')}<div class="field wide"><label for="csv-file">Or upload a response CSV</label><input id="csv-file" type="file" accept=".csv,text/csv"><p class="hint">A linked Sheet is checked every five minutes. A CSV is a one-time import.</p></div></div><p class="hint">Private Sheets stay private: share them as Viewer with your configured Google service account.${!meta.privateSheets ? " A service account has not been configured on this server yet. Public example Sheets can be read directly." : ""}</p><button type="submit">${icon("search")}Preview responses & dates</button></form><div id="create-preview"></div>`,
    `<button data-action="close">Cancel</button><button class="primary" data-action="create-save" disabled>Create board</button>`,
  );
  $("#preview-form .form-grid").insertAdjacentHTML(
    "afterbegin",
    field(
      "Venue name",
      "venue",
      "",
      "text",
      'required maxlength="100" placeholder="e.g. The Bullingdon"',
    ),
  );
}
function creationPreview() {
  const { rows, code, mapping } = createDraft;
  const d = discover(rows, code, mapping);
  createDraft.mapping = d.mapping;
  $("#create-preview").innerHTML =
    `<div class="source-preview"><p><strong>${rows.length - 1} responses</strong> · ${d.dates.length} nights detected for ${escape(code)}</p>${d.dates.map((n) => `<span class="date-chip">${dateLabel(n.date)}${n.week ? " / week " + n.week : ""}</span>`).join("")}</div><p class="section-label">Check automatic field matching</p><div class="form-grid">${[
      ["name", "DJ name"],
      ["fullName", "Full name"],
      ["genres", "Genres"],
      ["college", "College (optional)"],
      ["ethnicity", "Ethnicity (optional)"],
      ["gender", "Gender (optional)"],
      ["experience", "Experience"],
      ["vinyl", "Vinyl"],
      ["availability", "Availability"],
      ["timestamp", "Timestamp"],
      ["email", "Email (optional)"],
    ]
      .map(
        ([key, label]) =>
          `<div class="field"><label for="map-${key}">${label}</label><select id="map-${key}" data-map="${key}" style="width:100%"><option value="-1">Not present</option>${d.headers.map((h, i) => `<option value="${i}" ${d.mapping[key] === i ? "selected" : ""}>${escape(h)}</option>`).join("")}</select></div>`,
      )
      .join(
        "",
      )}</div><div class="field"><label for="create-dates">Night dates (YYYY-MM-DD, one per line)</label><textarea id="create-dates">${d.dates.map((n) => n.date).join("\n")}</textarea><p class="hint">Dates come from the form’s column headers and availability answers. You can correct or add dates here.</p></div>`;
  $("#dialog [data-action=create-save]").disabled = false;
}
function addNightDialog() {
  openDialog(
    "Add a night",
    "Name the venue and choose when the decks are open.",
    `<form id="night-form"><div class="form-grid">${field("Venue name", "venue", "", "text", 'required maxlength="100"')}${field("Night date", "date", "", "date", "required")}${field("Start time", "start", "18:00", "time", "required")}${field("End time", "end", "00:00", "time", "required")}${field("Set length (minutes)", "setLength", 30, "number", 'min="10" max="240" required')}</div></form>`,
    '<button data-action="close">Cancel</button><button class="primary" type="submit" form="night-form">Add night</button>',
    current().code,
  );
}
function planSets(id) {
  selectPage(id);
  const term = current(),
    night = term.nights.find((n) => n.id === id);
  planDraft = { nightId: id, sets: automaticPlan(term, night) };
  // Keep existing manual durations when reopening a plan.
  for (const set of planDraft.sets) {
    const existing = night.plan?.find((s) => s.id === set.id);
    if (existing) set.duration = existing.duration;
  }
  openDialog(
    `Plan sets · ${night.venue || dateLabel(night.date)}`,
    `${dateLabel(night.date)} · ${night.start}–${night.end}. Order DJs, pair B2Bs and set individual lengths.`,
    `<div class="plan-controls"><button data-action="plan-fill">Fill night equally</button><button data-action="plan-default">Use ${night.setLength}-minute sets</button></div><p class="hint">Use the arrows to change order. Pair two DJs to share one slot. Timings appear in Early and Late when saved.</p><div id="plan-summary" class="source-preview" aria-live="polite"></div><form id="plan-form"><div id="plan-rows" class="plan-rows"></div></form>`,
    '<button data-action="close">Cancel</button><button class="primary" form="plan-form" type="submit">Save set plan</button>',
    term.code,
  );
  drawPlan();
}
function drawPlan() {
  const term = current();
  $("#plan-rows").innerHTML =
    planDraft.sets
      .map((set, index) => {
        const names = set.instanceIds.map(
          (id) =>
            profileFor(
              term,
              term.instances.find((i) => i.id === id),
            ).name,
        );
        const profileId = term.instances.find(
          (i) => i.id === set.instanceIds[0],
        ).profileId;
        const choices = planDraft.sets.flatMap((s, other) =>
          s.instanceIds.length === 1 &&
          other !== index &&
          term.instances.find((i) => i.id === s.instanceIds[0]).profileId !==
            profileId
            ? [
                {
                  index: other,
                  name: profileFor(
                    term,
                    term.instances.find((i) => i.id === s.instanceIds[0]),
                  ).name,
                },
              ]
            : [],
        );
        return `<section class="plan-row" data-plan-index="${index}"><div class="plan-order"><span>${index + 1}</span><button type="button" class="small" data-action="plan-up" data-index="${index}" aria-label="Move ${escape(names.join(" B2B "))} up" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" class="small" data-action="plan-down" data-index="${index}" aria-label="Move ${escape(names.join(" B2B "))} down" ${index === planDraft.sets.length - 1 ? "disabled" : ""}>↓</button></div><div class="plan-artists"><strong>${names.map(escape).join(' <span class="b2b-badge">B2B</span> ')}</strong><span class="plan-time"></span>${names.length === 2 ? `<button class="small" type="button" data-action="plan-split" data-index="${index}">Separate DJs</button>` : `<select data-plan-pair="${index}" aria-label="B2B partner for ${escape(names[0])}"><option value="">Pair B2B with…</option>${choices.map((c) => `<option value="${c.index}">${escape(c.name)}</option>`).join("")}</select>`}</div><div class="field plan-duration"><label for="duration-${index}">Minutes</label><input type="number" id="duration-${index}" data-plan-duration="${index}" value="${set.duration}" min="10" max="240" required aria-label="Duration for ${escape(names.join(" B2B "))}"></div></section>`;
      })
      .join("") ||
    '<p class="hint">Add DJs to this night, then return here to plan their sets.</p>';
  updatePlanTimes();
}
function updatePlanTimes() {
  const night = current().nights.find((n) => n.id === planDraft.nightId);
  const bounds = periodBounds(night);
  let cursor = bounds.early.start;
  planDraft.sets.forEach((set, index) => {
    const next = cursor + Number(set.duration || 0);
    $(`[data-plan-index="${index}"] .plan-time`).textContent =
      `${formatTime(cursor)}–${formatTime(next)} · ${periodLabel(cursor < bounds.late.start ? "early" : "late")}${next > 1440 ? " · next day" : ""}`;
    cursor = next;
  });
  const remaining = bounds.late.end - cursor;
  const invalid = planDraft.sets.some(
    (s) =>
      !Number.isInteger(Number(s.duration)) ||
      s.duration < 10 ||
      s.duration > 240,
  );
  const summary = $("#plan-summary");
  summary.classList.toggle("error", remaining < 0 || invalid);
  summary.textContent = invalid
    ? "Choose a duration of 10–240 minutes for every set."
    : `${planDraft.sets.length} sets · ${planDraft.sets.reduce((n, s) => n + Number(s.duration), 0)} minutes · ${remaining < 0 ? `${-remaining} minutes too long` : remaining ? `${remaining} minutes free at the end` : "Night fully scheduled"}`;
}
async function historyDialog() {
  try {
    const data = await api("/api/admin/history");
    openDialog(
      "Edit history & saved states",
      `Keep up to ${data.limit} states. Saving a new one replaces the oldest. The latest ${data.historyLimit} edits are retained, within the history storage limit.`,
      `<form id="snapshot-form" class="snapshot-composer">${field("Saved state name", "snapshot-name", "", "text", 'required maxlength="100" placeholder="e.g. Before final lineup changes"')}<button type="submit">Save current state</button></form><p class="section-label">Saved states (${data.snapshots.length}/${data.limit})</p><div class="saved-states">${data.snapshots.map((s) => `<article class="saved-state"><div><strong>${escape(s.name)}</strong><p class="hint">${escape(s.author)} · ${escape(new Date(s.at).toLocaleString("en-GB", { timeZone: "Europe/London" }))} · Board v${s.version}</p></div><button data-action="restore-state" data-id="${s.id}">Restore</button></article>`).join("") || '<p class="hint">No saved states yet.</p>'}</div><p class="hint">Restoring replaces all boards and keeps accounts and edit history. A state of the current board is saved first, so the restore can be undone.</p><p class="section-label">Recent edits</p><div class="history-list">${
        [...data.history]
          .reverse()
          .map(
            (entry) =>
              `<article class="history-entry"><strong>${escape(entry.summary)}</strong><p class="hint">${escape(entry.author)} · ${escape(new Date(entry.at).toLocaleString("en-GB", { timeZone: "Europe/London" }))} · v${entry.version}</p>${entry.changes?.length ? `<details><summary>View changes</summary>${entry.changes.map((c) => `<div class="history-change"><code>${escape(c.path)}</code><div><span>Before</span><pre>${escape(c.before)}</pre><span>After</span><pre>${escape(c.after)}</pre></div></div>`).join("")}</details>` : ""}</article>`,
          )
          .join("") ||
        '<p class="hint">Edits made from now on will appear here.</p>'
      }</div>`,
      '<button data-action="close">Close</button>',
    );
  } catch (e) {
    showError(e.message);
  }
}
let adminUsers = [];
async function usersDialog(selected = "") {
  try {
    const data = await api("/api/admin/users");
    adminUsers = data.users;
    openDialog(
      "Users & roles",
      "Administrators manage accounts and saved states. Managers edit lineups. Viewers can read the lineup.",
      `<div class="field"><label for="account-choice">Account</label><select id="account-choice"><option value="">Create a new login</option>${adminUsers.map((u) => `<option value="${u.id}" ${u.id === selected ? "selected" : ""}>${escape(u.name)} (${escape(u.username)}) · ${roleName(u.role)}${u.disabled ? " · disabled" : ""}</option>`).join("")}</select></div><div id="user-editor"></div>`,
      '<button data-action="close">Close</button><button class="primary" form="user-form" type="submit">Save account</button>',
    );
    userEditor(selected);
  } catch (e) {
    showError(e.message);
  }
}
function userEditor(id) {
  const user = adminUsers.find((u) => u.id === id);
  $("#user-editor").innerHTML =
    `<form id="user-form" data-user="${id}"><div class="form-grid">${field("Username", "username", user?.username || "", "text", `required minlength="3" maxlength="100" autocomplete="off" ${user ? "readonly" : ""}`)}${field("Display name", "name", user?.name || "", "text", 'required maxlength="100"')}${field(user ? "New password (leave blank to keep)" : "Password", "password", "", "password", `minlength="12" maxlength="256" autocomplete="new-password" ${user ? "" : "required"}`)}<div class="field"><label for="role">Role</label><select name="role" id="role">${["viewer", "manager", "administrator"].map((r) => `<option value="${r}" ${r === user?.role ? "selected" : ""}>${roleName(r)}</option>`).join("")}</select></div></div>${user ? `<label class="checkbox-label"><input type="checkbox" name="disabled" ${user.disabled ? "checked" : ""}> Disable this account</label>` : ""}<p class="hint">Passwords need at least 12 characters. Saving account changes signs that user out on every device. At least one administrator must stay active.</p></form>`;
}
function accountDialog() {
  openDialog(
    "Change password",
    `${meta.user.username} · ${roleName(meta.user.role)}`,
    `<form id="password-form">${field("Current password", "currentPassword", "", "password", 'required autocomplete="current-password"')}${field("New password", "password", "", "password", 'required minlength="12" maxlength="256" autocomplete="new-password"')}<p class="hint">This signs you out on all devices. Sign in again with your new password.</p></form>`,
    '<button data-action="close">Cancel</button><button class="primary" form="password-form" type="submit">Change password</button>',
  );
}
async function importNow() {
  const term = current();
  if (!term.sheetUrl) {
    openDialog(
      "Import more responses",
      "Only unseen submissions create cards. Your edits and initial responses stay intact.",
      `<form id="import-form"><label for="import-file">Google Form response CSV</label><input id="import-file" type="file" accept=".csv,text/csv" required><p class="hint">Use the same column order as your first import and keep its Timestamp column.</p></form>`,
      `<button data-action="close">Cancel</button><button class="primary" form="import-form" type="submit">Import new responses</button>`,
    );
    return;
  }
  const result = await mutation("/api/import", { termId: term.id });
  if (result)
    notify(
      `${result.result.added} new DJ${result.result.added === 1 ? "" : "s"} imported. Existing cards preserved.`,
    );
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!event.target.closest(".account-control")) closeAccountMenu();
  if (!button || busy) return;
  const action = button.dataset.action,
    id = button.dataset.id,
    term = current();
  if (action === "previous-night" || action === "next-night") {
    selectPage(button.dataset.page);
    const column = $(".column.mobile-active");
    const target = column.querySelector(`[data-action="${action}"]`);
    (target.disabled
      ? column.querySelector(`.mobile-night-nav:not(:disabled)`)
      : target
    )?.focus({ preventScroll: true });
    return;
  }
  if (action === "toggle-account") {
    const menu = $("#account-menu");
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
    return;
  }
  if (action === "toggle-card-details") {
    demographicCards = !demographicCards;
    localStorage.setItem(
      "ouems-card-details",
      demographicCards ? "demographics" : "genres",
    );
    button.setAttribute("aria-pressed", String(demographicCards));
    button.setAttribute(
      "aria-label",
      demographicCards ? "Show genres" : "Show ethnicity and gender",
    );
    button.title = demographicCards
      ? "Showing ethnicity and gender; switch to genres"
      : "Showing genres; switch to ethnicity and gender";
    button.innerHTML = responsiveLabel(
      demographicCards ? "Ethnicity / gender" : "Genres",
      demographicCards ? "E/G" : "Genres",
    );
    rerenderBoard();
    return;
  }
  if (button.closest("#account-menu")) closeAccountMenu(true);
  try {
    if (action === "delete-night" || action === "delete-board") {
      deletionDialog(action, id);
      return;
    }
    if (action === "confirm-deletion") {
      const type = button.dataset.type;
      const pages = pageIds(term),
        index = pages.indexOf(id);
      const out = await mutation(
        "/api/action",
        { type, termId: term.id, nightId: id },
        dialogVersion,
      );
      if (out) {
        if (type === "delete-board") {
          activeId = current()?.id || "";
          localStorage.setItem("ouems-term", activeId);
          localStorage.removeItem(`ouems-night-${term.id}`);
        } else if (selectedPage(term) === id) {
          selectPage(pages[index + 1] || pages[index - 1]);
        }
        closeDialog();
        notify(
          `${type === "delete-board" ? "Board" : "Night"} deleted. The previous workspace is in saved states.`,
        );
      }
      return;
    }
    if (action === "confirm-card") {
      const instance = term.instances.find((i) => i.id === id);
      selectPage(instance.nightId);
      const confirmed = instance.confirmed !== true;
      const out = await mutation("/api/action", {
        type: "confirm",
        termId: term.id,
        instanceId: id,
        confirmed,
      });
      if (out) {
        $(`.card-confirmation[data-id="${id}"]`)?.focus({
          preventScroll: true,
        });
        notify(
          confirmed
            ? "DJ confirmed for this night."
            : "Final confirmation cleared.",
        );
      }
      return;
    }
    if (action === "logout") {
      await api("/api/auth/logout", {});
      window.location.replace("/login");
      return;
    }
    if (action === "account") {
      accountDialog();
      return;
    }
    if (action === "users") {
      await usersDialog();
      return;
    }
    if (action === "history") {
      await historyDialog();
      return;
    }
    if (action === "add-night") {
      addNightDialog();
      return;
    }
    if (action === "plan-sets") {
      planSets(id);
      return;
    }
    if (action === "restore-state") {
      if (
        !confirm(
          "Restore this saved workspace? All current boards will be replaced. A state of the current board will be saved first.",
        )
      )
        return;
      const out = await mutation("/api/admin/restore", { id }, dialogVersion);
      if (out) {
        await historyDialog();
        notify("Workspace restored. The previous state is saved.");
      }
      return;
    }
    if (action === "unassign") {
      const out = await mutation("/api/action", {
        type: "move",
        termId: term.id,
        instanceId: id,
        nightId: null,
        slot: null,
      });
      if (out) notify("Card moved to Unassigned.");
      return;
    }
    if (action.startsWith("plan-") && planDraft) {
      const index = Number(button.dataset.index),
        sets = planDraft.sets;
      const night = term.nights.find((n) => n.id === planDraft.nightId);
      if (action === "plan-up" && index > 0)
        [sets[index - 1], sets[index]] = [sets[index], sets[index - 1]];
      if (action === "plan-down" && index < sets.length - 1)
        [sets[index + 1], sets[index]] = [sets[index], sets[index + 1]];
      if (action === "plan-split") {
        const second = sets[index].instanceIds.pop();
        sets.splice(index + 1, 0, {
          instanceIds: [second],
          duration: night.setLength,
        });
      }
      if (action === "plan-default")
        for (const set of sets) set.duration = night.setLength;
      if (action === "plan-fill" && sets.length) {
        const bounds = periodBounds(night),
          total = bounds.late.end - bounds.early.start;
        const duration = Math.floor(total / sets.length);
        sets.forEach(
          (set, i) =>
            (set.duration = duration + (i < total % sets.length ? 1 : 0)),
        );
      }
      drawPlan();
      return;
    }
  } catch (e) {
    showError(e.message);
    return;
  }
  if (action === "toggle-compact") {
    compact = !compact;
    localStorage.setItem("ouems-compact", String(compact));
    render();
    $("[data-action=toggle-compact]").focus({ preventScroll: true });
    return;
  }
  if (action === "toggle-period") {
    const period = button.dataset.period;
    const collapsed = button.getAttribute("aria-expanded") === "true";
    localStorage.setItem(collapseKey(id, period), String(collapsed));
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} ${periodLabel(period)}`,
    );
    button.querySelector(".chevron").textContent = collapsed ? "▸" : "▾";
    document.getElementById(button.getAttribute("aria-controls")).hidden =
      collapsed;
    return;
  }
  if (action === "close") {
    closeDialog();
    return;
  }
  if (action === "retry") {
    refresh(true);
    return;
  }
  if (action === "create") {
    createDialog();
    return;
  }
  if (action === "edit-card") {
    editCard(id);
    return;
  }
  if (action === "review-latest") {
    if (
      confirm(
        "Open the latest saved DJ profile? Your unsaved form inputs will be discarded.",
      )
    )
      editCard(dialogInstance);
    return;
  }
  if (action === "configure") {
    configureNight(id);
    return;
  }
  if (action === "add-picker") {
    addPicker(id);
    return;
  }
  if (action === "add-new") {
    addNew(id, $("#picker-period")?.value || "early");
    return;
  }
  if (action === "import") {
    await importNow();
    return;
  }
  if (action === "pick-move") {
    const out = await mutation(
      "/api/action",
      {
        type: "move",
        termId: term.id,
        instanceId: id,
        nightId: button.dataset.night,
        period: $("#picker-period").value,
        slot: null,
      },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("Card moved into the selected half.");
    }
    return;
  }
  if (action === "create-save") {
    if (!createDraft.rows) return;
    const raw = $("#create-dates")
      .value.split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const detected = discover(
      createDraft.rows,
      createDraft.code,
      createDraft.mapping,
    );
    const dates = raw.map(
      (date) =>
        detected.dates.find((d) => d.date === date) || { date, week: null },
    );
    const out = await mutation(
      "/api/terms",
      {
        code: createDraft.code,
        sheetUrl: createDraft.sheetUrl,
        rows: createDraft.rows,
        mapping: createDraft.mapping,
        dates,
        venue: createDraft.venue,
      },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("Open Decks board created.");
    }
    return;
  }
  if (!dialogInstance) return;
  const instance = term.instances.find((i) => i.id === dialogInstance),
    p = profileFor(term, instance);
  if (action === "comment") {
    const text = $("#new-comment").value;
    const out = await mutation(
      "/api/action",
      { type: "comment", termId: term.id, profileId: p.id, text },
      dialogVersion,
    );
    if (out) {
      dialogVersion = state.version;
      $("#comments").innerHTML = commentsHTML(
        current().profiles.find((x) => x.id === p.id),
      );
      $("#new-comment").value = "";
      notify("Comment added.");
    }
    return;
  }
  if (action === "duplicate") {
    const out = await mutation(
      "/api/action",
      { type: "duplicate", termId: term.id, instanceId: instance.id },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("Linked duplicate added to Unassigned.");
    }
    return;
  }
  if (action === "revert") {
    if (
      !confirm(
        "Restore this DJ’s initial fields and form answers on every linked card? Comments and placements will be kept.",
      )
    )
      return;
    const out = await mutation(
      "/api/action",
      { type: "revert", termId: term.id, profileId: p.id },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("Initial response restored. Comments and placements kept.");
    }
    return;
  }
  if (action === "move-dialog") {
    const [nightId, destination, slot] =
      $("#move-destination").value.split(":");
    const out = await mutation(
      "/api/action",
      {
        type: "move",
        termId: term.id,
        instanceId: instance.id,
        nightId: nightId || null,
        slot: destination === "slot" ? Number(slot) : null,
        period: ["early", "late"].includes(destination) ? destination : null,
      },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("Card moved.");
    }
  }
});
document.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  if (
    [
      "plan-form",
      "night-form",
      "snapshot-form",
      "user-form",
      "password-form",
    ].includes(form.id)
  ) {
    try {
      const fields = Object.fromEntries(new FormData(form));
      if (form.id === "plan-form") {
        const out = await mutation(
          "/api/action",
          {
            type: "plan",
            termId: current().id,
            nightId: planDraft.nightId,
            sets: planDraft.sets,
          },
          dialogVersion,
        );
        if (out) {
          closeDialog();
          notify("Set plan saved in Early and Late.");
        }
      }
      if (form.id === "night-form") {
        const out = await mutation(
          "/api/action",
          { ...fields, type: "add-night", termId: current().id },
          dialogVersion,
        );
        if (out) {
          closeDialog();
          notify("Night added.");
        }
      }
      if (form.id === "snapshot-form") {
        const out = await mutation(
          "/api/admin/snapshots",
          { name: fields["snapshot-name"] },
          dialogVersion,
        );
        if (out) {
          await historyDialog();
          notify("Current state saved.");
        }
      }
      if (form.id === "user-form") {
        busy = true;
        try {
          await api("/api/admin/users", {
            ...fields,
            id: form.dataset.user || undefined,
            disabled: fields.disabled === "on",
          });
        } finally {
          busy = false;
        }
        await refresh();
        await usersDialog();
        notify("Account saved.");
      }
      if (form.id === "password-form") {
        await api("/api/auth/password", fields);
        window.location.replace("/login");
      }
    } catch (e) {
      showError(e.message);
    }
    return;
  }
  if (form.id === "edit-form") {
    const out = await mutation("/api/action", editPayload(), dialogVersion);
    if (out) {
      closeDialog();
      notify("DJ saved. All linked cards updated.");
    }
  }
  if (form.id === "configure-form") {
    const fields = Object.fromEntries(new FormData(form));
    const out = await mutation(
      "/api/action",
      {
        ...fields,
        autoTime: fields.autoTime === "true",
        type: "configure",
        termId: current().id,
        nightId: form.dataset.night,
      },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("Night configured.");
    }
  }
  if (form.id === "add-form") {
    const out = await mutation(
      "/api/action",
      {
        type: "add",
        termId: current().id,
        nightId: form.dataset.night || null,
        period: form.dataset.period,
        fields: Object.fromEntries(new FormData(form)),
      },
      dialogVersion,
    );
    if (out) {
      closeDialog();
      notify("DJ added.");
    }
  }
  if (form.id === "preview-form") {
    try {
      const data = Object.fromEntries(new FormData(form));
      const file = $("#csv-file").files[0];
      const rows = file ? parseCSV(await file.text()) : undefined;
      if (!rows && !data.sheetUrl)
        throw new Error("Paste a Sheet link or choose a response CSV.");
      const preview = await api("/api/preview", { ...data, rows });
      createDraft = {
        code: data.code.toUpperCase(),
        sheetUrl: file ? "" : data.sheetUrl,
        rows: preview.rows,
        mapping: preview.detected.mapping,
        venue: data.venue,
      };
      creationPreview();
      $("#dialog .inline-error")?.remove();
    } catch (e) {
      showError(e.message);
    }
  }
  if (form.id === "import-form") {
    try {
      const rows = parseCSV(await $("#import-file").files[0].text());
      const out = await mutation("/api/import", { termId: current().id, rows });
      if (out) {
        closeDialog();
        notify(
          `${out.result.added} new DJs imported. Existing cards preserved.`,
        );
      }
    } catch (e) {
      showError(e.message);
    }
  }
});
document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.planDuration !== undefined && planDraft) {
    planDraft.sets[Number(el.dataset.planDuration)].duration = Number(el.value);
    updatePlanTimes();
  }
  if (el.closest("#edit-form") && /^(available|timing)-/.test(el.name))
    $("#availability-summary").innerHTML = availabilitySummary(
      editPayload().fields,
      current(),
    );
  if (el.id === "search") {
    filters.search = el.value;
    rerenderBoard();
  }
  if (el.id === "picker-search")
    $(".picker-list").innerHTML = pickerHTML(
      current(),
      $(".picker-list").dataset.night,
      el.value,
    );
  if (el.closest("#configure-form")) {
    try {
      const data = Object.fromEntries(new FormData($("#configure-form")));
      const n = current().nights.find(
        (n) => n.id === $("#configure-form").dataset.night,
      );
      const configured = {
        ...n,
        ...data,
        plan:
          data.autoTime === "true"
            ? automaticPlan(current(), n, Number(data.setLength))
            : n.plan,
      };
      const slots = generateSlots(configured);
      const bounds = periodBounds(data);
      $("#slot-preview").textContent =
        `${slots.length} sets · Early ${formatTime(bounds.early.start)}–${formatTime(bounds.early.end)} · Late ${formatTime(bounds.late.start)}–${formatTime(bounds.late.end)}${slots.at(-1).end > 1440 ? " (next day)" : ""}`;
    } catch (e) {
      $("#slot-preview").textContent = e.message;
    }
  }
  if (el.closest("#preview-form") && createDraft?.rows) {
    $("#dialog [data-action=create-save]").disabled = true;
    $("#create-preview").innerHTML =
      '<p class="hint">Source or term changed. Preview again before creating.</p>';
    createDraft = {};
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "account-choice") userEditor(el.value);
  if (el.dataset.planPair !== undefined && el.value !== "" && planDraft) {
    const index = Number(el.dataset.planPair),
      partner = Number(el.value);
    planDraft.sets[index].instanceIds.push(
      planDraft.sets[partner].instanceIds[0],
    );
    planDraft.sets.splice(partner, 1);
    drawPlan();
  }
  if (el.id === "picker-period")
    $(".picker-list").innerHTML = pickerHTML(
      current(),
      $(".picker-list").dataset.night,
      $("#picker-search").value,
      el.value,
    );
  if (el.closest("#edit-form") && /^(available|timing)-/.test(el.name))
    $("#availability-summary").innerHTML = availabilitySummary(
      editPayload().fields,
      current(),
    );
  if (el.id === "term-select") {
    activeId = el.value;
    localStorage.setItem("ouems-term", activeId);
    render();
  }
  if (el.id === "experience-filter") {
    filters.experience = el.value;
    rerenderBoard();
  }
  if (el.id === "vinyl-filter") {
    filters.vinyl = el.value;
    rerenderBoard();
  }
  if (el.dataset.map) createDraft.mapping[el.dataset.map] = Number(el.value);
});
function clearDrag() {
  dragId = null;
  document
    .querySelectorAll("[data-availability]")
    .forEach((el) => delete el.dataset.availability);
  document
    .querySelectorAll(".dragging,.drag-over")
    .forEach((el) => el.classList.remove("dragging", "drag-over"));
  if ($("#drag-help")) $("#drag-help").textContent = boardHint;
}
document.addEventListener("dragstart", (event) => {
  const el = event.target.closest(".dj-card");
  if (
    !el ||
    !canEdit() ||
    event.target.closest(".card-remove, .card-confirmation")
  ) {
    event.preventDefault();
    return;
  }
  dragId = el.dataset.instance;
  event.dataTransfer.setData("text/plain", dragId);
  event.dataTransfer.effectAllowed = "move";
  el.classList.add("dragging");
  const term = current(),
    p = profileFor(
      term,
      term.instances.find((i) => i.id === dragId),
    );
  document.querySelectorAll(".drop-zone[data-night]").forEach((zone) => {
    const night = term.nights.find((n) => n.id === zone.dataset.night);
    if (night)
      zone.dataset.availability = availabilityFor(
        p,
        night,
        zone.dataset.slot !== undefined
          ? generateSlots(night)[Number(zone.dataset.slot)]
          : zone.dataset.period || null,
      );
  });
  $("#drag-help").textContent =
    `Moving ${p.name} · highlighted halves show availability. Every list and set accepts a manual override.`;
});
document.addEventListener("dragover", (event) => {
  const zone = event.target.closest(".drop-zone");
  if (zone && dragId) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document
      .querySelectorAll(".drag-over")
      .forEach((el) => el.classList.remove("drag-over"));
    zone.classList.add("drag-over");
  }
});
document.addEventListener("drop", async (event) => {
  const zone = event.target.closest(".drop-zone");
  if (!zone || !dragId || !canEdit()) return;
  event.preventDefault();
  const instanceId = dragId;
  const nightId = zone.dataset.night || null;
  const slot =
    zone.dataset.slot !== undefined ? Number(zone.dataset.slot) : null;
  const warning = zone.dataset.availability;
  if (zone.dataset.period)
    localStorage.setItem(collapseKey(nightId, zone.dataset.period), "false");
  clearDrag();
  const out = await mutation("/api/action", {
    type: "move",
    termId: current().id,
    instanceId,
    nightId,
    slot,
    period: zone.dataset.period || null,
  });
  if (out)
    notify(
      warning === "unavailable" || warning === "outside"
        ? "Card moved with an availability override."
        : "Card moved.",
    );
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#account-menu")?.hidden === false) {
    event.preventDefault();
    closeAccountMenu(true);
  }
});
document.addEventListener("focusin", (event) => {
  if (!event.target.closest(".account-control")) closeAccountMenu();
});
document.addEventListener("dragend", clearDrag);
$("#dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
await refresh(true);
setInterval(() => {
  if (!document.hidden) refresh();
}, 20000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
