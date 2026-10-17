const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const form = $("#form");
const DRAFT_KEY = "resume-tailor-draft-v1";
const PASSWORD_KEY = "resume-tailor-password";
let result = null;

// ---------------------------------------------------------------- password lock

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let password = store.get(PASSWORD_KEY) || "";

function showLock(message) {
  $("#lock").hidden = false;
  $("#lockError").hidden = !message;
  $("#lockError").textContent = message || "";
  $("#lockPassword").focus();
}

async function tryUnlock(pw) {
  const res = await fetch("/api/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  return res.ok;
}

$("#lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#lockPassword").value;
  if (await tryUnlock(pw)) {
    password = pw;
    store.set(PASSWORD_KEY, pw);
    $("#lock").hidden = true;
    $("#lockPassword").value = "";
  } else {
    showLock("Wrong password, or too many attempts. Try again.");
  }
});

// fetch wrapper for protected API calls: sends the password, re-locks on 401
async function api(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-password": password },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.code === "password_required") {
      store.set(PASSWORD_KEY, null);
      password = "";
      showLock("Please enter the password again.");
      throw new Error("Password required");
    }
  }
  return res;
}

(async () => {
  const config = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  if (config.passwordRequired && !(password && (await tryUnlock(password)))) showLock();
})();

// ---------------------------------------------------------------- repeatable sections

function addItem(kind, values = {}) {
  const tpl = $(`#${kind}Tpl`).content.cloneNode(true);
  const item = tpl.firstElementChild;
  $$("[data-field]", item).forEach((el) => (el.value = values[el.dataset.field] || ""));
  $(".remove", item).addEventListener("click", () => {
    item.remove();
    saveDraft();
  });
  $(`#${kind}List`).appendChild(item);
  return item;
}

$$("[data-add]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const item = addItem(btn.dataset.add);
    $("input", item).focus();
  })
);

const readList = (kind) =>
  $$(`#${kind}List .repeat-item`).map((item) =>
    Object.fromEntries($$("[data-field]", item).map((el) => [el.dataset.field, el.value]))
  );

// ---------------------------------------------------------------- form state

function collect() {
  const fd = new FormData(form);
  const data = Object.fromEntries([...fd.entries()]);
  data.experience = readList("experience");
  data.education = readList("education");
  return data;
}

function fill(data) {
  $$("input[name], textarea[name]", form).forEach((el) => {
    if (el.type === "radio") el.checked = el.value === (data[el.name] || "professional");
    else el.value = data[el.name] || "";
  });
  $("#experienceList").innerHTML = "";
  $("#educationList").innerHTML = "";
  (data.experience?.length ? data.experience : [{}]).forEach((e) => addItem("experience", e));
  (data.education?.length ? data.education : [{}]).forEach((e) => addItem("education", e));
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch {}
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

let saveTimer;
form.addEventListener("input", (e) => {
  e.target.classList.remove("invalid");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
});

$("#clearForm").addEventListener("click", () => {
  if (!confirm("Clear all fields?")) return;
  fill({});
  saveDraft();
});

$("#loadSample").addEventListener("click", () => {
  fill(SAMPLE);
  saveDraft();
  toast("Sample profile loaded");
});

// ---------------------------------------------------------------- generate

const LOADING_STEPS = [
  "Reading the job description",
  "Matching your experience to the requirements",
  "Rewriting bullets around impact",
  "Drafting your cover letter",
  "Checking for skill gaps",
  "Polishing the final documents",
];

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#formError");
  err.hidden = true;

  const data = collect();
  const missing = [];
  if (!data.fullName.trim()) missing.push(form.elements.fullName);
  if (data.jobDescription.trim().length < 30) missing.push(form.elements.jobDescription);
  if (missing.length) {
    missing.forEach((el) => el.classList.add("invalid"));
    missing[0].focus();
    err.textContent = "Please add your full name and paste the job description.";
    err.hidden = false;
    return;
  }

  const btn = $("#generateBtn");
  btn.disabled = true;
  btn.classList.add("busy");
  $(".btn-label", btn).textContent = "Generating…";
  showState("loading");
  let step = 0;
  $("#loadingMsg").textContent = LOADING_STEPS[0];
  const ticker = setInterval(() => {
    step = Math.min(step + 1, LOADING_STEPS.length - 1);
    $("#loadingMsg").textContent = LOADING_STEPS[step];
  }, 6000);

  try {
    const res = await api("/api/generate", data);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    result = body;
    render(result);
    showState("results");
    selectTab("analysis");
    if (window.matchMedia("(max-width: 980px)").matches) $(".results-panel").scrollIntoView({ behavior: "smooth" });
  } catch (ex) {
    showState(result ? "results" : "empty");
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    clearInterval(ticker);
    btn.disabled = false;
    btn.classList.remove("busy");
    $(".btn-label", btn).textContent = result ? "Regenerate" : "Generate tailored documents";
  }
});

function showState(state) {
  $("#emptyState").hidden = state !== "empty";
  $("#loadingState").hidden = state !== "loading";
  $("#results").hidden = state !== "results";
}

// ---------------------------------------------------------------- tabs

function selectTab(name) {
  $$(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
}
$$(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));

// ---------------------------------------------------------------- render

function render({ resume, coverLetter, analysis }) {
  // analysis
  const score = analysis.matchScore;
  const ring = $("#scoreRing");
  ring.style.setProperty("--pct", score);
  ring.style.setProperty("--ring", score >= 75 ? "var(--good)" : score >= 50 ? "var(--warn)" : "var(--bad)");
  $("#scoreValue").textContent = score;
  $("#verdict").textContent = analysis.verdict;

  const tags = (arr, cls = "") =>
    arr.length ? arr.map((s) => `<span class="tag ${cls}">${esc(s)}</span>`).join("") : `<span class="none">None</span>`;
  $("#matchedSkills").innerHTML = tags(analysis.matchedSkills);
  $("#keywords").innerHTML = tags(analysis.keywordsToAdd, "kw");

  const order = { critical: 0, important: 1, "nice-to-have": 2 };
  const gaps = [...analysis.missingSkills].sort((a, b) => order[a.importance] - order[b.importance]);
  $("#missingSkills").innerHTML = gaps.length
    ? gaps
        .map(
          (g) => `<li><div class="gap-head"><span class="badge ${g.importance}">${esc(g.importance)}</span>${esc(g.skill)}</div>
                  <p>${esc(g.howToClose)}</p></li>`
        )
        .join("")
    : `<li class="none">No significant gaps found — nice!</li>`;
  $("#improvements").innerHTML = analysis.improvements
    .map((i) => `<li><strong>${esc(i.area)}</strong>${esc(i.suggestion)}</li>`)
    .join("");

  // resume
  const c = resume.contact;
  const contact = [c.email, c.phone, c.location, ...c.links].filter(Boolean).map(esc).join("  ·  ");
  let html = `<div class="r-name">${esc(resume.name)}</div>`;
  if (resume.headline) html += `<div class="r-headline">${esc(resume.headline)}</div>`;
  if (contact) html += `<div class="r-contact">${contact}</div>`;
  if (resume.summary) html += `<h4>Summary</h4><p>${esc(resume.summary)}</p>`;
  if (resume.skills.length)
    html += `<h4>Skills</h4>` + resume.skills.map((s) => `<p><strong>${esc(s.category)}:</strong> ${esc(s.items.join(", "))}</p>`).join("");
  if (resume.experience.length)
    html +=
      `<h4>Experience</h4>` +
      resume.experience
        .map((e) => {
          const sub = [e.title ? e.company : "", e.location].filter(Boolean).map(esc).join(" · ");
          return `<div class="r-job"><div class="r-row"><span>${esc(e.title || e.company)}</span><span>${esc(e.dates)}</span></div>
            ${sub ? `<div class="r-sub">${sub}</div>` : ""}
            <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`;
        })
        .join("");
  if (resume.projects.length)
    html += `<h4>Projects</h4>` + resume.projects.map((p) => `<p><strong>${esc(p.name)}:</strong> ${esc(p.description)}</p>`).join("");
  if (resume.education.length)
    html +=
      `<h4>Education</h4>` +
      resume.education
        .map(
          (e) => `<div class="r-row"><span>${esc([e.degree, e.school].filter(Boolean).join(", "))}</span><span>${esc(e.dates)}</span></div>
            ${e.details ? `<p>${esc(e.details)}</p>` : ""}`
        )
        .join("");
  if (resume.certifications.length)
    html += `<h4>Certifications</h4><ul>${resume.certifications.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  $("#resumePreview").innerHTML = html;

  // cover letter
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  $("#letterPreview").innerHTML = `
    <div class="l-name">${esc(resume.name)}</div>
    ${contact ? `<div class="l-contact">${contact}</div>` : ""}
    <p>${esc(date)}</p>
    <p>${esc(coverLetter.greeting)}</p>
    ${coverLetter.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
    <p>${esc(coverLetter.closing)}<br><br><strong>${esc(coverLetter.signature)}</strong></p>`;
}

// ---------------------------------------------------------------- export / copy

async function exportDoc(doc, format) {
  const res = await api("/api/export", { doc, format, resume: result.resume, coverLetter: result.coverLetter });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `${doc}.${format}`;
  return { blob: await res.blob(), name };
}

$$("[data-export]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    if (!result) return;
    try {
      const { blob, name } = await exportDoc(btn.dataset.export, btn.dataset.format);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Downloaded ${name}`);
    } catch (ex) {
      toast(ex.message);
    }
  })
);

$$("[data-copy]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    if (!result) return;
    try {
      const { blob } = await exportDoc(btn.dataset.copy, "txt");
      await navigator.clipboard.writeText(await blob.text());
      toast("Copied to clipboard");
    } catch (ex) {
      toast("Could not copy: " + ex.message);
    }
  })
);

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------------------------------------------------------------- sample data

const SAMPLE = {
  fullName: "Jordan Rivera",
  email: "jordan.rivera@example.com",
  phone: "+1 555 010 2233",
  location: "Austin, TX",
  links: "linkedin.com/in/jordanrivera, github.com/jrivera",
  about:
    "Data analyst with 4 years of experience turning messy operational data into dashboards and decisions. Looking to move into a product analytics role at a fast-growing SaaS company.",
  skills: "SQL, Python (pandas), Excel, Tableau, A/B test analysis, stakeholder communication, Jira",
  experience: [
    {
      title: "Data Analyst",
      company: "BrightCart",
      location: "Austin, TX",
      dates: "Mar 2022 – Present",
      description:
        "Own weekly revenue and funnel dashboards in Tableau used by 40+ people. Wrote SQL pipelines that cut report prep from 2 days to 3 hours. Analysed 12 checkout A/B tests with the product team; one change lifted conversion 4%. Partner with marketing on attribution questions.",
    },
    {
      title: "Operations Analyst",
      company: "Lone Star Logistics",
      location: "Dallas, TX",
      dates: "Jun 2020 – Feb 2022",
      description:
        "Built Excel and Python models to forecast warehouse staffing, reducing overtime costs ~15%. Automated a daily shipment exceptions report. Trained 6 coordinators on the new reporting process.",
    },
  ],
  education: [{ degree: "B.S. Economics", school: "University of Texas at Austin", dates: "2016 – 2020", details: "Minor in Statistics" }],
  extras: "Google Data Analytics Certificate (2021). Side project: Python script that tracks personal spending and emails a monthly summary.",
  companyName: "Northwind Software",
  hiringManager: "Priya Shah",
  tone: "professional",
  jobDescription: `Product Analyst — Northwind Software (Remote, US)

Northwind builds workflow software for 5,000+ mid-market teams. We're hiring a Product Analyst to help our product squads make faster, better decisions.

What you'll do:
- Define and track product KPIs, activation and retention metrics
- Design and analyse A/B experiments end-to-end
- Build self-serve dashboards in Looker for PMs and leadership
- Partner with engineers on event tracking and data quality
- Turn analysis into clear recommendations for product roadmaps

Requirements:
- 3+ years in a data/product analytics role
- Advanced SQL; Python or R for analysis
- Experience with experimentation and statistical testing
- Familiarity with product analytics tools (Amplitude, Mixpanel or similar)
- Experience with dbt or modern data stack a plus
- Strong communication with non-technical stakeholders

Nice to have: SaaS/B2B experience, Looker/LookML, cohort and retention analysis.`,
};

// ---------------------------------------------------------------- init

const draft = loadDraft();
fill(draft || {});
