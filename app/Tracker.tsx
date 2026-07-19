"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = "待核实" | "处理中" | "已解决";

type RecordItem = {
  id: string;
  infringementUrl: string;
  platform: string;
  infringementType: string;
  sourceUrl: string | null;
  title: string | null;
  discoveredAt: string;
  notes: string | null;
  status: Status;
  createdAt: string;
  updatedAt: string;
};

const statuses: Status[] = ["待核实", "处理中", "已解决"];
const platforms = ["小红书", "抖音", "微博", "微信公众号", "知乎", "B站", "其他平台"];
const types = ["原文搬运", "图片盗用", "洗稿改写", "视频盗用", "其他"];

function localDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

const emptyForm = {
  infringementUrl: "",
  platform: "其他平台",
  infringementType: "原文搬运",
  sourceUrl: "",
  title: "",
  discoveredAt: localDate(),
  notes: "",
};

function detectPlatform(value: string) {
  const url = value.toLowerCase();
  if (url.includes("xiaohongshu") || url.includes("xhslink") || url.includes("rednote")) return "小红书";
  if (url.includes("douyin")) return "抖音";
  if (url.includes("weibo")) return "微博";
  if (url.includes("weixin") || url.includes("qq.com")) return "微信公众号";
  if (url.includes("zhihu")) return "知乎";
  if (url.includes("bilibili") || url.includes("b23.tv")) return "B站";
  return "其他平台";
}

function displayHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatDate(value: string) {
  return value.replace(/-/g, ".");
}

export default function Tracker() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | "全部">("全部");
  const [query, setQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/records")
      .then(async (response) => {
        const data = (await response.json()) as { records?: RecordItem[]; error?: string };
        if (!response.ok) throw new Error(data.error || "读取失败");
        setRecords(data.records || []);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "读取失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!composerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setComposerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composerOpen]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const counts = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status, records.filter((item) => item.status === status).length])) as Record<Status, number>,
    [records],
  );

  const visibleRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return records.filter((item) => {
      const statusMatches = filter === "全部" || item.status === filter;
      const queryMatches = !keyword || [item.title, item.platform, item.infringementType, item.infringementUrl, item.notes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
      return statusMatches && queryMatches;
    });
  }, [records, filter, query]);

  function openComposer() {
    setForm({ ...emptyForm, discoveredAt: localDate() });
    setComposerOpen(true);
  }

  function updateUrl(value: string) {
    setForm((current) => ({ ...current, infringementUrl: value, platform: detectPlatform(value) }));
  }

  async function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { record?: RecordItem; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "保存失败");
      setRecords((current) => [data.record!, ...current]);
      setComposerOpen(false);
      setMessage("已收进证据夹");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: Status) {
    const previous = records;
    setRecords((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    try {
      const response = await fetch(`/api/records/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("更新失败");
      setMessage(`已标记为「${status}」`);
    } catch {
      setRecords(previous);
      setMessage("状态更新失败，请重试");
    }
  }

  async function removeRecord(id: string) {
    if (!window.confirm("确定删除这条记录吗？删除后无法恢复。")) return;
    const previous = records;
    setRecords((current) => current.filter((item) => item.id !== id));
    try {
      const response = await fetch(`/api/records/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败");
      setMessage("记录已删除");
    } catch {
      setRecords(previous);
      setMessage("删除失败，请重试");
    }
  }

  function exportCsv() {
    if (!records.length) {
      setMessage("还没有可导出的记录");
      return;
    }
    const headers = ["发现日期", "平台", "侵权类型", "状态", "标题/账号", "侵权链接", "原笔记链接", "备注"];
    const rows = records.map((item) => [
      item.discoveredAt,
      item.platform,
      item.infringementType,
      item.status,
      item.title || "",
      item.infringementUrl,
      item.sourceUrl || "",
      item.notes || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = `侵权记录-${localDate()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="侵权取证夹首页">
          <span className="brand-mark" aria-hidden="true">证</span>
          <span>侵权取证夹</span>
        </a>
        <div className="topbar-actions">
          <span className="private-pill"><i /> 仅你可见</span>
          <button className="icon-button" onClick={exportCsv} aria-label="导出全部记录">导出</button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span>网络创作</span> · 侵权记录</p>
            <h1>收好证据，<br /><em>再慢慢处理。</em></h1>
            <p className="hero-note">把散落在各个平台的侵权链接集中起来，记录发现时间与处理进度，需要时一键导出。</p>
            <button className="primary-button hero-button" onClick={openComposer}>
              <span aria-hidden="true">＋</span> 添加侵权链接
            </button>
          </div>

          <div className="summary-card" aria-label="处理概览">
            <div className="summary-heading">
              <div><span>当前记录</span><strong>{records.length}</strong></div>
              <span className="summary-stamp">持续整理</span>
            </div>
            <div className="status-grid">
              {statuses.map((status) => (
                <button key={status} className={`status-stat ${filter === status ? "active" : ""}`} onClick={() => setFilter(filter === status ? "全部" : status)}>
                  <span className={`status-dot status-${status}`} />
                  <strong>{counts[status]}</strong>
                  <small>{status}</small>
                </button>
              ))}
            </div>
            <details className="evidence-tip">
              <summary>取证时别漏掉什么？</summary>
              <p>建议同时保存完整页面截图、账号主页、发布时间与互动数据；链接只是第一步。</p>
            </details>
          </div>
        </section>

        <section className="records-section">
          <div className="section-title-row">
            <div><p className="section-kicker">EVIDENCE LOG</p><h2>我的侵权记录</h2></div>
            <button className="text-button desktop-add" onClick={openComposer}>＋ 新记录</button>
          </div>

          <div className="tools-row">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜平台、标题或链接" aria-label="搜索记录" />
            </label>
            <div className="filter-tabs" role="group" aria-label="按状态筛选">
              {(["全部", ...statuses] as const).map((status) => (
                <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status}</button>
              ))}
            </div>
          </div>

          <div className="record-list" aria-live="polite">
            {loading ? (
              <div className="loading-card"><span /><span /><span /></div>
            ) : visibleRecords.length ? (
              visibleRecords.map((item, index) => (
                <article className="record-card" key={item.id}>
                  <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="record-main">
                    <div className="record-meta">
                      <span className="platform-pill">{item.platform}</span>
                      <span>{item.infringementType}</span>
                      <span>{formatDate(item.discoveredAt)} 发现</span>
                    </div>
                    <h3>{item.title || `${item.platform}上的疑似侵权内容`}</h3>
                    <a className="record-url" href={item.infringementUrl} target="_blank" rel="noreferrer">{displayHost(item.infringementUrl)}<span>↗</span></a>
                    {item.notes && <p className="record-notes">{item.notes}</p>}
                    <div className="record-actions">
                      <label className={`status-select status-bg-${item.status}`}>
                        <span className={`status-dot status-${item.status}`} />
                        <select value={item.status} onChange={(event) => changeStatus(item.id, event.target.value as Status)} aria-label="修改处理状态">
                          {statuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                      </label>
                      {item.sourceUrl && <a className="secondary-link" href={item.sourceUrl} target="_blank" rel="noreferrer">查看原笔记 ↗</a>}
                      <button className="delete-button" onClick={() => removeRecord(item.id)}>删除</button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <div className="empty-paper" aria-hidden="true"><span>LINK</span><i /></div>
                <h3>{records.length ? "没有符合条件的记录" : "证据夹还是空的"}</h3>
                <p>{records.length ? "换个关键词或筛选条件试试。" : "看到疑似搬运、盗图或洗稿时，先把链接收进来。"}</p>
                {!records.length && <button className="text-button" onClick={openComposer}>添加第一条记录 →</button>}
              </div>
            )}
          </div>
        </section>
      </main>

      <button className="mobile-fab" onClick={openComposer} aria-label="添加侵权链接"><span>＋</span> 添加链接</button>

      {composerOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setComposerOpen(false)}>
          <section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="drag-handle" aria-hidden="true" />
            <div className="composer-header">
              <div><p>NEW EVIDENCE</p><h2 id="composer-title">收进一条侵权链接</h2></div>
              <button className="close-button" onClick={() => setComposerOpen(false)} aria-label="关闭">×</button>
            </div>
            <form onSubmit={submitRecord}>
              <label className="field field-wide">
                <span>侵权内容链接 <b>*</b></span>
                <input type="url" required autoFocus value={form.infringementUrl} onChange={(event) => updateUrl(event.target.value)} placeholder="https://..." inputMode="url" />
                <small>粘贴后会自动识别常见平台</small>
              </label>

              <div className="form-grid">
                <label className="field">
                  <span>所在平台</span>
                  <select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>
                    {platforms.map((platform) => <option key={platform}>{platform}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>侵权类型</span>
                  <select value={form.infringementType} onChange={(event) => setForm({ ...form, infringementType: event.target.value })}>
                    {types.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </label>
              </div>

              <label className="field field-wide">
                <span>内容标题 / 发布账号</span>
                <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="方便之后快速辨认（选填）" />
              </label>

              <div className="form-grid">
                <label className="field">
                  <span>发现日期</span>
                  <input type="date" required value={form.discoveredAt} onChange={(event) => setForm({ ...form, discoveredAt: event.target.value })} />
                </label>
                <label className="field">
                  <span>我的原笔记链接</span>
                  <input type="url" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://...（选填）" inputMode="url" />
                </label>
              </div>

              <label className="field field-wide">
                <span>补充备注</span>
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="例如：已截图；对方账号粉丝约 2 万；内容发布时间……" rows={3} />
              </label>

              <div className="composer-actions">
                <button type="button" className="cancel-button" onClick={() => setComposerOpen(false)}>取消</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? "正在保存…" : "保存到证据夹"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {message && <div className="toast" role="status">{message}</div>}
    </div>
  );
}
