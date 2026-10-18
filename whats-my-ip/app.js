const STORAGE_KEY = "ip-history";
const MAX_ENTRIES = 200;

const el = (id) => document.getElementById(id);

async function fetchIp(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage unavailable (private mode etc.) — history just won't persist.
  }
}

function showIp(id, ip) {
  const node = el(id);
  node.textContent = ip || "Not available";
  node.classList.toggle("unavailable", !ip);
}

function renderHistory() {
  const history = loadHistory();
  const body = el("history-body");
  body.innerHTML = "";
  for (const entry of history) {
    const row = document.createElement("tr");
    for (const value of [new Date(entry.time).toLocaleString(), entry.ipv4 || "—", entry.ipv6 || "—"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  el("empty").hidden = history.length > 0;
}

async function refresh() {
  showIp("ipv4", null);
  showIp("ipv6", null);
  el("ipv4").textContent = el("ipv6").textContent = "Loading…";

  const [ipv4, ipv6] = await Promise.all([
    fetchIp("https://api.ipify.org?format=json"),
    fetchIp("https://api6.ipify.org?format=json"),
  ]);
  showIp("ipv4", ipv4);
  showIp("ipv6", ipv6);

  if (ipv4 || ipv6) {
    const history = loadHistory();
    const last = history[0];
    if (!last || last.ipv4 !== ipv4 || last.ipv6 !== ipv6) {
      history.unshift({ ipv4, ipv6, time: Date.now() });
      saveHistory(history);
    }
  }
  renderHistory();
}

el("refresh").addEventListener("click", refresh);

el("reset").addEventListener("click", () => {
  if (!confirm("Clear all IP history?")) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  renderHistory();
});

document.querySelectorAll("button.copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = el(btn.dataset.target).textContent;
    if (el(btn.dataset.target).classList.contains("unavailable")) return;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    } catch {}
  });
});

renderHistory();
refresh();
