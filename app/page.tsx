'use client';

import { useState, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
interface CheckResult {
  name: string;
  category: string;
  passed: boolean;
  score: number;
  maxPoints: number;
  detail: string;
  techDetail: string;
}

interface CategoryScore {
  name: string;
  score: number;
  maxPoints: number;
  percentage: number;
  checks: CheckResult[];
}

interface ScanResult {
  url: string;
  domain: string;
  overallScore: number;
  grade: string;
  gradeLabel: string;
  categories: {
    discoverability: CategoryScore;
    contentClarity: CategoryScore;
    structuredData: CategoryScore;
    technicalAccessibility: CategoryScore;
    advancedSignals: CategoryScore;
  };
  totalChecks: number;
  passedChecks: number;
  scanDurationMs: number;
  pagesScanned: number;
  errors: string[];
}

type ViewState = 'input' | 'loading' | 'results';

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function getScoreClass(score: number): string {
  if (score >= 81) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 60) return 'average';
  if (score >= 50) return 'below';
  return 'poor';
}

function getCheckStatus(check: CheckResult): string {
  if (check.passed) return 'pass';
  if (check.score > 0) return 'partial';
  return 'fail';
}

function getCheckStatusLabel(check: CheckResult): string {
  if (check.passed) return 'Pass';
  if (check.score > 0) return 'Partial';
  return 'Fail';
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const [currentView, setCurrentView] = useState<ViewState>('input');
  const [urlInput, setUrlInput] = useState('');
  const [loadingUrl, setLoadingUrl] = useState('');
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loadingSteps, setLoadingSteps] = useState<number[]>([]);

  useEffect(() => {
    if (currentView === 'loading') {
      const delays = [0, 600, 1300, 2100, 2900, 3700];
      const timers = delays.map((delay, index) => {
        return setTimeout(() => {
          setLoadingSteps(prev => [...prev, index]);
        }, delay);
      });
      return () => { timers.forEach(timer => clearTimeout(timer)); };
    } else {
      setLoadingSteps([]);
    }
  }, [currentView]);

  const startScan = async () => {
    const input = urlInput.trim();
    if (!input) {
      setError('Please enter a website URL to scan.');
      return;
    }

    let url = input;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      new URL(url);
    } catch {
      setError('Please enter a valid URL (e.g. https://yourfirm.com)');
      return;
    }

    setError('');
    setLoadingUrl(url);
    setCurrentView('loading');

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const result = await response.json();
      setTimeout(() => {
        setScanResult(result);
        setCurrentView('results');
      }, 500);

    } catch (err: any) {
      console.error('Scan error:', err);
      setCurrentView('input');
      setError('Unable to scan this site. Please check the URL and try again.');
    }
  };

  const resetScanner = () => {
    setCurrentView('input');
    setScanResult(null);
    setUrlInput('');
    setError('');
    setLoadingUrl('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startScan();
  };

  return (
    <>
      <div className="deco-orbs">
        <div className="deco-orb"></div>
        <div className="deco-orb"></div>
        <div className="deco-orb"></div>
      </div>

      <header>
        <a className="logo" href="https://lawfirmaudits.com" style={{textDecoration:'none',color:'inherit'}}>
          <div className="logo-mark"></div>
          <div className="logo-text">AI Readiness Grader</div>
        </a>
        <a href="https://lawfirmaudits.com" className="header-tag" style={{textDecoration:'none',color:'inherit'}}>LawFirmAudits.com</a>
      </header>

      {/* INPUT VIEW */}
      {currentView === 'input' && (
        <div id="inputSection">
          <div className="hero">
            <div className="hero-eyebrow">AI Readiness for Law Firms</div>
            <h1>Is your firm<br /><em>invisible</em> to AI?</h1>
            <p className="hero-sub">ChatGPT, Perplexity, and Google AI Overviews are answering legal questions right now. Find out if they&apos;re recommending your firm — or your competitor.</p>
          </div>

          <div className="input-card">
            <div className="input-row">
              <div className="url-input-wrap">
                <label className="url-label" htmlFor="urlInput">Law Firm Website URL</label>
                <input
                  type="url"
                  id="urlInput"
                  className="url-input"
                  placeholder="https://yourfirm.com"
                  autoComplete="off"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
              <button className="scan-btn" onClick={startScan}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                Scan My Site
              </button>
            </div>
            {error && <div className="error-msg visible">{error}</div>}
          </div>

          <div className="section-line delay-1" style={{ marginTop: '80px' }}></div>

          {/* WHY IT MATTERS */}
          <div className="why-section">
            <div className="why-header">
              <h2 className="why-title">AI is the new front door for legal clients.</h2>
              <p className="why-sub">When someone asks ChatGPT for a personal injury lawyer in your city, will your firm show up? Or will AI recommend your competitor instead?</p>
            </div>

            <div className="why-stats">
              <div className="why-stat">
                <div className="why-stat-num">40%</div>
                <div className="why-stat-label">of consumers now use AI tools to research services before choosing a provider</div>
              </div>
              <div className="why-stat">
                <div className="why-stat-num">0</div>
                <div className="why-stat-label">law firms in 100 have an llms.txt file telling AI how to represent them</div>
              </div>
              <div className="why-stat">
                <div className="why-stat-num">60s</div>
                <div className="why-stat-label">is all it takes to find out where your firm stands with AI discovery</div>
              </div>
            </div>

            <div className="why-cta">
              <div className="why-cta-title">Find out if AI can find you.</div>
              <p className="why-cta-text">Free scan. No login required. Results in 60 seconds &uarr;</p>
            </div>
          </div>
        </div>
      )}

      {/* LOADING VIEW */}
      {currentView === 'loading' && (
        <div className="loading-state active">
          <div className="loading-ring"></div>
          <div className="loading-title">Scanning Your Site</div>
          <div className="loading-sub">{loadingUrl}</div>
          <div className="loading-steps">
            {[
              'Checking robots.txt for AI policies',
              'Fetching sitemap and page structure',
              'Analyzing content clarity for AI',
              'Evaluating structured data & schema',
              'Testing advanced AI signals',
              'Calculating your AI readiness score'
            ].map((step, index) => (
              <div
                key={index}
                className={`loading-step ${loadingSteps.includes(index) ? 'visible' : ''} ${loadingSteps.includes(index + 1) ? 'done' : ''}`}
              >
                <div className="step-dot"></div>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESULTS VIEW */}
      {currentView === 'results' && scanResult && (
        <ResultsSection result={scanResult} onReset={resetScanner} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// RESULTS COMPONENT
// ═══════════════════════════════════════════════════════════
function ResultsSection({ result, onReset }: { result: ScanResult; onReset: () => void }) {
  const overall = result.overallScore;
  const scoreClass = getScoreClass(overall);

  const categoryOrder: (keyof typeof result.categories)[] = [
    'discoverability', 'contentClarity', 'structuredData', 'technicalAccessibility', 'advancedSignals'
  ];

  const categoryWeights: Record<string, string> = {
    discoverability: '30',
    contentClarity: '25',
    structuredData: '25',
    technicalAccessibility: '10',
    advancedSignals: '10',
  };

  // Find top strength and critical gap
  const allChecks = categoryOrder.flatMap(key => result.categories[key].checks);
  const passedChecks = allChecks.filter(c => c.passed);
  const failedChecks = allChecks.filter(c => !c.passed).sort((a, b) => b.maxPoints - a.maxPoints);
  const topStrength = passedChecks.length > 0
    ? passedChecks.sort((a, b) => b.maxPoints - a.maxPoints)[0]
    : null;
  const criticalGap = failedChecks.length > 0 ? failedChecks[0] : null;

  // Build verdict
  let verdict = '';
  if (overall >= 75) {
    verdict = `Your firm is well-positioned for AI discovery. ${result.passedChecks} of ${result.totalChecks} checks passed — you're ahead of most law firms. Focus on the remaining gaps to reach elite status.`;
  } else if (overall >= 50) {
    verdict = `Your firm has a foundation but significant gaps remain. AI can find you, but it can't fully understand or confidently recommend you. ${result.totalChecks - result.passedChecks} checks need attention.`;
  } else {
    verdict = `AI systems are largely unable to find, understand, or recommend your firm. ${result.totalChecks - result.passedChecks} of ${result.totalChecks} checks failed — your competitors are likely getting the referrals that should be yours.`;
  }

  useEffect(() => {
    requestAnimationFrame(() => {
      const ringFill = document.getElementById('ringFill');
      if (ringFill) {
        const circ = 2 * Math.PI * 90;
        const offset = circ - (overall / 100) * circ;
        ringFill.style.strokeDashoffset = offset.toString();
      }

      document.querySelectorAll<HTMLElement>('.category-bar-fill').forEach(el => {
        const width = el.getAttribute('data-width');
        if (width) el.style.width = width + '%';
      });
    });
  }, [overall]);

  return (
    <div className="results-section active">
      {/* SCORE HERO */}
      <div className="score-hero">
        <div>
          <div className="score-firm-name">{result.domain}</div>
          <div className="score-headline">AI Readiness<br />Score</div>
          <div className="score-verdict">{verdict}</div>
          <div className="scan-meta">
            <span>{result.pagesScanned} page{result.pagesScanned !== 1 ? 's' : ''} scanned</span>
            <span>{result.passedChecks}/{result.totalChecks} checks passed</span>
            <span>{(result.scanDurationMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
        <div className="score-ring-wrap">
          <div className="score-ring">
            <svg viewBox="0 0 200 200">
              <circle className="score-ring-bg" cx="100" cy="100" r="90" />
              <circle
                className={`score-ring-fill ring-${scoreClass}`}
                id="ringFill"
                cx="100"
                cy="100"
                r="90"
              />
            </svg>
            <div className="score-ring-text">
              <div className="score-number">{overall}</div>
              <div className="score-denom">out of 100</div>
            </div>
          </div>
          <div className={`score-grade-badge grade-${scoreClass}`}>{result.grade} — {result.gradeLabel}</div>
        </div>
      </div>

      {/* STRENGTH + GAP */}
      <div className="summary-grid">
        <div className="summary-card" style={{ border: '1px solid rgba(45, 122, 82, 0.15)' }}>
          <div className="summary-card-label" style={{ color: 'var(--green)' }}>Top Strength</div>
          <div className="summary-card-value">{topStrength?.name || 'N/A'}</div>
          <div className="summary-card-sub">{topStrength?.detail || ''}</div>
        </div>
        <div className="summary-card" style={{ border: '1px solid rgba(197, 48, 48, 0.15)' }}>
          <div className="summary-card-label" style={{ color: 'var(--red)' }}>Biggest Gap</div>
          <div className="summary-card-value">{criticalGap?.name || 'N/A'}</div>
          <div className="summary-card-sub">{criticalGap?.detail || ''}</div>
        </div>
      </div>

      {/* CATEGORY BREAKDOWN */}
      <div className="categories-label">Score Breakdown · 5 Categories · {result.totalChecks} Checks</div>

      {categoryOrder.map((key) => {
        const cat = result.categories[key];
        const pct = cat.percentage;
        const cls = getScoreClass(pct);

        return (
          <div key={key} className="category-block">
            <div className="category-header">
              <div className="category-name">{cat.name}</div>
              <div className={`category-score-pill pill-${cls}`}>
                {cat.score}/{cat.maxPoints} pts ({pct}%)
              </div>
            </div>
            <div className="category-bar-track">
              <div className={`category-bar-fill bg-${cls}`} data-width={pct}></div>
            </div>
            <div className="checks-grid">
              {cat.checks.map((check, i) => {
                const status = getCheckStatus(check);
                return (
                  <div key={i} className={`check-card check-${status}`}>
                    <div className="check-top">
                      <div className="check-name">{check.name}</div>
                      <div className={`check-status status-${status}`}>
                        {getCheckStatusLabel(check)} {check.score}/{check.maxPoints}
                      </div>
                    </div>
                    <div className="check-detail">{check.detail}</div>
                    <div className="check-tech">{check.techDetail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="section-divider"></div>

      {/* CTA */}
      <div className="cta-section">
        <div className="cta-eyebrow">Want to fix these gaps?</div>
        <div className="cta-title">Turn your score into<br /><em style={{ fontStyle: 'italic' }}>an action plan.</em></div>
        <div className="cta-sub">
          Your AI Readiness Score shows where you stand. Rankings.io can help you fix every gap — from structured data to llms.txt — so AI starts recommending your firm.
        </div>
        <div className="cta-buttons">
          <a
            href={`mailto:scottknudson@rankings.io?subject=AI Readiness Audit — ${encodeURIComponent(result.domain)}&body=I just ran my AI Readiness Score on ${encodeURIComponent(result.url)} and scored ${overall}/100 (${result.grade}). I'd like help improving my firm's AI visibility.`}
            className="cta-btn-primary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.03 1.16 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92v2z" />
            </svg>
            Get Help Fixing These
          </a>
          <button className="cta-btn-secondary" onClick={onReset}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
            </svg>
            Scan Another Firm
          </button>
        </div>
      </div>

      {/* SCORE AGAIN */}
      <div className="score-again">
        <button className="score-again-btn" onClick={onReset}>&larr; Scan Another Firm</button>
      </div>
    </div>
  );
}
