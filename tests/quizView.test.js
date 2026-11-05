// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Quiz, Waiting } from '../src/components/GameViews.jsx'
import { PreferencesProvider } from '../src/components/PreferencesContext.jsx'
import { SoundProvider } from '../src/components/SoundContext.jsx'
import { DEFAULT_CONFIG } from '../src/data/subjects.js'

const h = createElement
const questions = Array.from({ length: 3 }, (_, index) => ({
  id: `q-${index}`, prompt: `Soal ${index + 1}`, options: ['Pilihan A', 'Pilihan B', 'Pilihan C', 'Pilihan D'], answer: 0, explanation: 'Pembahasan',
}))
let container, root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

function show(Component, state, session) {
  act(() => root.render(h(SoundProvider, null, h(PreferencesProvider, null, h(Component, { state, session })))))
}
function click(element) { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
function quizState(role = 'guest') {
  return {
    screen: 'quiz', role, connected: false, roomClosed: false, status: 'disconnected',
    error: 'Koneksi terputus. Kamu tetap bisa lanjut; jawaban tersimpan di tab ini.',
    selfName: 'Mentari', opponentName: 'Bintang', opponentProgress: 0, code: 'ABC123',
    config: { ...DEFAULT_CONFIG, source: 'bank', count: 3 }, gameId: 'round-1', questions, answers: [], startedAt: Date.now(),
  }
}

describe('quiz controls', () => {
  it.each(['guest', 'host'])('lets a disconnected %s select and advance without losing the connection warning', (role) => {
    let state = quizState(role)
    const session = { submitAnswer: vi.fn(), reconnect: vi.fn(), quit: vi.fn() }
    show(Quiz, state, session)
    const next = () => container.querySelector('.next-button')
    const skip = () => container.querySelector('.skip-button')
    const option = (index) => container.querySelectorAll('.answer-option')[index]
    expect(next().disabled).toBe(true)
    expect(skip().disabled).toBe(false)
    expect(container.querySelector('[role=alert]').textContent).toContain('tersimpan')

    click(option(0))
    expect(option(0).getAttribute('aria-checked')).toBe('true')
    expect(next().disabled).toBe(false)
    click(next())
    expect(session.submitAnswer).toHaveBeenLastCalledWith(0, { gameId: 'round-1', index: 0 })

    state = { ...state, answers: [0] }
    show(Quiz, state, session)
    expect(next().disabled).toBe(true)
    click(option(1))
    expect(next().disabled).toBe(false)
    click(next())
    expect(session.submitAnswer).toHaveBeenLastCalledWith(1, { gameId: 'round-1', index: 1 })

    state = { ...state, answers: [0, 1] }
    show(Quiz, state, session)
    click(option(2))
    expect(next().disabled).toBe(false)
    click(next())
    expect(session.submitAnswer).toHaveBeenLastCalledWith(2, { gameId: 'round-1', index: 2 })
    expect(container.querySelector('[role=alert]').textContent).toContain('tersimpan')
  })

  it('keeps a selection through connection updates but not across a new question or round', () => {
    let state = quizState()
    const session = { submitAnswer: vi.fn(), reconnect: vi.fn(), quit: vi.fn() }
    show(Quiz, state, session)
    click(container.querySelectorAll('.answer-option')[2])
    show(Quiz, { ...state, connected: true, status: 'playing', error: '' }, session)
    expect(container.querySelectorAll('.answer-option')[2].getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.next-button').disabled).toBe(false)
    state = { ...state, gameId: 'round-2' }
    show(Quiz, state, session)
    expect(container.querySelector('.next-button').disabled).toBe(true)
  })

  it('explains temporary storage and does not suggest reconnecting a deliberately closed room', () => {
    const session = { reconnect: vi.fn(), quit: vi.fn() }
    const state = { ...quizState(), screen: 'waiting', answers: [0, 1, 2] }
    show(Waiting, state, session)
    expect(container.textContent).toContain('Jangan tutup atau muat ulang halaman')
    expect(container.querySelector('.notice button').textContent).toContain('Hubungkan lagi')
    show(Waiting, { ...state, roomClosed: true, status: 'error', error: 'Pemain lain meninggalkan ruang.' }, session)
    expect(container.textContent).toContain('hasil bersama tidak dapat ditampilkan')
    expect(container.querySelector('.notice button')).toBeNull()
  })
})
