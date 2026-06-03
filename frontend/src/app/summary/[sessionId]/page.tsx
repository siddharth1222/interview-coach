'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { sessionApi, ApiError } from '@/lib/api';
import type { Session } from '@/lib/types';
import { Button, Card, Spinner, Badge, Alert } from '@/components/ui';

export default function SummaryPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    sessionApi
      .get(sessionId)
      .then(({ session }) => setSession(session))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load summary'));
  }, [user, sessionId]);

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

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Questions" value={`${session.questions.length}`} />
        <Stat label="Answered" value={`${answered}/${session.questions.length}`} />
        <Stat label="AI assists used" value={`${assists}`} />
      </div>

      {/* Per-question breakdown */}
      <div className="space-y-4">
        {session.questions.map((q, i) => (
          <Card key={q.order}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-slate-900">
                <span className="text-slate-400">Q{i + 1}.</span> {q.prompt}
              </p>
              {q.assistance.used ? (
                <Badge color="indigo">AI used</Badge>
              ) : (
                <Badge color="slate">No AI</Badge>
              )}
            </div>

            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your answer</p>
              {q.userAnswer?.trim() ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{q.userAnswer}</p>
              ) : (
                <p className="mt-1 text-sm italic text-slate-400">No answer submitted</p>
              )}
            </div>

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
        ))}
      </div>

      <div className="flex justify-center gap-3 pt-2">
        <Link href="/dashboard">
          <Button>Start another session</Button>
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="text-center">
      <p className="text-3xl font-bold text-brand-600">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </Card>
  );
}
