'use client';
// app/import/ImportClient.tsx
// Tailored for the Chaudhary Farm customer list format:
// Columns: SR NO, DATE, NAME, ADDRESS, CITY, STATE, ZIP, PHONE NO

import { useState, useRef } from 'react';
import { LoadingLink as Link, useLoadingAction } from '@/components/ui/GlobalLoading';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Check } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { titleCase } from '@/lib/utils';

interface ParsedRow {
  full_name: string;
  phone_number: string | null;
  street: string | null;
  city: string | null;
  zip_code: string | null;
}

interface ImportResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

function normalizePhone(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return s || null;
}

function parseAndClean(file: File): Promise<{ rows: ParsedRow[]; skipped: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target?.result, { type: 'binary', cellText: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        const seenPhone = new Set<string>();
        const seenName  = new Set<string>();
        const rows: ParsedRow[] = [];
        let skipped = 0;

        for (const r of raw) {
          // Handle both this specific format and generic formats
          const name = titleCase(
            r['NAME '] || r['NAME'] || r['name'] ||
            r['full_name'] || r['FULL_NAME'] || ''
          );
          const rawPhone = String(
            r['PHONE NO '] || r['PHONE NO'] || r['PHONE'] ||
            r['phone'] || r['phone_number'] || ''
          ).replace(/\D/g, '');
          const phone = normalizePhone(
            r['PHONE NO '] || r['PHONE NO'] || r['PHONE'] ||
            r['phone'] || r['phone_number'] || ''
          );

          if (!name)                              { skipped++; continue; }
          if (rawPhone && seenPhone.has(rawPhone)){ skipped++; continue; }
          if (seenName.has(name.toLowerCase()))   { skipped++; continue; }

          if (rawPhone) seenPhone.add(rawPhone);
          seenName.add(name.toLowerCase());

          rows.push({
            full_name:    name,
            phone_number: phone,
            street:       titleCase(r['ADDRESS '] || r['ADDRESS'] || r['street'] || r['STREET'] || '') || null,
            city:         titleCase(r['CITY ']    || r['CITY']    || r['city']   || '') || null,
            zip_code:     String(r['ZIP '] || r['ZIP'] || r['zip_code'] || r['ZIP_CODE'] || '').trim() || null,
          });
        }

        resolve({ rows, skipped });
      } catch {
        reject(new Error('Could not read file. Make sure it is a valid .xlsx or .csv file.'));
      }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsBinaryString(file);
  });
}

type Step = 'idle' | 'parsing' | 'preview' | 'importing' | 'done';

export default function ImportClient() {
  const withLoading = useLoadingAction();
  const [step,       setStep]       = useState<Step>('idle');
  const [rows,       setRows]       = useState<ParsedRow[]>([]);
  const [skipped,    setSkipped]    = useState(0);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [error,      setError]      = useState('');
  const [dragging,   setDragging]   = useState(false);
  const [fileName,   setFileName]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError('');
    setFileName(file.name);
    setStep('parsing');
    try {
      const { rows: parsed, skipped: sk } = await parseAndClean(file);
      setRows(parsed);
      setSkipped(sk);
      setStep('preview');
    } catch (err: any) {
      setError(err.message);
      setStep('idle');
    }
  }

  async function runImport() {
    setStep('importing');
    setError('');
    await withLoading(async () => {
      try {
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customers: rows }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? 'Import failed');
        setResult(d);
        setStep('done');
      } catch (err: any) {
        setError(err.message);
        setStep('preview');
      }
    });
  }

  // ── IDLE: drop zone ──────────────────────────────────────────
  if (step === 'idle') return (
    <div style={{ maxWidth: 620 }}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e  => { e.preventDefault(); setDragging(true); }}
        onDragLeave={()  => setDragging(false)}
        onDrop={e        => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        style={{
          border: `2px dashed ${dragging ? 'var(--red)' : 'var(--border)'}`,
          borderRadius: 16, padding: '56px 40px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? 'var(--red-light)' : 'white',
          transition: 'all 150ms',
        }}
      >
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: 'var(--ink-2)' }}>
          <FileSpreadsheet size={24} strokeWidth={1.6} />
        </div>
        <p className="font-display" style={{ fontSize: 22, marginBottom: 6 }}>
          Drop your Excel file here
        </p>
        <p style={{ fontSize: 13.5, color: 'var(--ink-muted)', marginBottom: 22, lineHeight: 1.55 }}>
          Supports .xlsx and .csv · Columns: NAME, ADDRESS, CITY, ZIP, PHONE NO
        </p>
        <span className="btn-secondary" style={{ pointerEvents: 'none' }}>Browse file</span>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10, background: 'var(--red-light)', color: 'var(--red-dark)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* What it does */}
      <div className="card" style={{ marginTop: 20 }}>
        <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>What this tool does</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            'Reads NAME, ADDRESS, CITY, ZIP, PHONE NO columns automatically',
            'Converts names and addresses to proper Title Case',
            'Normalizes phone numbers to (XXX) XXX-XXXX format',
            'Removes duplicate entries (same phone or same name)',
            'Skips customers already in the database',
            'Assigns customer numbers like CUST-0001, CUST-0002…',
          ].map((text) => (
            <div key={text} style={{ display: 'flex', gap: 10, fontSize: 13.5, alignItems: 'flex-start' }}>
              <Check size={14} strokeWidth={2.2} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ color: 'var(--ink-2)' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── PARSING ──────────────────────────────────────────────────
  if (step === 'parsing') return (
    <div className="card" style={{ maxWidth: 400, textAlign: 'center', padding: '56px 40px' }}>
      <Spinner size={36} />
      <p style={{ fontWeight: 700, fontSize: 17, marginTop: 20, marginBottom: 6 }}>Reading file…</p>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{fileName}</p>
    </div>
  );

  // ── PREVIEW ──────────────────────────────────────────────────
  if (step === 'preview') return (
    <div style={{ maxWidth: 820 }}>
      {/* Summary bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.015em' }}>
              Ready to import {rows.length.toLocaleString()} customers
            </p>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              {skipped > 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  ✓ {skipped} duplicate{skipped !== 1 ? 's' : ''} removed from file
                </span>
              )}
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                📁 {fileName}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setStep('idle'); setRows([]); setError(''); }} className="btn-secondary">
              ← Start Over
            </button>
            <button onClick={runImport} className="btn-primary" style={{ padding: '10px 24px' }}>
              Import {rows.length.toLocaleString()} Customers →
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10, background: 'var(--red-light)', color: 'var(--red-dark)', fontSize: 14 }}>
            {error}
          </div>
        )}
      </div>

      {/* Preview table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
          Preview (first 25 of {rows.length.toLocaleString()})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Street</th>
                <th>City</th>
                <th>ZIP</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 25).map((r, i) => (
                <tr key={i} style={{ cursor: 'default' }}>
                  <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                  <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>{r.phone_number || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.street || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.city || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.zip_code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 25 && (
          <div style={{ padding: '10px 20px', background: 'var(--warm-gray)', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            + {(rows.length - 25).toLocaleString()} more customers not shown
          </div>
        )}
      </div>
    </div>
  );

  // ── IMPORTING ────────────────────────────────────────────────
  if (step === 'importing') return (
    <div className="card" style={{ maxWidth: 420, textAlign: 'center', padding: '60px 40px' }}>
      <Spinner size={40} />
      <p style={{ fontWeight: 700, fontSize: 18, marginTop: 24, marginBottom: 8, letterSpacing: '-0.015em' }}>
        Importing customers…
      </p>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Adding {rows.length.toLocaleString()} customers to the database.<br />
        This may take a minute. Please don&apos;t close this page.
      </p>
    </div>
  );

  // ── DONE ─────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 500 }}>
      <div className="card">
        <div style={{ textAlign: 'center', padding: '16px 0 28px' }}>
          <div style={{ fontSize: 56, marginBottom: 14, lineHeight: 1 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.02em' }}>
            Import Complete!
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Your customers are now in the system and ready to use.
          </p>
        </div>

        {/* Results */}
        <div className="dual-grid" style={{ marginBottom: 24 }}>
          <div style={{ textAlign: 'center', padding: '20px', background: 'var(--success-bg)', borderRadius: 12 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--success)', letterSpacing: '-0.02em', lineHeight: 1 }}>
              {(result?.inserted ?? 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 6 }}>
              Customers Imported
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: '20px', background: 'var(--warm-gray)', borderRadius: 12 }}>
            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
              {(result?.skipped ?? 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 6 }}>
              Already Existed
            </div>
          </div>
        </div>

        {result?.errors && result.errors.length > 0 && (
          <div style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--red-light)', borderRadius: 10, fontSize: 13, color: 'var(--red-dark)' }}>
            <strong>{result.errors.length} batch error{result.errors.length !== 1 ? 's' : ''}:</strong>
            <ul style={{ marginTop: 6, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <Link href="/customers" className="btn-primary" style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: '14px', fontSize: 15 }}>
          View All {(result?.inserted ?? 0).toLocaleString()} Customers →
        </Link>
      </div>
    </div>
  );
}
