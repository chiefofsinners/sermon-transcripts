"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import Link from "next/link";
import DatePicker from "@/components/DatePicker";
import ComboBox from "@/components/ComboBox";
import { validateBibleText } from "@/lib/bible";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Filters {
  preachers: string[];
  series: string[];
  eventTypes: string[];
  keywords: string[];
}

interface PendingJob {
  sermonId: string;
  operationName?: string;
  type?: "whisper" | "speech";
  gcsAudioPath: string;
  metadata: Record<string, string>;
  submittedAt: string;
  status?: "processing" | "completed" | "error";
}

type Stage = "checking" | "auth" | "form" | "uploading";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function UploadPage() {
  // ---- state ----
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState(""); // only used during login form
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  // ---- form fields ----
  const [title, setTitle] = useState("");
  const [preacher, setPreacher] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
    d.setDate(d.getDate() - (day === 0 ? 0 : day));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [bibleText, setBibleText] = useState("");
  const [bibleTextErrors, setBibleTextErrors] = useState<string[]>([]);
  const [amPm, setAmPm] = useState<"AM" | "PM">("AM");
  const [summary, setSummary] = useState("");
  const [series, setSeries] = useState("");
  const [eventType, setEventType] = useState("Sunday Service");
  const [keywords, setKeywords] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- pending jobs ----
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [checkingJobs, setCheckingJobs] = useState<Record<string, boolean>>({});
  const [jobResults, setJobResults] = useState<
    Record<string, { done: boolean; progressPercent?: number; error?: string }>
  >({});
  const [completedSermons, setCompletedSermons] = useState<
    Record<string, { sermonId: string; title: string; transcript: string; committed: boolean; commitError?: string }>
  >({});

  // ---- check existing cookie on mount ----
  useEffect(() => {
    fetch("/api/upload/auth")
      .then((r) => setStage(r.ok ? "form" : "auth"))
      .catch(() => setStage("auth"));
  }, []);

  // ---- load filter suggestions ----
  useEffect(() => {
    fetch("/filters.json")
      .then((r) => r.json())
      .then((d: Filters) => setFilters(d))
      .catch(() => {});
  }, []);

  // ---- load pending jobs ----
  const loadPendingJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/upload/status");
      if (res.ok) {
        const data = await res.json();
        setPendingJobs(data.jobs || []);
      }
    } catch {
      // Silently fail — will retry when user clicks check
    }
  }, []);

  // Load pending jobs after auth
  useEffect(() => {
    if (stage !== "auth" && stage !== "checking") {
      loadPendingJobs();
    }
  }, [stage, loadPendingJobs]);

  // Auto-check any pending jobs that don't have a result yet
  useEffect(() => {
    const unchecked = pendingJobs.filter(
      (job) => !jobResults[job.sermonId] && !checkingJobs[job.sermonId],
    );
    if (unchecked.length === 0) return;
    (async () => {
      for (const job of unchecked) {
        await checkJob(job);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJobs]);

  // Poll in-progress jobs every 5 seconds
  useEffect(() => {
    const inProgress = pendingJobs.filter((job) => {
      const result = jobResults[job.sermonId];
      return !result || (!result.done && !result.error);
    });
    if (inProgress.length === 0) return;

    const interval = setInterval(async () => {
      for (const job of inProgress) {
        if (!checkingJobs[job.sermonId]) {
          await checkJob(job);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJobs, jobResults]);

  // ---- helpers ----
  function resetForm() {
    setTitle("");
    setPreacher("");
    setDate("");
    setBibleText("");
    setBibleTextErrors([]);
    setAmPm("AM");
    setSummary("");
    setSeries("");
    setEventType("Sunday Service");
    setKeywords("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---- auth ----
  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/upload/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        setStage("form");
      } else if (res.status === 429) {
        const data = await res.json();
        setError(data.error ?? "Too many attempts. Please try again later.");
      } else {
        setError("Invalid password");
      }
    } catch {
      setError("Network error");
    }
  }

  // ---- sign out ----
  async function handleSignOut() {
    try {
      await fetch("/api/upload/logout", { method: "POST" });
    } catch {
      // Best effort
    }
    setStage("auth");
    setPassword("");
    setError("");
    setPendingJobs([]);
    setJobResults({});
    setCompletedSermons({});
    setSuccessMessage("");
  }

  // ---- upload ----
  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    const missing: string[] = [];
    if (!file) missing.push("MP3 file");
    if (!title.trim()) missing.push("Title");
    if (!preacher.trim()) missing.push("Preacher");
    if (!date) missing.push("Date");
    if (missing.length > 0) {
      setError(`Required: ${missing.join(", ")}`);
      return;
    }

    const { errors: btErrors } = validateBibleText(bibleText);
    if (btErrors.length > 0) {
      setBibleTextErrors(btErrors);
      setError("Please fix the Bible text errors before uploading");
      return;
    }

    setError("");
    setStage("uploading");
    setSuccessMessage("");

    const metadata = {
      title,
      preacher,
      date,
      bibleText,
      amPm,
      summary,
      series,
      eventType,
      keywords,
    };

    try {
      // Step 1: Get a signed URL for direct-to-GCS upload
      setUploadProgress("Preparing upload…");
      const urlRes = await fetch("/api/upload/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, amPm, eventType }),
      });
      if (!urlRes.ok) {
        const data = await urlRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get upload URL");
      }
      const { sermonId, signedUrl, gcsAudioPath } = await urlRes.json();

      // Step 2: Upload the file directly to GCS (bypasses Vercel body limit)
      setUploadProgress("Uploading MP3…");
      const gcsRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: file,
      });
      if (!gcsRes.ok) {
        throw new Error(`File upload failed (${gcsRes.status})`);
      }

      // Step 3: Start async transcription (returns immediately)
      setUploadProgress("Starting transcription…");
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId, gcsAudioPath, metadata }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start transcription");
      }
      const result = await res.json();

      // Add the job to pending list immediately for instant feedback
      if (result.job) {
        setPendingJobs((prev) => [result.job, ...prev]);
      }

      resetForm();
      setSuccessMessage(`"${title}" submitted — transcription is running in the background.`);
      setStage("form");

      // Refresh pending jobs from GCS for consistency
      loadPendingJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStage("form");
    }
  }

  // ---- check a single pending job ----
  async function checkJob(job: PendingJob) {
    setCheckingJobs((prev) => ({ ...prev, [job.sermonId]: true }));

    try {
      const res = await fetch("/api/upload/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sermonId: job.sermonId,
          operationName: job.operationName,
          gcsAudioPath: job.gcsAudioPath,
          metadata: job.metadata,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setJobResults((prev) => ({
          ...prev,
          [job.sermonId]: { done: false, error: data.error || "Check failed" },
        }));
      } else if (data.done) {
        setJobResults((prev) => ({ ...prev, [job.sermonId]: { done: true } }));
        setCompletedSermons((prev) => ({
          ...prev,
          [job.sermonId]: {
            sermonId: data.sermonId,
            title: data.sermonData?.title || job.metadata.title || "Untitled",
            transcript: data.sermonData?.transcript || "",
            committed: data.committed ?? false,
            commitError: data.commitError,
          },
        }));
        await loadPendingJobs();
      } else {
        setJobResults((prev) => ({
          ...prev,
          [job.sermonId]: {
            done: false,
            progressPercent: data.progressPercent,
          },
        }));
      }
    } catch {
      setJobResults((prev) => ({
        ...prev,
        [job.sermonId]: { done: false, error: "Network error" },
      }));
    }

    setCheckingJobs((prev) => ({ ...prev, [job.sermonId]: false }));
  }

  // ---- delete a pending job ----
  async function deleteJob(job: PendingJob) {
    try {
      await fetch("/api/upload/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          sermonId: job.sermonId,
          gcsAudioPath: job.gcsAudioPath,
        }),
      });
      await loadPendingJobs();
      setJobResults((prev) => {
        const next = { ...prev };
        delete next[job.sermonId];
        return next;
      });
    } catch {
      // Best effort
    }
  }

  // ---- render ----
  const inputClass =
    "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 text-sm";

  const labelClass =
    "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  const btnPrimary =
    "w-full rounded-lg bg-gray-500 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-500 text-white dark:text-gray-100 font-medium py-2.5 px-4 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-950 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

  const cardClass =
    "rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-sm";

  // Pending jobs panel (extracted so we can place it in the right column)
  const pendingJobsPanel = stage !== "auth" && stage !== "checking" && (
    <div className={`${cardClass} space-y-4`}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Pending Transcriptions
      </h2>

      {pendingJobs.length === 0 &&
        Object.keys(completedSermons).length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No pending transcriptions.
          </p>
        )}

      {/* Completed sermons (this session) */}
      {Object.entries(completedSermons).map(([id, sermon]) => (
        <div
          key={id}
          className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 space-y-2"
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
            <span className="text-sm font-medium text-green-800 dark:text-green-300">
              {sermon.title} — complete
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3">
            {sermon.transcript.substring(0, 200)}…
          </p>
          {sermon.committed ? (
            <p className="text-xs text-green-600 dark:text-green-400">
              Committed to GitHub — site will rebuild automatically.
            </p>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {sermon.commitError
                ? `GitHub commit failed: ${sermon.commitError}`
                : "Sermon data ready but not committed to GitHub. Check GITHUB_TOKEN is configured."}
            </p>
          )}
        </div>
      ))}

      {/* Pending jobs */}
      {pendingJobs.map((job) => {
        const result = jobResults[job.sermonId];
        const isWhisper = job.type === "whisper";
        const isProcessing = !result || (!result.done && !result.error);
        return (
          <div
            key={job.sermonId}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {job.metadata.title || job.sermonId}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {new Date(job.submittedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {job.metadata.preacher}
              {job.metadata.date ? ` · ${job.metadata.date}` : ""}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div>
                {result ? (
                  <>
                    {result.error ? (
                      <span className="text-xs text-red-500">
                        {result.error}
                      </span>
                    ) : result.done ? (
                      <span className="text-xs text-green-600 dark:text-green-400">
                        Complete
                      </span>
                    ) : isWhisper ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Transcribing…
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        In progress
                        {result.progressPercent
                          ? ` (${result.progressPercent}%)`
                          : "…"}
                      </span>
                    )}
                  </>
                ) : isWhisper ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Transcribing…
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {/* Show Check button only for non-Whisper (Speech) jobs */}
                {!isWhisper && (
                  <button
                    onClick={() => checkJob(job)}
                    disabled={checkingJobs[job.sermonId]}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                    title="Check status"
                  >
                    {checkingJobs[job.sermonId] ? "Checking…" : "Check"}
                  </button>
                )}
                {isProcessing ? (
                  <button
                    onClick={() => deleteJob(job)}
                    className="rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-medium py-1 px-2.5 transition-colors"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={() => deleteJob(job)}
                    className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                    title="Remove"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {/* Indeterminate bar for Whisper jobs */}
            {isWhisper && isProcessing && (
              <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div className="bg-amber-500 dark:bg-amber-400 h-2 rounded-full w-1/3 animate-[indeterminate_1.5s_ease-in-out_infinite]" />
              </div>
            )}
            {/* Progress bar for Speech jobs */}
            {!isWhisper && result && !result.done && !result.error && (
              <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 dark:bg-amber-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${result.progressPercent || 0}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-gray-950 px-4 py-6 sm:py-12">
      {/* Header */}
      <div className="mb-6 max-w-5xl mx-auto">
        {/* Desktop header */}
        <div className="hidden sm:flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
          >
            &larr; Back to search
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Upload Sermon
          </h1>
          {stage !== "auth" && stage !== "checking" ? (
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 px-3 py-1.5 transition-colors cursor-pointer"
            >
              Sign out
            </button>
          ) : (
            <div className="w-19" />
          )}
        </div>
        {/* Mobile header */}
        <div className="flex sm:hidden items-center justify-between">
          <div className="w-9" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Upload Sermon
          </h1>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              aria-label="Menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
                  <Link
                    href="/"
                    className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => setMenuOpen(false)}
                  >
                    Back to search
                  </Link>
                  {stage !== "auth" && stage !== "checking" && (
                    <button
                      onClick={() => { setMenuOpen(false); handleSignOut(); }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      Sign out
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 text-center hidden sm:block">
          Upload an MP3 to transcribe and add to the archive
        </p>
      </div>

      {/* ---- Checking cookie ---- */}
      {stage === "checking" && (
        <div className="flex justify-center pt-8">
          <Spinner />
        </div>
      )}

      {/* ---- Auth gate (centered) ---- */}
      {stage === "auth" && (
        <div className="flex justify-center">
          <form onSubmit={handleAuth} className={`${cardClass} space-y-4 w-full max-w-lg`}>
            <div>
              <label htmlFor="password" className={labelClass}>
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter upload password"
                className={inputClass}
                required
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <button type="submit" className={btnPrimary}>
              Continue
            </button>
          </form>
        </div>
      )}

      {/* ---- Two-column layout (post-auth) ---- */}
      {stage !== "auth" && stage !== "checking" && (
        <div className="mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column: form / uploading / submitted */}
          <div className="space-y-6">

        {/* ---- Upload form ---- */}
        {stage === "form" && (
          <>
          {successMessage && (
            <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 flex items-start gap-3">
              <svg
                className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  {successMessage}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  You can track progress in the panel on the right.
                </p>
              </div>
              <button
                onClick={() => setSuccessMessage("")}
                className="text-green-400 hover:text-green-600 dark:hover:text-green-300 shrink-0"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          <form onSubmit={handleUpload} className={`${cardClass} space-y-5`}>
            {/* MP3 file */}
            <div>
              <label htmlFor="mp3" className={labelClass}>
                MP3 File<span className="text-red-500"> *</span>
              </label>
              <input
                id="mp3"
                ref={fileRef}
                type="file"
                accept=".mp3,audio/mpeg"
                className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-200 file:text-gray-700 dark:file:bg-gray-800 dark:file:text-gray-300 hover:file:bg-gray-300 dark:hover:file:bg-gray-700 file:cursor-pointer file:transition-colors"
              />
            </div>

            {/* Title */}
            <div>
              <label htmlFor="title" className={labelClass}>
                Title<span className="text-red-500"> *</span>
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The Parable of the Sower"
                className={inputClass}
              />
            </div>

            {/* Preacher */}
            <div>
              <label htmlFor="preacher" className={labelClass}>
                Preacher<span className="text-red-500"> *</span>
              </label>
              <ComboBox
                id="preacher"
                value={preacher}
                onChange={setPreacher}
                options={filters?.preachers ?? []}
                placeholder="e.g. Rev Dr Peter Naylor"
                className={inputClass}
              />
            </div>

            {/* Date + AM/PM row */}
            <div className={`grid ${eventType !== "Sunday Service" ? "grid-cols-1" : "grid-cols-[1fr_auto]"} gap-3 items-end`}>
              <div>
                <span className={labelClass}>
                  Date<span className="text-red-500"> *</span>
                </span>
                <>
                  {/* Mobile Version: Has shortDisplay, hidden on sm screens */}
                  <div className="sm:hidden">
                    <DatePicker
                      value={date}
                      onChange={setDate}
                      placeholder="Pick date"
                      ariaLabel="Sermon date"
                      shortDisplay
                      className="inline-flex items-center gap-2 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 cursor-pointer"
                    />
                  </div>

                  {/* Desktop Version: No shortDisplay, hidden on mobile */}
                  <div className="hidden sm:block">
                    <DatePicker
                      value={date}
                      onChange={setDate}
                      placeholder="Pick date"
                      ariaLabel="Sermon date"
                      className="inline-flex items-center gap-2 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 cursor-pointer"
                    />
                  </div>
                </>
              </div>
              {eventType === "Sunday Service" && (
              <div>
                <span className={labelClass}>Service</span>
                <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden mt-0.5">
                  <button
                    type="button"
                    onClick={() => setAmPm("AM")}
                    className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                      amPm === "AM"
                        ? "bg-gray-500 text-white dark:bg-gray-600 dark:text-gray-100"
                        : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmPm("PM")}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 dark:border-gray-700 cursor-pointer ${
                      amPm === "PM"
                        ? "bg-gray-500 text-white dark:bg-gray-600 dark:text-gray-100"
                        : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
              )}
            </div>

            {/* Bible text */}
            <div>
              <label htmlFor="bibleText" className={labelClass}>
                Bible Text
              </label>
              <input
                id="bibleText"
                type="text"
                value={bibleText}
                onChange={(e) => {
                  const val = e.target.value;
                  setBibleText(val);
                  const { errors } = validateBibleText(val);
                  setBibleTextErrors(errors);
                }}
                placeholder="e.g. Matthew 13:1-23"
                className={inputClass}
              />
              {bibleTextErrors.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {bibleTextErrors.map((err) => (
                    <li key={err} className="text-xs text-red-600 dark:text-red-400">{err}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Formats: <span className="font-mono">John 3:16</span>, <span className="font-mono">Matthew 13:1-23</span>, <span className="font-mono">Ezra 1-3</span>, <span className="font-mono">Judges 6:33-7:25</span>. Separate multiple passages with <span className="font-mono">;</span>
                </p>
              )}
            </div>

            {/* Event type */}
            <div>
              <span className={labelClass}>Event Type</span>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
                {["Sunday Service", "Prayer Meeting", "Other"].map((opt, i) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setEventType(opt)}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                      i > 0 ? "border-l border-gray-300 dark:border-gray-700 " : ""
                    }${
                      eventType === opt
                        ? "bg-gray-500 text-white dark:bg-gray-600 dark:text-gray-100"
                        : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Series */}
            <div>
              <label htmlFor="series" className={labelClass}>
                Series
              </label>
              <input
                id="series"
                type="text"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                placeholder="e.g. Matthew"
                className={inputClass}
              />
            </div>

            {/* Summary */}
            <div>
              <label htmlFor="summary" className={labelClass}>
                Summary
              </label>
              <textarea
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief description of the sermon"
                rows={3}
                className={inputClass}
              />
            </div>

            {/* Keywords */}
            <div>
              <label htmlFor="keywords" className={labelClass}>
                Keywords
              </label>
              <input
                id="keywords"
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="Comma-separated keywords"
                className={inputClass}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <button type="submit" className={btnPrimary}>
              Upload &amp; Start Transcription
            </button>
          </form>
          </>
        )}

        {/* ---- Uploading ---- */}
        {stage === "uploading" && (
          <div className={`${cardClass} p-8 text-center space-y-4`}>
            <Spinner />
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              {uploadProgress || "Processing…"}
            </p>
          </div>
        )}

          </div>

          {/* Right column: pending jobs */}
          <div>{pendingJobsPanel}</div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <div className="flex justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 dark:border-gray-700 border-t-gray-800 dark:border-t-gray-200" />
    </div>
  );
}
