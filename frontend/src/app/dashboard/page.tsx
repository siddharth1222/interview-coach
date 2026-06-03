'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { catalogApi, sessionApi, createSessionStream, ApiError } from '@/lib/api';
import type { CatalogItem, SessionSummary } from '@/lib/types';
import { Button, Card, Spinner, Badge, Alert } from '@/components/ui';

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();

  const [topics, setTopics] = useState<CatalogItem[]>([]);
  const [difficulties, setDifficulties] = useState<CatalogItem[]>([]);
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const [generating, setGenerating] = useState(false);
  const [streamPreview, setStreamPreview] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    catalogApi
      .get()
      .then(({ topics, difficulties }) => {
        setTopics(topics);
        setDifficulties(difficulties);
        setTopic(topics[0]?.value ?? '');
        setDifficulty(difficulties[0]?.value ?? '');
      })
      .catch(() => setError('Failed to load topics'));
    sessionApi.list().then(({ sessions }) => setSessions(sessions)).catch(() => {});
  }, [user]);

  const handleGenerate = async () => {
    if (!topic || !difficulty) return;
    setError('');
    setGenerating(true);
    setStreamPreview('');
    try {
      const session = await createSessionStream(
        { topic, difficulty },
        {
          onChunk: (text) => setStreamPreview((prev) => prev + text),
          onError: (msg) => setError(msg),
        }
      );
      router.push(`/interview/${session.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate questions');
      setGenerating(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold text-slate-900">Start a new practice session</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose a topic and difficulty. We&apos;ll generate 5 interview questions for you.
        </p>

        <Card className="mt-4">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">Topic</span>
              <div className="flex flex-wrap gap-2">
                {topics.map((t) => (
                  <OptionChip key={t.value} active={topic === t.value} onClick={() => setTopic(t.value)}>
                    {t.label}
                  </OptionChip>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">Difficulty</span>
              <div className="flex flex-wrap gap-2">
                {difficulties.map((d) => (
                  <OptionChip
                    key={d.value}
                    active={difficulty === d.value}
                    onClick={() => setDifficulty(d.value)}
                  >
                    {d.label}
                  </OptionChip>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4">
              <Alert>{error}</Alert>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={handleGenerate} loading={generating} disabled={!topic || !difficulty}>
              {generating ? 'Generating questions…' : 'Generate questions'}
            </Button>
            {generating && <span className="text-sm text-slate-500">Streaming from Gemini…</span>}
          </div>

          {generating && streamPreview && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-green-300">
              {streamPreview}
            </pre>
          )}
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Your sessions</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No sessions yet — generate your first one above.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OptionChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-4 py-1.5 text-sm font-medium transition ' +
        (active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400')
      }
    >
      {children}
    </button>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const href = session.status === 'completed' ? `/summary/${session.id}` : `/interview/${session.id}`;
  return (
    <Link href={href}>
      <Card className="transition hover:border-brand-300 hover:shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium capitalize text-slate-900">
              {session.topic.replace('-', ' ')} · <span className="capitalize">{session.difficulty}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {new Date(session.createdAt).toLocaleString()}
            </p>
          </div>
          <Badge color={session.status === 'completed' ? 'green' : 'amber'}>
            {session.status === 'completed' ? 'Completed' : 'In progress'}
          </Badge>
        </div>
        <div className="mt-3 flex gap-4 text-xs text-slate-600">
          <span>
            {session.answeredCount}/{session.totalQuestions} answered
          </span>
          <span>{session.assistanceUsedCount} AI assists used</span>
        </div>
      </Card>
    </Link>
  );
}
