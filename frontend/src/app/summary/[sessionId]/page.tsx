'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { sessionApi, ApiError } from '@/lib/api';
import type { Session, EvaluationStatus } from '@/lib/types';
import { Button, Card, Spinner, Badge, Alert } from '@/components/ui';

export default function SummaryPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    const { session } = await sessionApi.get(sessionId);
    setSession(session);
    return session;
  }, [sessionId]);

  useEffect(() => {
    if (!user) return;
    load().catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to load summary')
    );
  }, [user, load]);

  // While evaluation is running in the background, poll until it settles.
  const evalStatus = session?.evaluation?.status;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (evalStatus !== 'in_progress') return;
    pollRef.current = setInterval(() => {
      load().catch(() => {});
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [evalStatus, load]);

  // Trigger (or re-trigger) evaluation for legacy/failed sessions.
  const handleEvaluate = async () => {
    setRetrying(true);
    try {
      await sessionApi.complete(sessionId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start evaluation');
    } finally {
      setRetrying(false);
    }
  };

  if (authLoading || (!session && !error)) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }
  if (error) return <Alert>{error}</Alert>;
  if (!session) return null;

  const answered = session.questions.filter((q) => q.answeredAt).length;
  const assists = session.questions.filter((q) => q.assistance.used).length;
  const evaluation = session.evaluation;
  const status: EvaluationStatus = evaluation?.status ?? 'not_started';
  const maxScore = evaluation?.maxScore ?? session.questions.length * 10;

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-600"
      >
        ← Back to dashboard
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Session Summary</h1>
          <p className="mt-1 text-sm capitalize text-slate-500">
            {session.topic.replace('-', ' ')} · {session.difficulty}
            {session.completedAt && ` · Completed ${new Date(session.completedAt).toLocaleString()}`}
          </p>
        </div>
        <Badge color={session.status === 'completed' ? 'green' : 'amber'}>
          {session.status === 'completed' ? 'Completed' : 'In progress'}
        </Badge>
      </div>

      {/* Overall score banner */}
      <ScoreBanner
        status={status}
        totalScore={evaluation?.totalScore ?? null}
        maxScore={maxScore}
        error={evaluation?.error}
        onEvaluate={handleEvaluate}
        retrying={retrying}
      />

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Questions" value={`${session.questions.length}`} />
        <Stat label="Answered" value={`${answered}/${session.questions.length}`} />
        <Stat label="AI assists used" value={`${assists}`} />
      </div>

      {/* Per-question breakdown */}
      <div className="space-y-4">
        {session.questions.map((q, i) => {
          const ev = q.evaluation;
          return (
            <Card key={q.order}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-slate-900">
                  <span className="text-slate-400">Q{i + 1}.</span> {q.prompt}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  {status === 'completed' && ev?.scored && (
                    <ScorePill score={ev.score ?? 0} />
                  )}
                  {status === 'in_progress' && (
                    <Spinner className="h-4 w-4 text-brand-500" />
                  )}
                  {q.assistance.used ? (
                    <Badge color="indigo">AI used</Badge>
                  ) : (
                    <Badge color="slate">No AI</Badge>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your answer</p>
                {q.userAnswer?.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{q.userAnswer}</p>
                ) : (
                  <p className="mt-1 text-sm italic text-slate-400">No answer submitted</p>
                )}
              </div>

              {status === 'completed' && ev?.scored && ev.feedback && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    AI feedback
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{ev.feedback}</p>
                </div>
              )}

              {q.assistance.used && q.assistance.content && (
                <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">
                    View AI hint that was given
                  </summary>
                  <div className="prose-ai mt-2">
                    <ReactMarkdown>{q.assistance.content}</ReactMarkdown>
                  </div>
                </details>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex justify-center gap-3 pt-2">
        <Link href="/dashboard">
          <Button>Start another session</Button>
        </Link>
      </div>
    </div>
  );
}

function ScoreBanner({
  status,
  totalScore,
  maxScore,
  error,
  onEvaluate,
  retrying,
}: {
  status: EvaluationStatus;
  totalScore: number | null;
  maxScore: number;
  error?: string;
  onEvaluate: () => void;
  retrying: boolean;
}) {
  if (status === 'completed') {
    const pct = maxScore > 0 ? Math.round(((totalScore ?? 0) / maxScore) * 100) : 0;
    return (
      <Card className="bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-brand-100">Total Score</p>
            <p className="mt-1 text-4xl font-bold">
              {totalScore} <span className="text-2xl font-medium text-brand-200">/ {maxScore}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">{pct}%</p>
            <p className="text-xs text-brand-100">AI evaluated</p>
          </div>
        </div>
      </Card>
    );
  }

  if (status === 'in_progress') {
    return (
      <Card className="border-brand-200 bg-brand-50">
        <div className="flex items-center gap-3">
          <Spinner className="h-6 w-6 text-brand-600" />
          <div>
            <p className="font-semibold text-slate-900">Evaluating your answers…</p>
            <p className="text-sm text-slate-500">
              The AI is scoring each answer in the background. This updates automatically — or refresh
              the page in a moment.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (status === 'failed') {
    return (
      <Card className="border-red-200 bg-red-50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-red-700">Evaluation failed</p>
            <p className="text-sm text-red-600">{error ?? 'Something went wrong while scoring.'}</p>
          </div>
          <Button variant="secondary" onClick={onEvaluate} loading={retrying}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  // not_started
  return (
    <Card className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold text-slate-900">Get an AI score</p>
        <p className="text-sm text-slate-500">Have the AI grade your answers out of {maxScore}.</p>
      </div>
      <Button onClick={onEvaluate} loading={retrying}>
        Evaluate answers
      </Button>
    </Card>
  );
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 7 ? 'green' : score >= 4 ? 'amber' : 'slate';
  return <Badge color={color}>{score}/10</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="text-center">
      <p className="text-3xl font-bold text-brand-600">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </Card>
  );
}
