import mongoose from 'mongoose';
import { TOPIC_KEYS, DIFFICULTY_KEYS } from '../config/constants.js';

/** A single AI-assistance grant for a question (hints only — never the answer). */
const assistanceSchema = new mongoose.Schema(
  {
    used: { type: Boolean, default: false },
    content: { type: String, default: '' },
    usedAt: { type: Date },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true }, // 0-based position in the session
    prompt: { type: String, required: true },
    userAnswer: { type: String, default: '' },
    answeredAt: { type: Date },
    assistance: { type: assistanceSchema, default: () => ({}) },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    topic: { type: String, required: true, enum: TOPIC_KEYS },
    difficulty: { type: String, required: true, enum: DIFFICULTY_KEYS },
    status: {
      type: String,
      enum: ['in_progress', 'completed'],
      default: 'in_progress',
      index: true,
    },
    questions: {
      type: [questionSchema],
      validate: [(v) => v.length > 0, 'A session must have at least one question'],
    },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// Common access pattern: a user's sessions, newest first.
sessionSchema.index({ user: 1, createdAt: -1 });

sessionSchema.virtual('answeredCount').get(function answeredCount() {
  return this.questions.filter((q) => q.answeredAt).length;
});

sessionSchema.virtual('assistanceUsedCount').get(function assistanceUsedCount() {
  return this.questions.filter((q) => q.assistance?.used).length;
});

sessionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Session = mongoose.model('Session', sessionSchema);
