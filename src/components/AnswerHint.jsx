import { Lightbulb } from 'lucide-react'

export default function AnswerHint({ question, enabled }) {
  if (!enabled || !question || !Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3 || !Array.isArray(question.options) || typeof question.options[question.answer] !== 'string') return null
  return <aside className="answer-hint" aria-live="polite">
    <span className="answer-hint-icon"><Lightbulb size={19} /></span>
    <div><strong>Hint jawaban</strong><p>Jawaban yang disarankan: <b>{'ABCD'[question.answer]}. {question.options[question.answer]}</b></p></div>
  </aside>
}
