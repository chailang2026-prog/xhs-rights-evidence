"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  reviewStatuses,
  targetPlatforms,
  type NoteScan,
  type PlatformId,
  type ReviewStatus,
  type ScanMatch,
} from "../lib/types";

type AuthState = "loading" | "login" | "ready" | "unconfigured";
type Filter = "全部" | ReviewStatus;

const scanSteps = [
  "正在读取笔记中的文字与图片…",
  "正在检索大众点评、携程等公开页面…",
  "正在用图片视觉匹配查找疑似盗图…",
  "正在计算线索强度并整理结果…",
];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function Score({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" }) {
  if (!value) return null;
  return (
    <span className={`score score-${tone}`} title={`${label}线索强度 ${percent(value)}`}>
      <i style={{ "--score": `${Math.round(value * 100)}%` } as React.CSSProperties} />
      {label} {percent(value)}
    </span>
  );
}

export default function Scanner() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [password, setPassword] = useState("");
  const [noteUrl, setNoteUrl] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>(targetPlatforms.map((platform) => platform.id));
  const [scans, setScans] = useState<NoteScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("全部");
  const [expandedScan, setExpandedScan] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data: { configured: boolean; authenticated: boolean }) => {
        if (!data.configured) setAuth("unconfigured");
        else setAuth(data.authenticated ? "ready" : "login");
      })
      .catch(() => setAuth("login"));
  }, []);

  useEffect(() => {
    if (auth !== "ready") return;
    let active = true;
    fetch("/api/scans")
      .then(async (response) => {
        const data = (await response.json()) as { scans?: NoteScan[]; error?: string };
        if (response.status === 401) {
          if (active) setAuth("login");
          return;
        }
        if (!response.ok) throw new Error(data.error || "读取扫描记录失败。");
        if (active) setScans(data.scans || []);
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "读取扫描记录失败。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [auth]);

  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => setScanStep((current) => (current + 1) % scanSteps.length), 3600);
    return () => window.clearInterval(timer);
  }, [scanning]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5200);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function login(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "登录失败。");
      setPassword("");
      setLoading(true);
      setAuth("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败。");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setScans([]);
    setAuth("login");
  }

  function togglePlatform(id: PlatformId) {
    setSelectedPlatforms((current) => current.includes(id)
      ? current.length > 1 ? current.filter((item) => item !== id) : current
      : [...current, id]);
  }

  async function startScan(event: FormEvent) {
    event.preventDefault();
    setScanning(true);
    setScanStep(0);
    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteUrl, platforms: selectedPlatforms }),
      });
      const data = (await response.json()) as { scan?: NoteScan; error?: string };
      if (response.status === 401) {
        setAuth("login");
        throw new Error("登录已过期，请重新登录。");
      }
      if (!response.ok || !data.scan) throw new Error(data.error || "扫描失败。");
      setScans((current) => [data.scan as NoteScan, ...current.filter((item) => item.id !== data.scan?.id)]);
      setExpandedScan(data.scan.id);
      setNoteUrl("");
      setMessage(data.scan.matches.length ? `已找到 ${data.scan.matches.length} 条疑似相似内容，请逐条复核。` : "本次未发现达到阈值的公开线索。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描失败。");
    } finally {
      setScanning(false);
    }
  }

  async function rerunScan(id: string) {
    setScanning(true);
    setScanStep(1);
    try {
      const response = await fetch(`/api/scans/${id}`, { method: "POST" });
      const data = (await response.json()) as { scan?: NoteScan; error?: string };
      if (!response.ok || !data.scan) throw new Error(data.error || "重新扫描失败。");
      setScans((current) => current.map((item) => item.id === id ? data.scan as NoteScan : item));
      setMessage(`重新扫描完成，当前有 ${data.scan.matches.length} 条线索。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新扫描失败。");
    } finally {
      setScanning(false);
    }
  }

  async function changeReview(scanId: string, matchId: string, reviewStatus: ReviewStatus) {
    const previous = scans;
    setScans((current) => current.map((scan) => scan.id === scanId
      ? { ...scan, matches: scan.matches.map((match) => match.id === matchId ? { ...match, reviewStatus } : match) }
      : scan));
    try {
      const response = await fetch(`/api/matches/${matchId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewStatus }),
      });
      if (!response.ok) throw new Error("更新失败。");
      setMessage(`已标记为「${reviewStatus}」。`);
    } catch (error) {
      setScans(previous);
      setMessage(error instanceof Error ? error.message : "更新失败。");
    }
  }

  async function removeScan(id: string) {
    if (!window.confirm("删除这条笔记及其全部匹配线索？此操作无法撤销。")) return;
    try {
      const response = await fetch(`/api/scans/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败。");
      setScans((current) => current.filter((item) => item.id !== id));
      setMessage("扫描记录已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败。");
    }
  }

  const allMatches = useMemo(() => scans.flatMap((scan) => scan.matches.map((match) => ({ scan, match }))), [scans]);
  const counts = useMemo(() => Object.fromEntries(reviewStatuses.map((status) => [status, allMatches.filter(({ match }) => match.reviewStatus === status).length])) as Record<ReviewStatus, number>, [allMatches]);
  const visibleScans = useMemo(() => filter === "全部" ? scans : scans
    .map((scan) => ({ ...scan, matches: scan.matches.filter((match) => match.reviewStatus === filter) }))
    .filter((scan) => scan.matches.length), [filter, scans]);

  function exportCsv() {
    const headers = ["原笔记", "目标平台", "疑似侵权链接", "匹配类型", "综合线索强度", "文字匹配强度", "图片匹配强度", "复核状态", "证据说明", "发现时间"];
    const rows = allMatches.map(({ scan, match }) => [scan.sourceUrl, match.platformName, match.targetUrl, match.matchType, percent(match.overallScore), percent(match.textScore), percent(match.imageScore), match.reviewStatus, match.evidence.join("；"), match.discoveredAt]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `侵权雷达线索-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (auth === "loading") return <div className="boot-screen"><span className="radar-pulse" /><p>正在打开原创雷达…</p></div>;

  if (auth === "login" || auth === "unconfigured") {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="login-mark"><span /><i /></div>
          <p className="eyebrow">PRIVATE CONTENT RADAR</p>
          <h1>原创雷达</h1>
          <p className="login-copy">你的笔记和扫描结果仅在登录后可见。</p>
          {auth === "unconfigured" ? (
            <div className="setup-warning"><strong>部署尚未完成</strong><p>请在扣子云环境变量中设置至少 8 位的 <code>APP_PASSWORD</code>，然后重新部署。</p></div>
          ) : (
            <form onSubmit={login} className="login-form">
              <label><span>访问密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus autoComplete="current-password" placeholder="输入访问密码" /></label>
              <button className="primary-button" type="submit">进入原创雷达</button>
            </form>
          )}
          <small>系统只提供疑似线索，最终是否构成侵权需由你或专业人士判断。</small>
        </section>
        {message && <div className="toast" role="status">{message}</div>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-radar"><i /></span><b>原创雷达</b></a>
        <div className="header-actions"><span className="private-badge">仅你可见</span><button onClick={logout}>退出</button></div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span>小红书原创保护</span> · 图文全网匹配</p>
            <h1>贴入一条笔记，<br /><em>开始寻找搬运痕迹。</em></h1>
            <p>读取笔记文字和图片，在旅行出游、生活探店平台的公开网页中寻找疑似搬运、盗图或改写内容。</p>
          </div>
          <form className="scan-panel" onSubmit={startScan}>
            <div className="scan-panel-head"><div><span>STEP 01</span><h2>粘贴小红书笔记链接</h2></div><div className="live-dot">公开索引检索</div></div>
            <label className="url-field">
              <span className="link-icon">↗</span>
              <input type="url" value={noteUrl} onChange={(event) => setNoteUrl(event.target.value)} required disabled={scanning} placeholder="https://www.xiaohongshu.com/explore/…" inputMode="url" aria-label="小红书笔记链接" />
            </label>
            <fieldset className="platform-picker">
              <legend>重点扫描平台</legend>
              <div>{targetPlatforms.map((platform) => <button key={platform.id} type="button" aria-pressed={selectedPlatforms.includes(platform.id)} className={selectedPlatforms.includes(platform.id) ? "selected" : ""} onClick={() => togglePlatform(platform.id)}>{platform.name}<i /></button>)}</div>
            </fieldset>
            <button className="scan-button" type="submit" disabled={scanning}>{scanning ? <><span className="button-spinner" />{scanSteps[scanStep]}</> : <>开始全网匹配 <span>→</span></>}</button>
            <p className="scan-caption">每次会比对最多 4 张原图，并通过百度与 Google 对正文关键句进行逐平台检索。</p>
          </form>
        </section>

        <section className="how-it-works" aria-label="扫描流程">
          <div><b>01</b><span><strong>提取原笔记</strong><small>标题、正文与图片</small></span></div>
          <i>→</i>
          <div><b>02</b><span><strong>搜索公开网页</strong><small>百度 + Google + Google Lens</small></span></div>
          <i>→</i>
          <div><b>03</b><span><strong>线索强度排序</strong><small>保留可点击的来源链接</small></span></div>
        </section>

        <section className="results-section">
          <div className="section-heading">
            <div><p className="section-kicker">MATCH REVIEW</p><h2>疑似侵权线索</h2><span>匹配结果不是法律结论，请逐条打开原网页核实。</span></div>
            <button className="export-button" onClick={exportCsv} disabled={!allMatches.length}>导出 CSV</button>
          </div>

          <div className="summary-strip">
            <button className={filter === "全部" ? "active" : ""} onClick={() => setFilter("全部")}><strong>{allMatches.length}</strong><span>全部线索</span></button>
            {reviewStatuses.slice(0, 3).map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(filter === status ? "全部" : status)}><strong>{counts[status]}</strong><span>{status}</span></button>)}
          </div>

          <div className="scan-list" aria-live="polite">
            {loading ? <div className="loading-card"><span /><span /><span /></div> : visibleScans.length ? visibleScans.map((scan) => {
              const open = expandedScan === scan.id || filter !== "全部";
              return (
                <article className="scan-card" key={scan.id}>
                  <div className="source-row">
                    <div className="source-thumb">
                      {scan.sourceImages[0] ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={scan.sourceImages[0]} alt="原笔记首图" />
                      ) : <span>小红书</span>}
                    </div>
                    <div className="source-info"><div><span className={`scan-status status-${scan.status}`}>{scan.status}</span><time>{formatDate(scan.createdAt)}</time></div><h3>{scan.sourceTitle || "小红书图文笔记"}</h3><a href={scan.sourceUrl} target="_blank" rel="noreferrer">查看原笔记 ↗</a></div>
                    <div className="scan-count"><strong>{scan.matches.length}</strong><span>条线索</span></div>
                  </div>
                  {scan.errorMessage && <p className="scan-warning">部分能力未完成：{scan.errorMessage}</p>}
                  <div className="scan-toolbar"><button onClick={() => setExpandedScan(open ? null : scan.id)}>{open ? "收起线索" : `查看 ${scan.matches.length} 条线索`}</button><button onClick={() => rerunScan(scan.id)} disabled={scanning}>重新扫描</button><button className="danger-link" onClick={() => removeScan(scan.id)}>删除</button></div>
                  {open && <div className="matches-list">{scan.matches.length ? scan.matches.map((match) => <MatchCard key={match.id} match={match} onChange={(status) => changeReview(scan.id, match.id, status)} />) : <div className="no-matches"><span>✓</span><div><strong>暂未发现达到阈值的公开线索</strong><p>这不代表全网一定不存在搬运内容，可以稍后重新扫描。</p></div></div>}</div>}
                </article>
              );
            }) : <div className="empty-state"><div className="empty-radar"><i /><span /></div><h3>{scans.length ? "该筛选条件下没有线索" : "还没有扫描过笔记"}</h3><p>{scans.length ? "切换复核状态查看其他结果。" : "把你发布过的小红书笔记链接粘贴到上方，系统会自动开始匹配。"}</p></div>}
          </div>
        </section>
      </main>
      <footer><span>原创雷达</span><p>只检索公开可访问且已被搜索引擎收录的网页，不绕过平台登录或反爬机制。</p></footer>
      {message && <div className="toast" role="status">{message}</div>}
    </div>
  );
}

function MatchCard({ match, onChange }: { match: ScanMatch; onChange: (status: ReviewStatus) => void }) {
  return (
    <article className="match-card">
      <div className="match-score"><strong>{percent(match.overallScore)}</strong><span>线索强度</span></div>
      <div className="match-body">
        <div className="match-meta"><span className={`platform platform-${match.platform}`}>{match.platformName}</span><span>{match.matchType}</span><time>{formatDate(match.discoveredAt)}</time></div>
        <h4>{match.title}</h4>
        <p>{match.snippet}</p>
        <div className="evidence-row"><Score label="文字" value={match.textScore} tone="amber" /><Score label="图片" value={match.imageScore} tone="red" />{match.evidence.map((item) => <span className="evidence-chip" key={item}>{item}</span>)}</div>
        <div className="match-actions"><a href={match.targetUrl} target="_blank" rel="noreferrer">打开疑似侵权页面 ↗</a><label><span>复核状态</span><select value={match.reviewStatus} onChange={(event) => onChange(event.target.value as ReviewStatus)}>{reviewStatuses.map((status) => <option key={status}>{status}</option>)}</select></label></div>
      </div>
    </article>
  );
}
