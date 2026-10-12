import { useEffect, useState } from 'react';
import { useOffice } from './live';
import { Floor } from './Floor';
import { TaskBoard, ApprovalQueue, RoomPanel, CommandBar, Wire } from './Panels';

export function App() {
  const { state, instances, pulses, feed, connected, reports, refresh } = useOffice();
  const [room, setRoom] = useState<string>();
  const [fx, setFx] = useState(() => { try { return localStorage.getItem('hq-fx') !== 'off'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('hq-fx', fx ? 'on' : 'off'); } catch { /* storage blocked */ } }, [fx]);

  if (!state) return <div className="loading">Unlocking the building…</div>;
  const working = new Set([...instances.values()].map(i => i.agent)).size;
  const pending = state.approvals.filter(a => a.status === 'pending').length;
  return (
    <div className={`app ${fx ? 'fx' : ''}`}>
      <div className="sky" aria-hidden><div className="rain" /><div className="rain far" /><div className="skyline" /></div>
      <header className="topbar">
        <h1><span className="deco">◆</span> AGENT HQ <span className="deco">◆</span></h1>
        <div className="stats">
          <span><b>{working}</b> at work</span>
          <span><b>{state.agents.length}</b> on staff</span>
          <span className={pending ? 'alert' : ''}><b>{pending}</b> awaiting you</span>
          <span className={`conn ${connected ? 'up' : 'down'}`}>{connected ? '● live wire' : '○ reconnecting'}</span>
          <button className="btn ghost small" onClick={() => setFx(f => !f)} aria-pressed={fx}>grain + scanlines {fx ? 'on' : 'off'}</button>
        </div>
      </header>
      <main className="layout">
        <div className="stage">
          <Floor state={state} instances={instances} pulses={pulses} onRoom={setRoom} selected={room} />
          <Wire feed={feed} />
        </div>
        <aside className="side">
          {room ? <RoomPanel team={room} state={state} onClose={() => setRoom(undefined)} /> : <TaskBoard tasks={state.tasks} />}
          <ApprovalQueue approvals={state.approvals} generations={state.generations} onChange={refresh} />
        </aside>
      </main>
      <CommandBar reports={reports} />
      <div className="grain" aria-hidden /><div className="scanlines" aria-hidden />
    </div>
  );
}
