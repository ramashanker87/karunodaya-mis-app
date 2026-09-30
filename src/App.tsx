import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hub } from 'aws-amplify/utils';
import { api, authConfigured, downloadReport, isSignedIn, localMock, login, logout } from './auth';
import { programIds, programNames, type ProgramId, type Role } from '../shared/schema';
import type { ReportTotals } from '../shared/report';
import foundationLogo from '../karunodaya_mis.jpeg';

type PendingUser = { sub: string; email: string | null; name: string | null; createdAt: string };

type View = 'overview' | 'activities' | 'students' | 'tasks' | 'reports' | 'admin';
type Me = { sub: string; status: 'pending' | 'approved' | 'suspended'; role: Role | null; programIds: ProgramId[]; staffId: string | null };
type DirectoryItem = { id: string; kind: 'school' | 'centre' | 'village' | 'staff'; name: string };
type Activity = { id: string; programId: ProgramId; date: string; kind: 'activity' | 'visit' | 'distribution'; activityType: string; locationId: string; facilitatorId: string; attendanceTotal: number; participantIds: string[]; completed: boolean; notes?: string; version: number; deletedAt?: string | null };
type Enrollment = { programId: ProgramId; status: 'active' | 'completed' | 'transferred' | 'dropped'; dropOutStatus?: string | null; locationId: string; version: number };
type Student = { id: string; name: string; enrollment: Enrollment };
type Task = { id: string; programId: ProgramId; title: string; dueDate: string; assigneeId: string; status: 'open' | 'in_progress' | 'done'; version: number };
type Report = { totals: ReportTotals; monthly: { month: string; attendance: number; activities: number }[]; range: { from: string; to: string } };

const thisYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const today = new Date().toISOString().slice(0, 10);
const emptyTotals: ReportTotals = { attendanceTotal: 0, uniqueStudents: 0, currentEnrollment: 0, completedActivities: 0, visits: 0, distributions: 0 };

function Logo() {
  return <div className="app-logo"><img src={foundationLogo} alt="Karunodaya Foundation" width="500" height="238" /><small>PROGRAM WORKSPACE</small></div>;
}

function Icon({ name }: { name: View | 'attendance' | 'enrollment' | 'udyam' | 'sambodhi' | 'llp' | 'sapno' }) {
  const paths = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    activities: 'M8 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3 M8 2h8v5H8z M7 12h10 M7 17h6',
    students: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87',
    tasks: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    reports: 'M3 3v18h18 M7 16v-5 M12 16V7 M17 16V4',
    admin: 'M12 3l9 4v5c0 5-9 10-9 10S3 17 3 12V7z M8 12l3 3 5-6',
    attendance: 'M3 17l6-6 4 4 8-10 M15 5h6v6',
    enrollment: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    udyam: 'M3 3h18v13H3z M8 21h8 M12 16v5',
    sambodhi: 'M12 21V10 M12 15C4 15 3 10 3 5c6 0 9 3 9 10 M12 10c0-5 3-7 9-7 0 6-3 10-9 10',
    llp: 'M12 5v16 M12 5C9 3 6 3 2 4v16c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1',
    sapno: 'M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function LoginScreen({ onLogin, error }: { onLogin: () => void; error: string }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  return <main className="login-shell">
    <div className="login-hero">
      <Logo />
      <div className="login-intro"><span className="eyebrow">LEARNING. OPPORTUNITY. POSSIBILITY.</span><h1>Small steps.<br /><em>Lasting change.</em></h1><p>A simple space to bring our programs, people, and progress together.</p></div>
      <div className="login-programs">{programIds.map((id) => <span key={id}><Icon name={id} />{programNames[id]}</span>)}</div>
    </div>
    <div className="login-card-wrap"><section className="login-card">
      <span className="eyebrow dark">KARUNODAYA MIS</span>
      <h2>{mode === 'login' ? 'Welcome back' : 'Join the workspace'}</h2>
      <p>{mode === 'login' ? 'Sign in to manage your programs and see the progress you’re making.' : 'Request access with your Google account. Your Admin will assign your role and programs.'}</p>
      <div className="login-options" aria-label="Account access"><button aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Login</button><button aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>Sign up</button></div>
      <button className="primary-button google-login" onClick={onLogin} disabled={!authConfigured && !localMock}><svg className="google-g" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.5Z" /><path fill="#34a853" d="M12 22c2.7 0 5-1 6.6-2.3l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z" /><path fill="#fbbc05" d="M6.4 14a6 6 0 0 1 0-4V7.4H3.1a10 10 0 0 0 0 9.2Z" /><path fill="#ea4335" d="M12 5.8c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.4L6.4 10c.8-2.4 3-4.2 5.6-4.2Z" /></svg>{mode === 'login' ? 'Continue with Google' : 'Request access with Google'}<span aria-hidden="true">→</span></button>
      {error && <p className="form-error" role="alert">{error}</p>}{!authConfigured && !localMock && <p className="form-error">Google sign-in is not configured for this environment.</p>}
      <div className="login-access"><Icon name="admin" /><div><strong>A workspace for our team</strong><span>New accounts need Admin approval before accessing program data.</span></div></div>
      <small>Karunodaya Foundation · Every child, every possibility.</small>
    </section></div>
  </main>;
}

function ApprovalCard({ user, reload }: { user: PendingUser; reload: () => void }) {
  const [role, setRole] = useState<Role>('facilitator');
  const [programs, setPrograms] = useState<ProgramId[]>([]);
  const [error, setError] = useState('');
  return <div className="approval-card"><div><strong>{user.email || 'Email unavailable'}</strong>{user.name && <small>{user.name}</small>}<small>User ID: {user.sub}</small><small>Requested {new Date(user.createdAt).toLocaleDateString()}</small></div><select value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="facilitator">Facilitator</option><option value="program_manager">Program Manager</option><option value="admin">Admin / SPM</option></select><div className="approval-programs">{programIds.map((id) => <label key={id}><input type="checkbox" checked={programs.includes(id)} onChange={(event) => setPrograms(event.target.checked ? [...programs, id] : programs.filter((value) => value !== id))} />{programNames[id]}</label>)}</div><button className="primary-button small" onClick={async () => { try { setError(''); if (role !== 'admin' && !programs.length) throw new Error('Choose at least one program'); await api(`/admin/users/${encodeURIComponent(user.sub)}/access`, { method: 'PUT', body: JSON.stringify({ status: 'approved', role, programIds: role === 'admin' ? [...programIds] : programs }) }); reload(); } catch (e) { setError((e as Error).message); } }}>Approve access</button>{error && <span className="form-error">{error}</span>}</div>;
}

function AccessEditor() {
  const [sub, setSub] = useState('');
  const [profile, setProfile] = useState<{ sub: string; status: string; role: Role | null; programIds: ProgramId[] } | null>(null);
  const [role, setRole] = useState<Role>('facilitator');
  const [programs, setPrograms] = useState<ProgramId[]>([]);
  const [status, setStatus] = useState<'approved' | 'suspended'>('approved');
  const [history, setHistory] = useState<{ action: string; actorSub: string; at: string }[]>([]);
  const [message, setMessage] = useState('');
  async function lookup() {
    try {
      const found = await api<NonNullable<typeof profile>>(`/admin/users/${encodeURIComponent(sub)}/access`);
      setProfile(found); setRole(found.role || 'facilitator'); setPrograms(found.programIds); setStatus(found.status === 'suspended' ? 'suspended' : 'approved');
      setHistory((await api<{ items: typeof history }>(`/admin/history/user/${encodeURIComponent(sub)}`)).items); setMessage('');
    } catch (error) { setProfile(null); setMessage((error as Error).message); }
  }
  async function save() {
    if (!profile) return;
    try {
      if (role !== 'admin' && !programs.length) throw new Error('Choose at least one program');
      await api(`/admin/users/${encodeURIComponent(profile.sub)}/access`, { method: 'PUT', body: JSON.stringify({ role, programIds: role === 'admin' ? [...programIds] : programs, status }) });
      await lookup(); setMessage('Access updated and audited.');
    } catch (error) { setMessage((error as Error).message); }
  }
  return <section className="panel form-panel-app"><div className="panel-heading"><div><h2>Manage existing access</h2><p>Look up a Cognito user ID to change role, programs, or suspension</p></div></div><label>Cognito user ID<input value={sub} onChange={(event) => setSub(event.target.value)} placeholder="Cognito sub" /></label><button className="secondary-button" onClick={() => void lookup()}>Find user</button>{profile && <div className="access-editor"><p>Current: {profile.role || 'pending'} · {profile.status}</p><label>Role<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="facilitator">Facilitator</option><option value="program_manager">Program Manager</option><option value="admin">Admin / SPM</option></select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="approved">Approved</option><option value="suspended">Suspended</option></select></label><div className="approval-programs">{programIds.map((id) => <label key={id}><input type="checkbox" checked={programs.includes(id)} onChange={(event) => setPrograms(event.target.checked ? [...programs, id] : programs.filter((value) => value !== id))} />{programNames[id]}</label>)}</div><button className="primary-button small" onClick={() => void save()}>Save access</button><h3>Audit history</h3>{history.map((item, index) => <p key={`${item.at}-${index}`}>{item.at} · {item.action} · {item.actorSub}</p>)}</div>}{message && <p role="status">{message}</p>}</section>;
}

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<View>('overview');
  const [program, setProgram] = useState<ProgramId>('udyam');
  const [year, setYear] = useState(String(thisYear));
  const [location, setLocation] = useState('');
  const [facilitator, setFacilitator] = useState('');
  const [directory, setDirectory] = useState<DirectoryItem[]>([]);
  const [events, setEvents] = useState<Activity[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [deleted, setDeleted] = useState<Activity[]>([]);
  const [eventHistory, setEventHistory] = useState<{ action: string; actorSub: string; at: string }[]>([]);
  const [historyEventId, setHistoryEventId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportMode, setReportMode] = useState<'year' | 'month' | 'week' | 'custom'>('year');
  const [reportFrom, setReportFrom] = useState(`${thisYear}-04-01`);
  const [reportTo, setReportTo] = useState(`${thisYear + 1}-03-31`);
  const [eventForm, setEventForm] = useState({ kind: 'activity', activityType: '', date: today, locationId: '', facilitatorId: '', attendanceTotal: 0, participantIds: '', notes: '' });
  const [editingEvent, setEditingEvent] = useState<Activity | null>(null);
  const [studentForm, setStudentForm] = useState({ name: '', locationId: '', enrolledOn: today, dropOutStatus: '' });
  const [taskForm, setTaskForm] = useState({ title: '', dueDate: today, assigneeId: '', description: '' });
  const [directoryForm, setDirectoryForm] = useState({ kind: 'school', name: '' });

  useEffect(() => { isSignedIn().then(setSignedIn); const off = Hub.listen('auth', ({ payload }) => { if (payload.event === 'signedIn' || payload.event === 'signInWithRedirect') setSignedIn(true); if (payload.event === 'signedOut') { setSignedIn(false); setMe(null); } if (payload.event === 'signInWithRedirect_failure') setError('Google sign-in could not be completed.'); }); return off; }, []);
  useEffect(() => { if (signedIn) api<Me>('/me').then((value) => { setMe(value); if (value.role !== 'admin' && value.programIds.length) setProgram(value.programIds[0]); }).catch((e) => setError(e.message)); }, [signedIn]);

  const allowedPrograms = me?.role === 'admin' ? [...programIds] : me?.programIds || [];
  const locations = directory.filter((item) => item.kind !== 'staff');
  const staff = directory.filter((item) => item.kind === 'staff');
  const nameOf = (id: string) => directory.find((item) => item.id === id)?.name || id;
  const baseQuery = useMemo(() => { const params = new URLSearchParams({ programId: program, programYear: year }); if (location) params.set('locationId', location); if (facilitator) params.set('facilitatorId', facilitator); return params.toString(); }, [program, year, location, facilitator]);

  const reload = useCallback(async () => {
    if (me?.status !== 'approved' || !allowedPrograms.includes(program)) return;
    try {
      setError('');
      const dir = await api<{ items: DirectoryItem[] }>(`/directory?programId=${program}`);
      setDirectory(dir.items);
      if (view === 'overview' || view === 'reports') {
        const data = await api<Report>(`/reports/summary?${baseQuery}`);
        setReport(data);
      }
      if (view === 'overview' || view === 'activities') {
        const data = await api<{ items: Activity[] }>(`/events?${baseQuery}`);
        setEvents(data.items);
      }
      if (view === 'students' && me.role !== 'facilitator') {
        const data = await api<{ items: Student[] }>(`/students?programId=${program}${location ? `&locationId=${location}` : ''}`);
        setStudents(data.items);
      }
      if (view === 'tasks') {
        const data = await api<{ items: Task[] }>(`/tasks?programId=${program}`);
        setTasks(data.items);
      }
      if (view === 'admin' && me.role === 'admin') {
        const [users, removed] = await Promise.all([api<{ items: PendingUser[] }>('/admin/users/pending'), api<{ items: Activity[] }>(`/admin/deleted?programId=${program}`)]);
        setPending(users.items); setDeleted(removed.items);
      }
    } catch (e) { setError((e as Error).message); }
  }, [me, view, program, baseQuery, location]);
  useEffect(() => { void reload(); }, [reload]);

  async function submit(action: () => Promise<unknown>, after?: () => void, refresh = true) {
    try { setBusy(true); setError(''); await action(); after?.(); if (refresh) await reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const reportQuery = () => {
    const params = new URLSearchParams({ programId: program });
    if (location) params.set('locationId', location);
    if (facilitator) params.set('facilitatorId', facilitator);
    if (reportMode === 'year') params.set('programYear', year);
    else {
      let from = reportFrom, to = reportTo;
      if (reportMode === 'month') { from = `${reportFrom.slice(0, 7)}-01`; to = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10); }
      if (reportMode === 'week') { const date = new Date(`${reportFrom}T00:00:00Z`); const day = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - day); from = date.toISOString().slice(0, 10); date.setUTCDate(date.getUTCDate() + 6); to = date.toISOString().slice(0, 10); }
      params.set('from', from); params.set('to', to);
    }
    return params.toString();
  };

  if (signedIn === null) return <div className="loading-screen">Loading your workspace…</div>;
  if (!signedIn) return <LoginScreen error={error} onLogin={() => { setError(''); void login().catch((e) => setError(e.message)); }} />;
  if (!me) return <div className="loading-screen">Checking your access… {error}</div>;
  if (me.status !== 'approved') return <main className="pending-shell"><Logo /><div className="pending-panel"><span className="pending-icon">⌛</span><h1>{me.status === 'suspended' ? 'Access suspended' : 'Approval pending'}</h1><p>Your Google account is connected. An Admin must approve your role and programs before you can access records.</p><button className="secondary-button" onClick={() => api<Me>('/me').then(setMe).catch((e) => setError(e.message))}>Check again</button><button className="text-button" onClick={() => void logout().then(() => setSignedIn(false))}>Sign out</button>{error && <p className="form-error">{error}</p>}</div></main>;

  return <div className="app-shell"><aside className="sidebar"><Logo /><div className="sidebar-label">WORKSPACE</div><nav aria-label="Main navigation">{([['overview', '▦', 'Overview'], ['activities', '◫', 'Activities'], ['students', '♧', 'Students'], ['tasks', '✓', 'Tasks'], ['reports', '▥', 'Reports'], ...(me.role === 'admin' ? [['admin', '♙', 'Admin'] as const] : [])] as [View, string, string][]).filter(([id]) => id !== 'students' || me.role !== 'facilitator').map(([id, , label]) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon name={id} />{label}</button>)}</nav><div className="sidebar-bottom"><div className="user-avatar">{me.role === 'admin' ? 'A' : me.role === 'program_manager' ? 'P' : 'F'}</div><div><strong>{me.role === 'admin' ? 'Admin / SPM' : me.role === 'program_manager' ? 'Program Manager' : 'Facilitator'}</strong><small>Signed in securely</small></div><button title="Sign out" aria-label="Sign out" onClick={() => void logout().then(() => setSignedIn(false))}>↗</button></div></aside>
    <main className="main-area"><header className="topbar"><div className="mobile-logo"><Logo /></div><div className="breadcrumb">Workspace <span>/</span> <strong>{view[0].toUpperCase() + view.slice(1)}</strong></div><div className="topbar-right"><span className="secure-pill">● Secure workspace</span><button className="top-signout" onClick={() => void logout().then(() => setSignedIn(false))}>Sign out</button></div></header><div className="page-content"><div className="page-heading"><div><div className="eyebrow dark">KARUNODAYA MIS</div><h1>{view === 'overview' ? 'Your program at a glance' : view === 'activities' ? 'Program activities' : view === 'students' ? 'Student registry' : view === 'tasks' ? 'Team tasks' : view === 'reports' ? 'Reports' : 'Administration'}</h1><p>{view === 'overview' ? 'Track participation, follow activities, and keep your work moving.' : view === 'reports' ? 'Explore the numbers behind your impact.' : `Manage ${view} across your assigned programs.`}</p></div><span className="year-chip">PROGRAM YEAR {year}–{String(Number(year) + 1).slice(-2)}</span></div>
      <div className="filter-bar"><label>Program<select value={program} onChange={(e) => { setProgram(e.target.value as ProgramId); setLocation(''); setFacilitator(''); }}>{allowedPrograms.map((id) => <option key={id} value={id}>{programNames[id]}</option>)}</select></label><label>Program year<select value={year} onChange={(e) => setYear(e.target.value)}>{[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((value) => <option key={value} value={value}>{value}–{String(value + 1).slice(-2)}</option>)}</select></label><label>School / village<select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">All locations</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Facilitator<select value={facilitator} onChange={(e) => setFacilitator(e.target.value)}><option value="">All facilitators</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      {error && <div className="form-error error-banner" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      {view === 'overview' && <><div className="overview-actions"><span><span className="live-dot" />{programNames[program]}</span><div><button className="secondary-button" onClick={() => setView('reports')}>View reports</button><button className="primary-button" onClick={() => setView('activities')}>+ Add activity</button></div></div><div className="stat-grid">{([['Attendance visits', report?.totals.attendanceTotal ?? 0, 'Total recorded attendance'], ['Unique students', report?.totals.uniqueStudents ?? 0, 'With individual IDs'], ['Current enrollment', report?.totals.currentEnrollment ?? 0, 'Active now'], ['Completed activities', report?.totals.completedActivities ?? 0, 'Finished sessions']] as const).map(([label, value, hint], index) => <div className="stat-card" key={label}><span className={`stat-symbol s${index}`}><Icon name={(['attendance', 'students', 'enrollment', 'tasks'] as const)[index]} /></span><small>{label}</small><strong>{value.toLocaleString()}</strong><span>{hint}</span></div>)}</div><div className="content-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Attendance over time</h2><p>Monthly attendance totals for {programNames[program]}</p></div><span className="panel-tag">APR — MAR</span></div><div className="bar-chart">{(report?.monthly || []).map((point) => { const max = Math.max(1, ...(report?.monthly || []).map((row) => row.attendance)); return <div className="bar-column" key={point.month} title={`${point.month}: ${point.attendance}`}><span className="bar-value">{point.attendance || ''}</span><div className="bar-track"><div style={{ height: `${point.attendance / max * 100}%` }} /></div><small>{new Date(`${point.month}-01T00:00:00Z`).toLocaleString('en', { month: 'short' })}</small></div>; })}</div></section><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Latest source records</p></div><button className="text-button" onClick={() => setView('activities')}>View all →</button></div>{[...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((item) => <div className="recent-row" key={item.id}><span className="recent-icon"><Icon name={item.kind === 'visit' ? 'attendance' : 'activities'} /></span><div><strong>{item.activityType}</strong><small>{nameOf(item.locationId)} · {item.date}</small></div><b title="Recorded attendance">{item.attendanceTotal.toLocaleString()}</b></div>)}{!events.length && <div className="empty-state">No activities recorded for these filters yet.</div>}</section></div><div className="section-heading"><h2>Your programs</h2><p>Choose a program to view its progress.</p></div><div className="program-strip">{allowedPrograms.map((id) => <button key={id} className={program === id ? 'program-tile selected' : 'program-tile'} aria-pressed={program === id} onClick={() => { setProgram(id); setLocation(''); setFacilitator(''); }}><span><Icon name={id} /></span><strong>{programNames[id]}</strong><small>{program === id ? 'Currently viewing' : 'View program →'}</small></button>)}</div></>}
      {view === 'activities' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Activity records</h2><p>Visits, distributions, and completed sessions</p></div><span className="panel-tag">{events.length} RECORDS</span></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Location</th><th>Attendance</th><th>Action</th></tr></thead><tbody>{events.map((item) => <tr key={item.id}><td>{item.date}</td><td><strong>{item.activityType}</strong><small>{item.kind}</small></td><td>{nameOf(item.locationId)}</td><td>{item.attendanceTotal}</td><td><button className="table-action" onClick={() => { setEditingEvent(item); setEventForm({ kind: item.kind, activityType: item.activityType, date: item.date, locationId: item.locationId, facilitatorId: item.facilitatorId, attendanceTotal: item.attendanceTotal, participantIds: item.participantIds.join(', '), notes: item.notes || '' }); }}>Edit</button><button className="table-action" onClick={() => submit(() => api(`/events/${program}/${item.date}/${item.id}`, { method: 'DELETE' }))}>Delete</button></td></tr>)}</tbody></table>{!events.length && <div className="empty-state">No records yet. Add one using the form.</div>}</div></section><section className="panel form-panel-app"><div className="panel-heading"><div><h2>{editingEvent ? 'Correct source record' : 'Add a source record'}</h2><p>Every activity is stored once</p></div></div><form onSubmit={(e) => { e.preventDefault(); submit(() => api(editingEvent ? `/events/${program}/${editingEvent.date}/${editingEvent.id}` : '/events', { method: editingEvent ? 'PATCH' : 'POST', body: JSON.stringify({ ...eventForm, programId: program, attendanceTotal: Number(eventForm.attendanceTotal), participantIds: eventForm.participantIds.split(',').map((id) => id.trim()).filter(Boolean), completed: true, details: {}, ...(editingEvent ? { version: editingEvent.version } : {}) }) }), () => { setEditingEvent(null); setEventForm({ ...eventForm, activityType: '', attendanceTotal: 0, participantIds: '', notes: '' }); }); }}><label>Record type<select value={eventForm.kind} onChange={(e) => setEventForm({ ...eventForm, kind: e.target.value })}><option value="activity">Activity</option><option value="visit">Visit</option><option value="distribution">Distribution</option></select></label><label>Activity name<input required minLength={2} value={eventForm.activityType} onChange={(e) => setEventForm({ ...eventForm, activityType: e.target.value })} placeholder="e.g. Digital literacy session" /></label><label>Date<input type="date" required disabled={Boolean(editingEvent)} value={eventForm.date} onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })} /></label><div className="form-row"><label>Location<select required value={eventForm.locationId} onChange={(e) => setEventForm({ ...eventForm, locationId: e.target.value })}><option value="">Choose location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Facilitator<select required value={eventForm.facilitatorId} onChange={(e) => setEventForm({ ...eventForm, facilitatorId: e.target.value })}><option value="">Choose facilitator</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Attendance total<input type="number" min="0" required value={eventForm.attendanceTotal} onChange={(e) => setEventForm({ ...eventForm, attendanceTotal: Number(e.target.value) })} /></label><label>Student IDs, if individually recorded<input value={eventForm.participantIds} onChange={(e) => setEventForm({ ...eventForm, participantIds: e.target.value })} placeholder="Comma separated stable IDs" /></label><label>Notes<textarea value={eventForm.notes} onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })} placeholder="Reflection or observations" /></label><button className="primary-button" disabled={busy}>{editingEvent ? 'Save correction →' : 'Save activity →'}</button>{editingEvent && <button type="button" className="text-button" onClick={() => setEditingEvent(null)}>Cancel edit</button>}</form>{me.role !== 'facilitator' && <div className="inline-create"><h3>Add school, centre, village, or staff</h3><div className="form-row"><select value={directoryForm.kind} onChange={(e) => setDirectoryForm({ ...directoryForm, kind: e.target.value })}><option value="school">School</option><option value="centre">Centre</option><option value="village">Village</option><option value="staff">Staff</option></select><input value={directoryForm.name} onChange={(e) => setDirectoryForm({ ...directoryForm, name: e.target.value })} placeholder="Name" /></div><button className="secondary-button" disabled={busy} onClick={() => submit(() => api('/directory', { method: 'POST', body: JSON.stringify({ ...directoryForm, programId: program }) }), () => setDirectoryForm({ ...directoryForm, name: '' }))}>Add to directory</button></div>}</section></div>}
      {view === 'students' && me.role !== 'facilitator' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Students</h2><p>Current enrollment and status</p></div><span className="panel-tag">{students.length} STUDENTS</span></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Location</th><th>Status</th><th>Update</th></tr></thead><tbody>{students.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{nameOf(item.enrollment.locationId)}</td><td><span className={`status-badge ${item.enrollment.status}`}>{item.enrollment.status}</span></td><td><select value={item.enrollment.status} onChange={(e) => submit(() => api(`/students/${item.id}/status`, { method: 'POST', body: JSON.stringify({ programId: program, status: e.target.value, effectiveDate: today, dropOutStatus: e.target.value === 'dropped' ? 'not specified' : null, version: item.enrollment.version }) }))}><option value="active">Active</option><option value="completed">Completed</option><option value="transferred">Transferred</option><option value="dropped">Dropped</option></select></td></tr>)}</tbody></table>{!students.length && <div className="empty-state">No students enrolled in this view.</div>}</div></section><section className="panel form-panel-app"><div className="panel-heading"><div><h2>Enroll a student</h2><p>Creates a stable student ID and dated history</p></div></div><form onSubmit={(e) => { e.preventDefault(); submit(() => api('/students', { method: 'POST', body: JSON.stringify({ ...studentForm, programId: program, status: 'active', dropOutStatus: studentForm.dropOutStatus || null }) }), () => setStudentForm({ ...studentForm, name: '', dropOutStatus: '' })); }}><label>Student name<input required value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} /></label><label>Location<select required value={studentForm.locationId} onChange={(e) => setStudentForm({ ...studentForm, locationId: e.target.value })}><option value="">Choose location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Enrollment date<input type="date" required value={studentForm.enrolledOn} onChange={(e) => setStudentForm({ ...studentForm, enrolledOn: e.target.value })} /></label><button className="primary-button" disabled={busy}>Enroll student →</button></form></section></div>}
      {view === 'tasks' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Team tasks</h2><p>Keep follow-ups moving</p></div><span className="panel-tag">{tasks.length} TASKS</span></div><div className="task-list">{tasks.map((item) => <div key={item.id} className="task-row"><span className={item.status === 'done' ? 'task-check done' : 'task-check'}>{item.status === 'done' ? '✓' : ''}</span><div><strong>{item.title}</strong><small>{nameOf(item.assigneeId)} · Due {item.dueDate}</small></div><select value={item.status} onChange={(e) => submit(() => api(`/tasks/${program}/${item.dueDate}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value, version: item.version }) }))}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option></select></div>)}{!tasks.length && <div className="empty-state">No tasks yet for this program.</div>}</div></section><section className="panel form-panel-app"><div className="panel-heading"><div><h2>Create a task</h2><p>Assign clear ownership and a due date</p></div></div><form onSubmit={(e) => { e.preventDefault(); submit(() => api('/tasks', { method: 'POST', body: JSON.stringify({ ...taskForm, programId: program, status: 'open' }) }), () => setTaskForm({ ...taskForm, title: '', description: '' })); }}><label>Task title<input required minLength={2} value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} /></label><label>Assignee<select required value={taskForm.assigneeId} onChange={(e) => setTaskForm({ ...taskForm, assigneeId: e.target.value })}><option value="">Choose staff member</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Due date<input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} /></label><label>Description<textarea value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} /></label><button className="primary-button" disabled={busy}>Create task →</button></form></section></div>}
      {view === 'reports' && <div className="report-layout"><section className="panel"><div className="panel-heading"><div><h2>Build a report</h2><p>Every export respects your assigned programs</p></div></div><div className="report-controls"><label>Period<select value={reportMode} onChange={(e) => setReportMode(e.target.value as typeof reportMode)}><option value="year">April–March year</option><option value="month">Month</option><option value="week">Week</option><option value="custom">Custom range</option></select></label>{reportMode === 'year' ? <p>Using program year {year}–{String(Number(year) + 1).slice(-2)}</p> : <label>{reportMode === 'month' ? 'Month' : reportMode === 'week' ? 'Week containing' : 'From'}<input type={reportMode === 'month' ? 'month' : 'date'} value={reportMode === 'month' ? reportFrom.slice(0, 7) : reportFrom} onChange={(e) => setReportFrom(reportMode === 'month' ? `${e.target.value}-01` : e.target.value)} /></label>}{reportMode === 'custom' && <label>To<input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} /></label>}<button className="primary-button" onClick={() => submit(async () => setReport(await api<Report>(`/reports/summary?${reportQuery()}`)), undefined, false)}>Generate report</button></div></section><section className="panel report-result"><div className="panel-heading"><div><h2>Report summary</h2><p>{report?.range.from} — {report?.range.to}</p></div></div><div className="report-metrics">{Object.entries(report?.totals || emptyTotals).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{value}</strong></div>)}</div><div className="export-actions"><button className="secondary-button" onClick={() => submit(() => downloadReport(`/reports/export?${reportQuery()}&format=csv`))}>↓ Download CSV</button><button className="secondary-button" onClick={() => submit(() => downloadReport(`/reports/export?${reportQuery()}&format=pdf`))}>↓ Download PDF</button></div><p className="privacy-note">General exports contain totals only. Individual student information is excluded.</p></section></div>}
      {view === 'admin' && me.role === 'admin' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Pending approvals</h2><p>Assign a role and explicit programs</p></div><span className="panel-tag">{pending.length} PENDING</span></div>{pending.map((user) => <ApprovalCard key={user.sub} user={user} reload={() => void reload()} />)}{!pending.length && <div className="empty-state">No users are waiting for access.</div>}</section><section className="panel"><div className="panel-heading"><div><h2>Restore deleted records</h2><p>Soft-deleted events in {programNames[program]}</p></div></div>{deleted.map((item) => <div className="restore-row" key={item.id}><div><strong>{item.activityType}</strong><small>{item.date} · {item.id}</small></div><button className="secondary-button" onClick={() => submit(() => api(`/admin/restore/${program}/${item.date}/${item.id}`, { method: 'POST' }))}>Restore</button><button className="text-button" onClick={() => { setHistoryEventId(item.id); void api<{ items: typeof eventHistory }>(`/admin/history/event/${item.id}`).then((data) => setEventHistory(data.items)).catch((error) => setError(error.message)); }}>History</button></div>)}{historyEventId && <div className="audit-history"><h3>History for {historyEventId}</h3>{eventHistory.map((entry, index) => <p key={`${entry.at}-${index}`}>{entry.at} · {entry.action} · {entry.actorSub}</p>)}</div>}{!deleted.length && <div className="empty-state">No deleted activities to restore.</div>}</section><AccessEditor /></div>}
    </div></main></div>;
}
