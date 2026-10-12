// Side panels: task board, approval queue, room details, command bar and the wire (live feed).
import { useEffect, useRef, useState } from 'react';
import type { State, Task, Approval, OfficeEvent } from './live';
import { post } from './live';

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
// Agents may write "media/out/x.mp4" or an absolute path; serve both from /media.
const mediaUrl = (p: string) => '/' + p.slice(p.search(/(^|\/)media\//)).replace(/^\/+/, '');
const isMedia = (v: unknown): v is string => typeof v === 'string' && /(^|\/)media\/[^\s]+$/.test(v);

export function Panel({ title, children, extra, className = '' }: { title: string; children: React.ReactNode; extra?: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
      <header className="panel-head"><h2>{title}</h2>{extra}</header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function TaskBoard({ tasks }: { tasks: Task[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const groups = {
    running: tasks.filter(t => t.status === 'running' || t.status === 'queued'),
    'done today': tasks.filter(t => (t.status === 'done' || t.status === 'failed') && Date.parse(t.updated_at) >= +today),
    'awaiting approval': tasks.filter(t => t.status === 'awaiting_approval'),
  };
  const [tab, setTab] = useState<keyof typeof groups>('running');
  return (
    <Panel title="Task Board" className="tasks">
      <div className="counts" role="tablist">
        {(Object.keys(groups) as (keyof typeof groups)[]).map(k => (
          <button key={k} role="tab" aria-selected={tab === k} className={`count ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            <strong>{groups[k].length}</strong><span>{k}</span>
          </button>
        ))}
      </div>
      <ul className="task-list">
        {groups[tab].length === 0 && <li className="empty">Nothing here.</li>}
        {groups[tab].map(t => (
          <li key={t.id} className={`task ${t.status}`}>
            <span className="tid">#{t.id}</span>
            <span className="ttitle">{t.title}</span>
            <span className="tmeta">{t.agent} · {t.status.replace('_', ' ')} · {ago(t.updated_at)}</span>
            {t.output && <span className="tout">→ {t.output}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function DraftView({ draft }: { draft: Record<string, any> }) {
  return (
    <dl className="draft">
      {Object.entries(draft).map(([k, v]) => (
        <div key={k} className="draft-row">
          <dt>{k}</dt>
          <dd>
            {isMedia(v) && /\.(mp4|webm|mov)$/i.test(v) ? <video src={mediaUrl(v)} controls preload="metadata" /> :
              isMedia(v) && /\.(png|jpe?g|webp)$/i.test(v) ? <a href={mediaUrl(v)} target="_blank" rel="noreferrer"><img src={mediaUrl(v)} alt={k} /></a> :
              isMedia(v) ? <a href={mediaUrl(v)} target="_blank" rel="noreferrer">{v}</a> :
              typeof v === 'object' ? <pre>{JSON.stringify(v, null, 2)}</pre> : <pre>{String(v)}</pre>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ApprovalCard({ a, onChange }: { a: Approval; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); setEditing(false); onChange(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const parsed = () => { try { return JSON.parse(text); } catch { throw new Error('Draft must be valid JSON'); } };
  return (
    <article className={`approval ${a.status}`}>
      <header>
        <span className={`kind kind-${a.kind}`}>{a.kind}</span>
        <h3>{a.title}</h3>
        <span className="ameta">#{a.id} · {a.agent} · {ago(a.created_at)} ago</span>
      </header>
      <p className="reason"><b>Why:</b> {a.reason}</p>
      {editing
        ? <textarea className="draft-edit" value={text} onChange={e => setText(e.target.value)} rows={12} spellCheck={false} aria-label="Edit draft JSON" />
        : <DraftView draft={a.draft} />}
      {a.status === 'pending' ? (
        <footer className="actions">
          <button className="btn approve" disabled={busy} onClick={() => act(() => post(`/api/approvals/${a.id}/approve`, editing ? { draft: parsed() } : {}))}>Approve</button>
          <button className="btn reject" disabled={busy} onClick={() => act(() => post(`/api/approvals/${a.id}/reject`))}>Reject</button>
          {editing
            ? <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/approvals/${a.id}/edit`, { draft: parsed() }))}>Save edit</button>
            : <button className="btn" disabled={busy} onClick={() => { setText(JSON.stringify(a.draft, null, 2)); setEditing(true); }}>Edit</button>}
          {editing && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </footer>
      ) : <footer className="verdict">{a.status}{a.result ? ` — ${a.result}` : ''}</footer>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

export function ApprovalQueue({ approvals, onChange }: { approvals: Approval[]; onChange: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const pending = approvals.filter(a => a.status === 'pending');
  const list = showDone ? approvals.filter(a => a.status !== 'pending').slice(0, 15) : pending;
  return (
    <Panel title="Approval Queue" className="approvals"
      extra={<button className="link" onClick={() => setShowDone(s => !s)}>{showDone ? `pending (${pending.length})` : 'decided'}</button>}>
      {list.length === 0 && <p className="empty">{showDone ? 'No decisions yet.' : 'Nothing waiting on you.'}</p>}
      {list.map(a => <ApprovalCard key={a.id} a={a} onChange={onChange} />)}
    </Panel>
  );
}

export function RoomPanel({ team, onClose, state }: { team: string; onClose: () => void; state: State }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/team/${team}`).then(r => r.json()).then(d => alive && setData(d));
    return () => { alive = false; };
  }, [team, state.tasks]);
  const t = state.teams.find(x => x.id === team);
  return (
    <div className="room-panel" role="dialog" aria-label={`${t?.room} details`}>
      <Panel title={t?.room ?? team} extra={<button className="link" onClick={onClose} aria-label="Close">close ✕</button>}>
        <p className="mission">{t?.mission}</p>
        <h4>Staff</h4>
        <ul className="staff">
          {state.agents.filter(a => a.team === team).map(a => (
            <li key={a.name}><b>{a.name}{t?.lead === a.name ? ' ★' : ''}</b><span>{a.does}</span></li>
          ))}
        </ul>
        <h4>Current tasks</h4>
        <ul className="task-list">
          {!data?.tasks?.length && <li className="empty">No tasks yet.</li>}
          {data?.tasks?.map((x: Task) => (
            <li key={x.id} className={`task ${x.status}`}><span className="tid">#{x.id}</span><span className="ttitle">{x.title}</span><span className="tmeta">{x.agent} · {x.status} · {ago(x.updated_at)}</span></li>
          ))}
        </ul>
        <h4>Recent brain entries</h4>
        {data?.brain?.map((b: any) => (
          <details key={b.path} className="brain-entry"><summary>{b.path} <em>{ago(b.mtime)} ago</em></summary><pre>{b.preview}</pre></details>
        ))}
      </Panel>
    </div>
  );
}

export function CommandBar({ reports }: { reports: { ok: boolean; text: string; taskId: number }[] }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const send = async () => {
    if (!text.trim()) return;
    try { const r = await post('/api/command', { text }); setStatus(`Sent to the Chief of Staff (task #${r.task.id}).`); setText(''); }
    catch (e: any) { setStatus(`Failed: ${e.message}`); }
  };
  const mic = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); r.lang = navigator.language; r.interimResults = true;
    r.onresult = (e: any) => setText([...e.results].map((x: any) => x[0].transcript).join(''));
    r.onend = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  };
  const last = reports[0];
  return (
    <div className="command">
      <form onSubmit={e => { e.preventDefault(); send(); }}>
        <span className="prompt">CHIEF ▸</span>
        <input value={text} onChange={e => setText(e.target.value)} placeholder='e.g. "Grab the 3 new clips from Drive and edit them in parallel"' aria-label="Request for the Chief of Staff" />
        {SR && <button type="button" className={`btn mic ${listening ? 'on' : ''}`} onClick={mic} aria-label={listening ? 'Stop dictation' : 'Dictate'}>{listening ? '■' : '🎙'}</button>}
        <button className="btn approve" type="submit">Send</button>
      </form>
      {(status || last) && (
        <details className="report">
          <summary>{last ? `Chief's report on task #${last.taskId}${last.ok ? '' : ' (failed)'}` : status}</summary>
          {last && <pre>{last.text}</pre>}
        </details>
      )}
    </div>
  );
}

export function Wire({ feed }: { feed: OfficeEvent[] }) {
  return (
    <div className="wire" aria-label="Live activity">
      {feed.slice(0, 14).map(e => (
        <span key={e.id} className={`wire-item ev-${e.type}`}>
          <b>{e.agent}</b> {e.type === 'agent_start' ? 'clocked in' : e.type === 'agent_stop' ? 'clocked out' : e.label}
        </span>
      ))}
    </div>
  );
}
