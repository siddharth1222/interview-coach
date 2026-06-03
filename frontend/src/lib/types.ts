export interface User {
  id: string;
  name: string;
  email: string;
}

export interface CatalogItem {
  value: string;
  label: string;
}

export interface Catalog {
  topics: CatalogItem[];
  difficulties: CatalogItem[];
}

export interface Assistance {
  used: boolean;
  content: string;
  usedAt?: string;
}

export interface Question {
  order: number;
  prompt: string;
  userAnswer: string;
  answeredAt?: string;
  assistance: Assistance;
}

export interface Session {
  id: string;
  topic: string;
  difficulty: string;
  status: 'in_progress' | 'completed';
  questions: Question[];
  answeredCount: number;
  assistanceUsedCount: number;
  createdAt: string;
  completedAt?: string;
}

export interface SessionSummary {
  id: string;
  topic: string;
  difficulty: string;
  status: 'in_progress' | 'completed';
  totalQuestions: number;
  answeredCount: number;
  assistanceUsedCount: number;
  createdAt: string;
  completedAt?: string;
}
