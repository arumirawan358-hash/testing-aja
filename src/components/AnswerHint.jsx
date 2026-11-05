// A small local-only marker; nothing about this preference is sent to the other player.
export default function AnswerHint({ question, enabled }) {
  if (!enabled || !question || !Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3 || !Array.isArray(question.options) || typeof question.options[question.answer] !== 'string') return null
  const letter = 'ABCD'[question.answer]
  return <span className="answer-hint" aria-label={`Penanda ${letter}`}><span aria-hidden="true">✦</span> {letter}</span>
}
