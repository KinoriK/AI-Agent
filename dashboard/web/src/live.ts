// Live office state: REST snapshot + WebSocket event stream -> who is working, on what, and brain pulses.
import { useEffect, useRef, useState, useCallback } from 'react';

export type Team = { id: string; name: string; room: string; lead: string; mission: string };
export type AgentInfo = { name: string; team: string; title: string; does: string };
export type Task = { id: number; team: string; agent: string; title: string; status: string; output?: string; notes?: string; created_at: string; updated_at: string };
export type Approval = { id: number; kind: string; team: string; agent: string; title: string; draft: Record<string, any>; reason: string; status: string; result?: string; created_at: string; decided_at?: string; task_id?: number };
export type OfficeEvent = { id: number; ts: string; type: string; agent?: string; team?: string; tool?: string; label?: string; session?: string; instance?: string; data?: string };
export type Integration = { name: string; mode: 'live' | 'mock'; missing: string[]; liveSupported: boolean };
export type State = { teams: Team[]; agents: AgentInfo[]; tasks: Task[]; approvals: Approval[]; integrations: Integration[] };
export type Instance = { id: string; agent: string; label: string; tool?: string; last: number; session?: string };
export type Pulse = { id: number; team: string; write: boolean; at: number };

const STALE_MS = 3 * 60_000; // an instance with no events for this long is considered finished

function applyEvent(instances: Map<string, Instance>, e: OfficeEvent) {
  const at = Date.parse(e.ts);
  if (!e.agent) return;
  const id = e.instance ?? e.session ?? e.agent;
  if (e.type === 'agent_stop') { instances.delete(id); return; }
  if (e.type === 'session_stop') {
    for (const [k, v] of instances) if (v.session === e.session) instances.delete(k);
    return;
  }
  if (e.type === 'agent_start' || e.type === 'tool_start' || e.type === 'tool_end') {
    const prev = instances.get(id);
    instances.set(id, {
      id, agent: e.agent, session: e.session ?? prev?.session, last: at,
      label: e.type === 'agent_start' ? 'reading the brief' : e.type === 'tool_end' ? (prev?.label ?? 'thinking') : e.label ?? 'working',
      tool: e.type === 'tool_start' ? e.tool : prev?.tool,
    });
  }
}

export function useOffice() {
  const [state, setState] = useState<State | null>(null);
  const [instances, setInstances] = useState<Map<string, Instance>>(new Map());
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [feed, setFeed] = useState<OfficeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [reports, setReports] = useState<{ ok: boolean; text: string; taskId: number }[]>([]);
  const inst = useRef(new Map<string, Instance>());
  const refetchTimer = useRef<number>();

  const refresh = useCallback(async () => {
    const r = await fetch('/api/state');
    const s = await r.json();
    setState(s);
    return s;
  }, []);
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(refresh, 300);
  }, [refresh]);

  const ingest = useCallback((events: OfficeEvent[], live: boolean) => {
    let touched = false;
    const newPulses: Pulse[] = [];
    for (const e of events) {
      applyEvent(inst.current, e);
      if (e.type === 'task' || e.type === 'approval') touched = true;
      if (live && e.type === 'tool_start' && e.tool?.includes('brain_'))
        newPulses.push({ id: e.id, team: e.team ?? 'chief', write: e.tool.endsWith('brain_write'), at: Date.now() });
    }
    const now = Date.now();
    for (const [k, v] of inst.current) if (now - v.last > STALE_MS) inst.current.delete(k);
    setInstances(new Map(inst.current));
    setFeed(f => [...events.filter(e => e.type !== 'tool_end').reverse(), ...f].slice(0, 80));
    if (newPulses.length) setPulses(p => [...p.filter(x => now - x.at < 2500), ...newPulses]);
    if (touched && live) scheduleRefresh();
  }, [scheduleRefresh]);

  useEffect(() => {
    let ws: WebSocket | undefined, closed = false, retry: number | undefined;
    refresh().then((s: any) => ingest(s.events ?? [], false));
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => { setConnected(true); refresh(); };
      ws.onclose = () => { setConnected(false); if (!closed) retry = window.setTimeout(connect, 1500); };
      ws.onmessage = m => {
        const msg = JSON.parse(m.data);
        if (msg.kind === 'events') ingest(msg.events, true);
        if (msg.kind === 'chief_report') { setReports(r => [msg, ...r].slice(0, 5)); refresh(); }
      };
    };
    connect();
    const sweep = window.setInterval(() => ingest([], true), 5000); // expire stale instances
    return () => { closed = true; ws?.close(); clearTimeout(retry); clearInterval(sweep); };
  }, [refresh, ingest]);

  return { state, instances, pulses, feed, connected, reports, refresh };
}

export async function post(url: string, body: object = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}
