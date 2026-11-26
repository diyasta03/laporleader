import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import type { AppScriptConfigState } from '../types';

interface AppScriptPanelProps {
  token: string;
  onModeSwitchedToAppScript: () => void;
}

export function AppScriptPanel({ token, onModeSwitchedToAppScript }: AppScriptPanelProps) {
  const [config, setConfig] = useState<AppScriptConfigState | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [cfg, scriptRes] = await Promise.all([
          api.getAppScriptConfig(token),
          api.getAppScriptCode(token),
        ]);
        if (!active) return;
        setConfig(cfg);
        setUrlInput(cfg.url);
        setCode(scriptRes.code);
      } catch (err) {
        if (active) {
          setFeedback({
            type: 'err',
            text: err instanceof Error ? err.message : 'Gagal memuat konfigurasi Apps Script.',
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [token]);

  async function handleTestConnection() {
    setFeedback(null);
    setTesting(true);
    try {
      const res = await api.testAppScriptConnection(token, urlInput.trim());
      setFeedback({
        type: 'ok',
        text: `Terhubung ke Google Sheets "${res.spreadsheetName}". ${
          res.initialized
            ? 'Struktur sheet Branches, Users, dan Reports sudah siap.'
            : 'Sheet belum diinisialisasi — jalankan fungsi setupSpreadsheet() di editor Apps Script.'
        }`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Uji koneksi Apps Script gagal.',
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveMode(nextMode: 'local' | 'appscript') {
    setFeedback(null);
    setSaving(true);
    try {
      const updated = await api.saveAppScriptConfig(token, {
        mode: nextMode,
        url: urlInput.trim(),
      });
      setConfig(updated);
      if (updated.reloginRequired) {
        onModeSwitchedToAppScript();
        return;
      }
      setFeedback({
        type: 'ok',
        text:
          nextMode === 'local'
            ? 'Aplikasi beralih ke mode Server Lokal.'
            : 'Konfigurasi Google Apps Script berhasil disimpan.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedback({ type: 'err', text: 'Gagal menyalin kode ke clipboard.' });
    }
  }

  function handleDownloadCode() {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Code.gs';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 text-sm text-slate-500">
        Memuat konfigurasi Google Apps Script...
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Konfigurasi Koneksi Web App */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 sm:pb-5 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <Link2 className="w-4 h-4 text-teal-700 shrink-0" />
              <h2 className="text-base font-semibold">Koneksi Web App Google Apps Script</h2>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
              Hubungkan aplikasi ini dengan Google Sheets Anda melalui Google Apps Script Web App.
              Seluruh permintaan diproksi secara aman dari sisi server.
            </p>
          </div>

          <div className="sm:text-right text-xs text-slate-500 shrink-0">
            <div>Mode aktif</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">
              {config?.mode === 'appscript' ? 'Google Apps Script' : 'Server Lokal'}
            </div>
          </div>
        </div>

        {feedback && (
          <div
            role="status"
            className={`mt-4 sm:mt-5 flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="gas-url" className="block text-sm font-medium text-slate-700">
              URL Deployment Web App Google Apps Script
            </label>
            <input
              id="gas-url"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="mt-1.5 block w-full min-h-[44px] rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
              Hanya menerima endpoint resmi HTTPS dari{' '}
              <span className="font-mono text-slate-700 break-all">
                script.google.com/macros/s/.../exec
              </span>
              . Simpan permanen di variabel{' '}
              <span className="font-mono text-slate-700">APPS_SCRIPT_URL</span> di menu Secrets.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 sm:gap-3 pt-1">
            <button
              type="button"
              disabled={testing || !urlInput.trim()}
              onClick={handleTestConnection}
              className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? 'Menguji...' : 'Uji Koneksi'}</span>
            </button>

            <button
              type="button"
              disabled={saving || !urlInput.trim()}
              onClick={() => handleSaveMode('appscript')}
              className="w-full sm:w-auto min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {saving ? 'Memverifikasi...' : 'Aktifkan Mode Apps Script'}
            </button>

            {config?.mode === 'appscript' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveMode('local')}
                className="w-full sm:w-auto min-h-[42px] px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                Kembali ke Server Lokal
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Panduan 4 Langkah Pemasangan */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
        <h3 className="text-base font-semibold text-slate-900">
          Panduan Pemasangan di Google Sheets
        </h3>
        <ol className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 text-sm">
          <li className="border-t border-slate-200 pt-3">
            <p className="font-semibold text-slate-900">01. Buat Google Sheets</p>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Buat spreadsheet baru di Google Drive, lalu buka menu{' '}
              <strong className="font-medium text-slate-800">Ekstensi → Apps Script</strong>.
            </p>
          </li>
          <li className="border-t border-slate-200 pt-3">
            <p className="font-semibold text-slate-900">02. Tempel Kode Code.gs</p>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Salin seluruh kode <span className="font-mono">Code.gs</span> di bawah ini ke editor
              Apps Script, lalu simpan proyek.
            </p>
          </li>
          <li className="border-t border-slate-200 pt-3">
            <p className="font-semibold text-slate-900">03. Jalankan Setup</p>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Pilih fungsi <span className="font-mono">setupSpreadsheet</span> di toolbar lalu klik{' '}
              <strong className="font-medium text-slate-800">Run</strong> untuk membuat sheet
              Branches, Users, dan Reports otomatis.
            </p>
          </li>
          <li className="border-t border-slate-200 pt-3">
            <p className="font-semibold text-slate-900">04. Deploy Web App</p>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Klik <strong className="font-medium text-slate-800">Deploy → New deployment</strong>,
              pilih <strong className="font-medium text-slate-800">Web app</strong> (Execute as:
              Me, Access: Anyone), lalu tempel URL <span className="font-mono">/exec</span> di atas.
            </p>
          </li>
        </ol>
      </section>

      {/* Viewer Kode Code.gs */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileCode2 className="w-4 h-4 text-teal-700 shrink-0" />
            <span className="font-mono">appscript/Code.gs</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Tersalin' : 'Salin Kode'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadCode}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Unduh</span>
            </button>
          </div>
        </div>

        <pre className="p-4 sm:p-5 bg-slate-950 text-slate-200 text-xs font-mono leading-relaxed overflow-x-auto max-h-[420px] sm:max-h-[480px]">
          <code>{code}</code>
        </pre>
      </section>
    </div>
  );
}
