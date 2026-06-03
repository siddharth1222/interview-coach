'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { sessionApi, ApiError } from '@/lib/api';
import type { Session } from '@/lib/types';
import { Button, Card, Spinner, Badge, Textarea, Alert } from '@/components/ui';

export default function InterviewPage() {
  const { loading: authLoading, user } = useRequireAuth();
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [current, setCurrent] = useState(0);
  const [answer, setAnswer] = useState('');
  const [loadError, setLoadError] = useState('');

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState('');
  const [completing, setCompleting] = useState(false);

  // Load the session.
  useEffect(() => {
    if (!user) return;
    sessionApi
      .get(sessionId)
      .then(({ session }) => {
        if (session.status === 'completed') {
          router.replace(`/summary/${session.id}`);
          return;
        }
        setSession(session);
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : 'Failed to load session')
      );
  }, [user, sessionId, router]);

  const question = session?.questions[current];

  // Sync the editable answer when navigating between questions.
  useEffect(() => {
    if (question) {
      setAnswer(question.userAnswer ?? '');
      setSavedAt(question.answeredAt ?? null);
      setAssistError('');
    }
  }, [current, question]);

  const saveAnswer = useCallback(async (): Promise<boolean> => {
    if (!session || !question) return false;
    setSaving(true);
    try {
      const { session: updated } = await sessionApi.submitAnswer(session.id, question.order, answer);
      setSession(updated);
      setSavedAt(updated.questions[current]?.answeredAt ?? new Date().toISOString());
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [session, question, answer, current]);

  const goTo = async (index: number) => {
    // Persist the current answer (if changed) before navigating.
    if (question && answer !== question.userAnswer) await saveAnswer();
    setCurrent(index);
  };

  const handleAssist = async () => {
    if (!session || !question) return;
    setAssistError('');
    setAssisting(true);
    try {
      // Save the draft first so the AI can react to it.
      if (answer !== question.userAnswer) await saveAnswer();
      const { content } = await sessionApi.assist(session.id, question.order);
      setSession((prev) => {
        if (!prev) return prev;
        const questions = prev.questions.map((q) =>
          q.order === question.order
            ? { ...q, assistance: { used: true, content, usedAt: new Date().toISOString() } }
            : q
        );
        return { ...prev, questions };
      });
    } catch (err) {
      setAssistError(err instanceof ApiError ? err.message : 'Failed to get AI assistance');
    } finally {
      setAssisting(false);
    }
  };

  const handleFinish = async () => {
    if (!session) return;
    if (question && answer !== question.userAnswer) await saveAnswer();
    setCompleting(true);
    try {
      await sessionApi.complete(session.id);
      router.push(`/summary/${session.id}`);
    } catch (err) {
      setAssistError(err instanceof ApiError ? err.message : 'Failed to complete session');
      setCompleting(false);
    }
  };

  if (authLoading || (!session && !loadError)) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }
  if (loadError) return <Alert>{loadError}</Alert>;
  if (!session || !question) return null;

  const total = session.questions.length;
  const isLast = current === total - 1;
  const assistance = question.assistance;

  return (
    <div className="space-y-6">
      {/* Header / progress */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium capitalize text-slate-500">
            {session.topic.replace('-', ' ')} · {session.difficulty}
          </p>
          <h1 className="text-xl font-bold text-slate-900">
            Question {current + 1} of {total}
          </h1>
        </div>
        <Badge color="indigo">{session.questions.filter((q) => q.answeredAt).length} answered</Badge>
      </div>

      {/* Progress dots */}
      <div className="flex gap-2">
        {session.questions.map((q, i) => (
          <button
            key={q.order}
            onClick={() => goTo(i)}
            title={`Go to question ${i + 1}`}
            className={
              'h-2.5 flex-1 rounded-full transition ' +
              (i === current
                ? 'bg-brand-600'
                : q.answeredAt
                  ? 'bg-brand-300'
                  : 'bg-slate-200 hover:bg-slate-300')
            }
          />
        ))}
      </div>

      {/* Question */}
      <Card>
        <p className="text-lg font-medium leading-relaxed text-slate-900">{question.prompt}</p>

        <div className="mt-4">
          <Textarea
            label="Your answer"
            rows={7}
            placeholder="Type your answer here…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button variant="secondary" onClick={saveAnswer} loading={saving}>
              Save answer
            </Button>
            {savedAt && !saving && (
              <span className="text-xs text-green-600">Saved {new Date(savedAt).toLocaleTimeString()}</span>
            )}
          </div>
        </div>
      </Card>

      {/* AI assistance */}
      <Card className="border-brand-100 bg-brand-50/40">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">AI Assistance</h2>
            <p className="text-xs text-slate-500">
              Get hints and guidance — never the answer. One use per question.
            </p>
          </div>
          {!assistance.used && (
            <Button onClick={handleAssist} loading={assisting} disabled={assisting}>
              Ask AI for a hint
            </Button>
          )}
          {assistance.used && <Badge color="green">Used</Badge>}
        </div>

        {assistError && (
          <div className="mt-3">
            <Alert>{assistError}</Alert>
          </div>
        )}

        {assistance.used && assistance.content && (
          <div className="prose-ai mt-4 rounded-lg border border-brand-100 bg-white p-4">
            <ReactMarkdown>{assistance.content}</ReactMarkdown>
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => goTo(current - 1)} disabled={current === 0}>
          ← Previous
        </Button>
        {isLast ? (
          <Button onClick={handleFinish} loading={completing}>
            Finish & view summary
          </Button>
        ) : (
          <Button onClick={() => goTo(current + 1)}>Next →</Button>
        )}
      </div>
    </div>
  );
}
