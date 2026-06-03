'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button, Spinner } from '@/components/ui';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">
        Ace your next technical interview
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        Pick a topic and difficulty, get 5 AI-generated interview questions, and practice answering
        — with on-demand hints that guide you without giving away the answer.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/register">
          <Button>Get started</Button>
        </Link>
        <Link href="/login">
          <Button variant="secondary">Log in</Button>
        </Link>
      </div>
      <div className="mt-12 grid gap-4 text-left sm:grid-cols-3">
        {[
          ['Choose a track', 'Generative AI, JavaScript, or MongoDB at 3 difficulty levels.'],
          ['Answer one at a time', 'Save progress and navigate freely between questions.'],
          ['Get guided hints', 'One AI assist per question — hints, not solutions.'],
        ].map(([title, body]) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
