import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AnswerHint from '../src/components/AnswerHint.jsx'

const question = { options: ['Satu', 'Dua', 'Tiga', 'Empat'], answer: 1 }
const render = (props) => renderToStaticMarkup(createElement(AnswerHint, props))

describe('hint pada setiap soal', () => {
  it('does not render an answer when hints are off', () => {
    expect(render({ question, enabled: false })).toBe('')
  })

  it('shows the correct option and letter when enabled, regardless of answer position', () => {
    for (let answer = 0; answer < 4; answer += 1) {
      const html = render({ question: { ...question, answer }, enabled: true })
      expect(html).toContain(`${'ABCD'[answer]}. ${question.options[answer]}`)
      expect(html).toContain('Hint jawaban')
      expect(html).toContain('aria-live="polite"')
    }
  })

  it('does not expose an invalid or missing answer', () => {
    expect(render({ question: { ...question, answer: 4 }, enabled: true })).toBe('')
    expect(render({ question: null, enabled: true })).toBe('')
  })
})
