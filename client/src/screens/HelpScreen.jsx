import React, { useMemo, useState } from 'react';
import { releases, featureAreas, bugs, knownLimitations } from '../data/helpContent.js';

const SECTIONS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'features', label: 'Features' },
  { id: 'releases', label: 'Release Notes' },
  { id: 'bugs', label: 'Known & Fixed Bugs' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'shortcuts', label: 'Tips & Conventions' },
];

const STATUS_BADGE = {
  fixed:    'bg-green-100 text-green-700 border-green-200',
  open:     'bg-red-50 text-red-700 border-red-200',
  wontfix:  'bg-gray-100 text-gray-700 border-gray-200',
};

export default function HelpScreen({ version, onClose }) {
  const [section, setSection] = useState('welcome');
  const [query, setQuery] = useState('');

  const filteredFeatures = useMemo(() => {
    if (!query.trim()) return featureAreas;
    const q = query.toLowerCase();
    return featureAreas
      .map(area => ({
        ...area,
        features: area.features.filter(f =>
          f.title.toLowerCase().includes(q)
          || (f.summary || '').toLowerCase().includes(q)
          || (f.body || '').toLowerCase().includes(q)
          || (f.location || '').toLowerCase().includes(q)
        ),
      }))
      .filter(area => area.features.length > 0);
  }, [query]);

  const filteredBugs = useMemo(() => {
    if (!query.trim()) return bugs;
    const q = query.toLowerCase();
    return bugs.filter(b =>
      b.title.toLowerCase().includes(q)
      || (b.summary || '').toLowerCase().includes(q)
      || (b.body || '').toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="flex-1 flex bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            BRAT Help
          </div>
          <div className="text-xs text-gray-400 mt-0.5">v{version}</div>
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search…"
          className="mx-3 mt-3 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-[#39b6e6]"
        />
        <nav className="flex-1 overflow-auto p-2">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                section === s.id
                  ? 'bg-[#002144] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        {onClose && (
          <button
            onClick={onClose}
            className="m-3 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
          >
            Close Help
          </button>
        )}
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {section === 'welcome' && <WelcomeSection version={version} />}
          {section === 'features' && <FeaturesSection areas={filteredFeatures} query={query} />}
          {section === 'releases' && <ReleasesSection releases={releases} />}
          {section === 'bugs' && <BugsSection bugs={filteredBugs} />}
          {section === 'limitations' && <LimitationsSection limitations={knownLimitations} />}
          {section === 'shortcuts' && <ShortcutsSection />}
        </div>
      </main>
    </div>
  );
}

// ── Sections ─────────────────────────────────────────────────────────

function WelcomeSection({ version }) {
  return (
    <article>
      <h1 className="text-2xl font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        Welcome to B.R.A.T. <span className="text-sm text-gray-400 font-normal">v{version}</span>
      </h1>
      <p className="text-sm text-gray-700 mt-2 leading-relaxed">
        BRAT (Batch Rate Analytics Tool) batch-rates LTL shipments against the 3G TMS Rating API,
        analyzes the results, and helps you build award scenarios. Everything runs in your browser
        — there's no BRAT server, and credentials are never written to disk.
      </p>
      <div className="grid grid-cols-2 gap-3 mt-5">
        <Tile title="Run a batch" body="Connect to 3G TMS → upload a CSV → tune the execution controls → start. Save partial results at any time." />
        <Tile title="Analyze results" body="The KPI bar at the top of every Results tab summarizes the run. Tabs cover analytics, scenarios, optimization, performance, carrier feedback, and annual award." />
        <Tile title="Build scenarios" body="In the Scenarios tab, pick eligible carriers globally or per customer location. Use Exception Lanes to manually pin specific lanes to a carrier." />
        <Tile title="Save / share" body="Save full or partial runs as JSON. Export analytics to CSV/XLSX. Share carrier feedback as a PDF." />
      </div>
    </article>
  );
}

function Tile({ title, body }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="font-semibold text-[#002144]">{title}</div>
      <div className="text-xs text-gray-600 mt-1 leading-relaxed">{body}</div>
    </div>
  );
}

function FeaturesSection({ areas, query }) {
  if (areas.length === 0) {
    return <Empty>No features match "{query}".</Empty>;
  }
  return (
    <article className="space-y-6">
      <Heading>Features</Heading>
      {areas.map(area => (
        <section key={area.id}>
          <h3 className="text-sm font-bold text-[#002144] uppercase tracking-wide mb-2" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            {area.title}
          </h3>
          <div className="space-y-2">
            {area.features.map(f => (
              <div key={f.id} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-semibold text-[#002144]">{f.title}</div>
                    {f.location && (
                      <div className="text-[11px] text-gray-500 mt-0.5">{f.location}</div>
                    )}
                  </div>
                </div>
                {f.summary && <p className="text-sm text-gray-700 mt-2 leading-relaxed">{f.summary}</p>}
                {f.body && <p className="text-xs text-gray-500 mt-2 leading-relaxed">{f.body}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function ReleasesSection({ releases }) {
  return (
    <article>
      <Heading>Release Notes</Heading>
      <p className="text-xs text-gray-500 mb-4">Newest first. Patch bumps for fixes/copy, minor for features, major for breaking schema changes.</p>
      <div className="space-y-4">
        {releases.map(r => (
          <div key={r.version} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-sm font-bold text-[#002144] font-mono">v{r.version}</span>
              <span className="text-xs text-gray-400">{r.date}</span>
            </div>
            {r.summary && <p className="text-sm text-gray-700 mt-1 leading-relaxed">{r.summary}</p>}
            {Array.isArray(r.items) && r.items.length > 0 && (
              <ul className="text-xs text-gray-600 mt-2 space-y-1 list-disc pl-5">
                {r.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function BugsSection({ bugs }) {
  if (bugs.length === 0) {
    return <Empty>No bugs match.</Empty>;
  }
  return (
    <article>
      <Heading>Known & Fixed Bugs</Heading>
      <p className="text-xs text-gray-500 mb-4">Visible record of issues so context isn't lost. Fixed entries also live in CLAUDE.md as "do not re-introduce".</p>
      <div className="space-y-2">
        {bugs.map(b => (
          <div key={b.id} className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${STATUS_BADGE[b.status] || STATUS_BADGE.open}`}>
                {b.status}
              </span>
              <div className="flex-1">
                <div className="font-semibold text-[#002144]">{b.title}</div>
                {b.fixedIn && <div className="text-[11px] text-gray-500 mt-0.5">Fixed in v{b.fixedIn}</div>}
              </div>
            </div>
            {b.summary && <p className="text-sm text-gray-700 mt-2 leading-relaxed">{b.summary}</p>}
            {b.body && <p className="text-xs text-gray-500 mt-2 leading-relaxed">{b.body}</p>}
          </div>
        ))}
      </div>
    </article>
  );
}

function LimitationsSection({ limitations }) {
  return (
    <article>
      <Heading>Known Limitations</Heading>
      <p className="text-xs text-gray-500 mb-4">Things to be aware of. None are blockers for normal use.</p>
      <div className="space-y-2">
        {limitations.map(l => (
          <div key={l.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="font-semibold text-[#002144]">{l.title}</div>
            <p className="text-xs text-gray-700 mt-1 leading-relaxed">{l.summary}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function ShortcutsSection() {
  return (
    <article>
      <Heading>Tips & Conventions</Heading>
      <ul className="text-sm text-gray-700 space-y-2 leading-relaxed list-disc pl-5">
        <li><strong>Credentials are memory-only.</strong> They're cleared on logout and never written to localStorage or disk. Edit Connection from the header to update.</li>
        <li><strong>Save partial runs.</strong> If a batch is taking too long, "Pause &amp; Save" downloads the in-flight state so you can resume in a new tab later.</li>
        <li><strong>Customer-vs-internal view.</strong> Analytics and Scenarios tabs have a Customer toggle that hides raw cost / discount / margin numbers — safe for sharing the screen with a customer.</li>
        <li><strong>Tab state persists.</strong> Sort / filter / expanded / scroll position are preserved when you switch tabs and come back. Same for the selected SCAC.</li>
        <li><strong>Customer locations enrich many tabs.</strong> Upload a list once (Annual Award → Locations) and Scenarios, Carrier Feedback, and Annual Award all start grouping by customer location.</li>
        <li><strong>The version pill in the header</strong> tells you whether your deploy is fresh — refresh after a known release to pick up the new build.</li>
      </ul>
    </article>
  );
}

function Heading({ children }) {
  return (
    <h2 className="text-xl font-bold text-[#002144] mb-3" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
      {children}
    </h2>
  );
}

function Empty({ children }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-lg p-6 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}
