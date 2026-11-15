const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "applications.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const CAPACITY = parseInt(process.env.CAPACITY || "25", 10); // 0 = 제한 없음

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const HOUSE = ["무주택", "1주택", "2주택 이상"];
const EXPERIENCE = ["없음", "입찰만 해봄", "낙찰 1~2회", "낙찰 3회 이상"];
const SOURCE = ["", "유튜브", "지인 소개", "카페·커뮤니티", "기타"];

// ---------- storage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadApplications() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

function saveApplications(list) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Serialize writes so two submissions never overwrite each other.
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// ---------- helpers ----------
function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, ...extra });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), TYPES[".json"]);

function readBody(req, limit = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // 엑셀 수식 주입 방지
  return '"' + s.replace(/"/g, '""') + '"';
}

function passwordMatches(pass) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash("sha256").update(String(pass)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function isAdmin(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const pass = Buffer.from(h.slice(6), "base64").toString("utf8").split(":").slice(1).join(":");
  return passwordMatches(pass);
}

function requireAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    send(res, 503, "관리자 페이지가 꺼져 있습니다. Railway 변수에 ADMIN_PASSWORD를 설정하세요.");
    return false;
  }
  if (!isAdmin(req)) {
    send(res, 401, "로그인이 필요합니다.", undefined, { "WWW-Authenticate": 'Basic realm="admin", charset="UTF-8"' });
    return false;
  }
  return true;
}

// ---------- handlers ----------
async function handleApply(req, res) {
  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, e.status || 400, { error: "요청 형식이 올바르지 않습니다." });
  }

  // 봇이 채우는 숨은 칸: 조용히 성공한 척
  if (data.website) return json(res, 200, { ok: true, number: 0 });

  const name = String(data.name || "").trim().slice(0, 30);
  const phone = String(data.phone || "").replace(/\D/g, "");
  const email = String(data.email || "").trim().slice(0, 80);
  const house = String(data.house || "");
  const experience = String(data.experience || "");
  const source = String(data.source || "");
  const question = String(data.question || "").trim().slice(0, 500);

  if (!name) return json(res, 400, { error: "이름을 입력해 주세요." });
  if (!/^01[016789]\d{7,8}$/.test(phone)) return json(res, 400, { error: "휴대폰 번호를 확인해 주세요." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "이메일 주소 형식을 확인해 주세요." });
  if (!HOUSE.includes(house)) return json(res, 400, { error: "주택 보유 현황을 선택해 주세요." });
  if (!EXPERIENCE.includes(experience)) return json(res, 400, { error: "경매 경험을 선택해 주세요." });
  if (!SOURCE.includes(source)) return json(res, 400, { error: "알게 된 경로를 다시 선택해 주세요." });
  if (data.agree !== true) return json(res, 400, { error: "개인정보 수집·이용에 동의해야 신청할 수 있습니다." });

  const formatted = phone.length === 11
    ? `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
    : `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;

  try {
    const result = await withLock(() => {
      const list = loadApplications();
      const existing = list.find((a) => a.phone === formatted);
      if (existing) return { status: 409, body: { error: `이미 ${existing.number}번으로 신청된 번호입니다.` } };
      if (CAPACITY > 0 && list.length >= CAPACITY) return { status: 409, body: { error: "정원이 마감되었습니다. 신청해 주셔서 감사합니다." } };
      const number = list.reduce((m, a) => Math.max(m, a.number), 0) + 1;
      list.push({
        number,
        name, phone: formatted, email, house, experience, source, question,
        agreedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      saveApplications(list);
      return { status: 200, body: { ok: true, number } };
    });
    json(res, result.status, result.body);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: "신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}

const NOTICES = {
  deleted: "신청 1건을 삭제했습니다.",
  cleared: "신청 내역을 전부 삭제했습니다. 지운 내용은 서버의 백업 파일에 남아 있습니다.",
  empty: "지울 신청 내역이 없습니다.",
  notfound: "해당 번호의 신청을 찾지 못했습니다. 이미 삭제됐을 수 있습니다.",
  badpass: "비밀번호가 맞지 않아 삭제하지 않았습니다.",
  badconfirm: "확인 문구가 맞지 않아 삭제하지 않았습니다. '전체 삭제'라고 정확히 입력해 주세요.",
};

function handleAdmin(req, res) {
  if (!requireAdmin(req, res)) return;
  const list = loadApplications();
  const count = (key, val) => list.filter((a) => a[key] === val).length;
  const q = new URL(req.url, "http://localhost").searchParams;
  const notice = NOTICES[q.get("msg")] || "";
  const isErr = ["badpass", "badconfirm", "notfound"].includes(q.get("msg"));
  const rows = list
    .map((a) => `<tr><td>${a.number}</td><td>${esc(a.name)}</td><td>${esc(a.phone)}</td><td>${esc(a.email)}</td><td>${esc(a.house)}</td><td>${esc(a.experience)}</td><td>${esc(a.source)}</td><td>${esc(a.question)}</td><td>${esc(new Date(a.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }))}</td>
<td><details class="del"><summary>삭제</summary><form method="post" action="/admin/delete"><input type="hidden" name="number" value="${a.number}"><span>${esc(a.name)}님 신청을 지울까요?</span><button type="submit">삭제 확인</button></form></details></td></tr>`)
    .join("");
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>신청자 명단 · 쿵쿵나리 특강</title>
<style>
:root{--bg:#f5f7f9;--paper:#fff;--ink:#17212b;--muted:#5b6875;--line:#d3dae1;--seal:#c2302a;--seal-soft:#fbeceb;--ok:#1f6f5c;--ok-soft:#e6f3ef;--head:#eef2f6}
@media (prefers-color-scheme:dark){:root{--bg:#11161b;--paper:#182029;--ink:#e6ebf0;--muted:#9aa7b4;--line:#2e3a46;--seal:#ef6b62;--seal-soft:#2c1c1b;--ok:#5cc4a6;--ok-soft:#16302a;--head:#1e2832;color-scheme:dark}}
body{font-family:"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;margin:0;padding:24px 16px 64px;background:var(--bg);color:var(--ink);word-break:keep-all}
main{max-width:1200px;margin:0 auto;display:grid;gap:16px}
h1{margin:0;font-size:24px} p{margin:0;color:var(--muted)}
.stats{display:flex;flex-wrap:wrap;gap:8px}
.stats span{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px}
a.btn{justify-self:start;background:var(--seal);color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px}
.notice{border-radius:6px;padding:10px 14px;background:var(--ok-soft);border:1px solid var(--ok);color:var(--ink)}
.notice.err{background:var(--seal-soft);border-color:var(--seal)}
.tbl{overflow-x:auto;background:var(--paper);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:980px;font-size:14px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--head)}
button{font:inherit;cursor:pointer;border-radius:6px;border:0;padding:6px 12px;background:var(--seal);color:#fff}
button:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.del summary{cursor:pointer;color:var(--seal);font-size:13px}
.del form{display:grid;gap:6px;margin-top:6px;font-size:13px}
.danger{background:var(--paper);border:2px solid var(--seal);border-radius:8px;padding:16px;display:grid;gap:10px;max-width:560px}
.danger h2{margin:0;font-size:18px;color:var(--seal)}
.danger form{display:grid;gap:10px}
.danger label{display:grid;gap:4px;font-size:14px;font-weight:700}
.danger input{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)}
.danger button{justify-self:start;padding:10px 16px;font-weight:700}
</style></head><body><main>
<h1>쿵쿵나리 특강 신청자 명단</h1>
<p>12월 10일(목) 10:00 · 신촌 포스빌 (마포구 신촌로 150, 204호) · 참가비 3만원${CAPACITY > 0 ? ` · 정원 ${CAPACITY}명 · 남은 자리 ${Math.max(0, CAPACITY - list.length)}석` : ""}</p>
${notice ? `<div class="notice${isErr ? " err" : ""}" role="status">${esc(notice)}</div>` : ""}
<div class="stats"><span>전체 ${list.length}명</span>${HOUSE.map((h) => `<span>${h} ${count("house", h)}명</span>`).join("")}</div>
<a class="btn" href="/admin/applications.csv">엑셀(CSV)로 받기</a>
<div class="tbl"><table><thead><tr><th>번호</th><th>이름</th><th>연락처</th><th>이메일</th><th>주택</th><th>경매 경험</th><th>경로</th><th>질문</th><th>신청 시각</th><th>관리</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10">아직 신청자가 없습니다.</td></tr>'}</tbody></table></div>
<section class="danger" aria-labelledby="danger-h">
  <h2 id="danger-h">신청 내역 전부 삭제</h2>
  <p>신청 ${list.length}건을 모두 지웁니다. 지우기 전에 엑셀로 받아 두세요. 삭제한 내용은 서버의 백업 파일에만 남습니다.</p>
  <form method="post" action="/admin/delete-all" autocomplete="off">
    <label for="confirm"><span>확인을 위해 <b>전체 삭제</b>라고 입력하세요</span><input id="confirm" name="confirm" type="text" required></label>
    <label for="password">관리자 비밀번호를 다시 입력하세요<input id="password" name="password" type="password" required></label>
    <button type="submit">전부 삭제</button>
  </form>
</section>
</main></body></html>`;
  send(res, 200, html, TYPES[".html"], { "Cache-Control": "no-store" });
}

// 다른 사이트에서 몰래 보내는 요청(CSRF)을 막기 위해 같은 주소에서 온 POST만 받습니다.
function sameOrigin(req) {
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try {
    return new URL(src).host === req.headers.host;
  } catch {
    return false;
  }
}

function redirectAdmin(res, msg) {
  send(res, 303, "", undefined, { Location: "/admin?msg=" + msg, "Cache-Control": "no-store" });
}

async function readForm(req) {
  return new URLSearchParams(await readBody(req));
}

async function handleDelete(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!sameOrigin(req)) return send(res, 403, "다른 사이트에서 보낸 요청은 처리하지 않습니다.");
  let form;
  try {
    form = await readForm(req);
  } catch (e) {
    return send(res, e.status || 400, "요청 형식이 올바르지 않습니다.");
  }
  const number = parseInt(form.get("number") || "", 10);
  const result = await withLock(() => {
    const list = loadApplications();
    const next = list.filter((a) => a.number !== number);
    if (next.length === list.length) return "notfound";
    saveApplications(next);
    console.log(`[admin] deleted application #${number}`);
    return "deleted";
  });
  redirectAdmin(res, result);
}

async function handleDeleteAll(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!sameOrigin(req)) return send(res, 403, "다른 사이트에서 보낸 요청은 처리하지 않습니다.");
  let form;
  try {
    form = await readForm(req);
  } catch (e) {
    return send(res, e.status || 400, "요청 형식이 올바르지 않습니다.");
  }
  if ((form.get("confirm") || "").trim() !== "전체 삭제") return redirectAdmin(res, "badconfirm");
  if (!passwordMatches(form.get("password") || "")) return redirectAdmin(res, "badpass");

  const result = await withLock(() => {
    const list = loadApplications();
    if (list.length === 0) return "empty";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(DATA_DIR, `applications.deleted-${stamp}.json`), JSON.stringify(list, null, 2));
    saveApplications([]);
    console.log(`[admin] deleted all ${list.length} applications (backup saved)`);
    return "cleared";
  });
  redirectAdmin(res, result);
}

function handleCsv(req, res) {
  if (!requireAdmin(req, res)) return;
  const list = loadApplications();
  const header = ["번호", "이름", "연락처", "이메일", "주택 보유", "경매 경험", "알게 된 경로", "질문", "신청 시각"];
  const lines = [header.map(csvCell).join(",")].concat(
    list.map((a) =>
      [a.number, a.name, a.phone, a.email, a.house, a.experience, a.source, a.question,
        new Date(a.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })].map(csvCell).join(",")
    )
  );
  send(res, 200, "﻿" + lines.join("\r\n"), "text/csv; charset=utf-8", {
    "Content-Disposition": "attachment; filename=\"applications.csv\"",
    "Cache-Control": "no-store",
  });
}

function serveStatic(urlPath, res) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");
  else if (!path.extname(filePath)) filePath += ".html"; // /apply → apply.html

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not Found");
    send(res, 200, data, TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return send(res, 400, "Bad Request");
  }

  if (urlPath === "/health") return send(res, 200, "ok");
  if (urlPath === "/api/status") {
    try {
      return json(res, 200, { count: loadApplications().length, capacity: CAPACITY });
    } catch (e) {
      return json(res, 500, { error: "status unavailable" });
    }
  }
  if (urlPath === "/api/apply") {
    if (req.method !== "POST") return send(res, 405, "Method Not Allowed", undefined, { Allow: "POST" });
    return handleApply(req, res);
  }
  // 신청서는 대본 페이지 맨 아래로 합쳐졌습니다. 예전 링크(/apply)는 그쪽으로 보냅니다.
  if (urlPath === "/apply" || urlPath === "/apply/" || urlPath === "/apply.html") {
    return send(res, 301, "Moved", undefined, { Location: "/#apply" });
  }
  if (urlPath === "/admin" || urlPath === "/admin/") return handleAdmin(req, res);
  if (urlPath === "/admin/applications.csv") return handleCsv(req, res);
  if (urlPath === "/admin/delete" || urlPath === "/admin/delete-all") {
    if (req.method !== "POST") return send(res, 405, "Method Not Allowed", undefined, { Allow: "POST" });
    return urlPath === "/admin/delete" ? handleDelete(req, res) : handleDeleteAll(req, res);
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
  serveStatic(urlPath, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT} (data: ${DATA_FILE})`);
});
