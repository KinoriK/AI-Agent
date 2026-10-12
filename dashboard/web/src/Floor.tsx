// Top-down floor plan: 8 team rooms + the Chief's private office around a central atrium with the brain.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { State, Instance, Pulse, Integration } from './live';
import { Desk } from './Sprite';

const W = 1600, H = 1000;
type Rect = { x: number; y: number; w: number; h: number; door: [number, number]; side: 'top' | 'bottom' | 'left' | 'right' };
export const ROOMS: Record<string, Rect> = {
  research:  { x: 0,    y: 0,   w: 380, h: 300, door: [330, 300],  side: 'bottom' },
  scripts:   { x: 380,  y: 0,   w: 420, h: 300, door: [590, 300],  side: 'bottom' },
  social:    { x: 800,  y: 0,   w: 420, h: 300, door: [1010, 300], side: 'bottom' },
  analytics: { x: 1220, y: 0,   w: 380, h: 300, door: [1270, 300], side: 'bottom' },
  creative:  { x: 0,    y: 300, w: 380, h: 400, door: [380, 500],  side: 'right' },
  dev:       { x: 1220, y: 300, w: 380, h: 400, door: [1220, 500], side: 'left' },
  shop:      { x: 0,    y: 700, w: 380, h: 300, door: [330, 700],  side: 'top' },
  inbox:     { x: 380,  y: 700, w: 420, h: 300, door: [590, 700],  side: 'top' },
  chief:     { x: 1220, y: 700, w: 380, h: 300, door: [1550, 700], side: 'top' },
};
const LOBBY = { x: 800, y: 700, w: 420, h: 300 };
const BRAIN: [number, number] = [800, 500];

function useFit(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / W, el.clientHeight / H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

export function Floor({ state, instances, pulses, onRoom, selected }: {
  state: State; instances: Map<string, Instance>; pulses: Pulse[]; onRoom: (team: string) => void; selected?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scale = useFit(ref);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(t); }, []);

  const byAgent = new Map<string, Instance[]>();
  for (const i of instances.values()) byAgent.set(i.agent, [...(byAgent.get(i.agent) ?? []), i]);
  const now = Date.now();
  const live = pulses.filter(p => now - p.at < 2200);
  const brainHot = live.length > 0;
  const working = new Set([...instances.values()].map(i => i.agent));

  return (
    <div className="floor-wrap" ref={ref}>
      <div className="floor" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="atrium" style={{ left: 380, top: 300, width: 840, height: 400 }}>
          <div className="searchlight" />
          <div className="atrium-tiles" />
        </div>

        {state.teams.map(team => {
          const r = ROOMS[team.id];
          const members = state.agents.filter(a => a.team === team.id);
          const desks = members.flatMap(a => {
            const inst = byAgent.get(a.name) ?? [];
            const first = inst[0];
            return [
              { key: a.name, name: a.name, working: inst.length > 0, label: first?.label, ghost: false },
              ...inst.slice(1).map((i, n) => ({ key: i.id, name: `${a.name} #${n + 2}`, working: true, label: i.label, ghost: true })),
            ];
          });
          const busy = members.some(a => working.has(a.name));
          return (
            <section key={team.id} className={`room room-${team.id} ${busy ? 'busy' : ''} ${selected === team.id ? 'selected' : ''}`}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }} onClick={() => onRoom(team.id)}
              role="button" tabIndex={0} aria-label={`${team.room}, ${team.name} team`} onKeyDown={e => e.key === 'Enter' && onRoom(team.id)}>
              <header className="room-head">
                <span className="room-name">{team.room}</span>
              </header>
              {team.id === 'chief' && <div className="rug" />}
              <div className={`desks ${team.id === 'chief' ? 'solo' : ''}`}>
                {desks.map(d => <Desk key={d.key} name={d.name} working={d.working} label={d.label} ghost={d.ghost} />)}
              </div>
            </section>
          );
        })}

        {state.teams.map(team => {
          const r = ROOMS[team.id];
          return <div key={team.id} className={`nameplate door-${r.side}`} style={{ left: r.door[0], top: r.door[1] }}>{team.name}</div>;
        })}

        <Lobby integrations={state.integrations} />

        <svg className="traces" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e6f7ff" />
              <stop offset="35%" stopColor="var(--brain)" />
              <stop offset="100%" stopColor="#0b2a3a" stopOpacity="0" />
            </radialGradient>
          </defs>
          {live.map(p => {
            const r = ROOMS[p.team] ?? ROOMS.chief;
            return <line key={p.id} className={`trace ${p.write ? 'write' : 'read'}`} x1={BRAIN[0]} y1={BRAIN[1]} x2={r.door[0]} y2={r.door[1]} />;
          })}
          <g className={`brain ${brainHot ? 'hot' : ''}`} transform={`translate(${BRAIN[0]} ${BRAIN[1]})`}>
            <circle className="halo" r="120" fill="url(#core)" />
            <circle className="ring r1" r="74" />
            <circle className="ring r2" r="58" />
            <polygon className="ring r3" points="0,-92 92,0 0,92 -92,0" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map(a => <line key={a} className="ray" x1="0" y1="-64" x2="0" y2="-82" transform={`rotate(${a})`} />)}
            <circle className="core" r="34" fill="url(#core)" />
            <text className="brain-label" y="128" textAnchor="middle">THE BRAIN</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

function Lobby({ integrations }: { integrations: Integration[] }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <section className="lobby" style={{ left: LOBBY.x, top: LOBBY.y, width: LOBBY.w, height: LOBBY.h }}>
      <header className="room-head"><span className="room-name">Lobby</span><span className="room-team">Switchboard</span></header>
      <div className="lobby-body">
        <div className="elevators">
          {[0, 1].map(i => <div key={i} className="elevator"><div className="dial" /><div className="doors" /></div>)}
          <div className="clock">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <ul className="switchboard">
          {integrations.map(i => (
            <li key={i.name} title={i.mode === 'mock' ? `Mock mode. Add ${i.missing.join(', ')}${i.liveSupported ? '' : ' (live adapter not built yet)'}` : 'Live'}>
              <span className={`jack ${i.mode}`} />{i.name}<em>{i.mode}</em>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
