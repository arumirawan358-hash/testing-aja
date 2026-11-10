// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Lobby, Results } from '../src/components/GameViews.jsx'
import ChampionCelebration from '../src/components/ChampionCelebration.jsx'
import { ProfileCard, RankBadge } from '../src/components/ProfileCard.jsx'
import { PreferencesProvider } from '../src/components/PreferencesContext.jsx'
import { SoundProvider } from '../src/components/SoundContext.jsx'
import { DEFAULT_CONFIG } from '../src/data/subjects.js'
import { getRank } from '../src/lib/ranks.js'

const h = createElement
const questions = [
  { id: 'q-0', prompt: 'Soal 1', options: ['A', 'B', 'C', 'D'], answer: 0, explanation: 'Pembahasan' },
  { id: 'q-1', prompt: 'Soal 2', options: ['A', 'B', 'C', 'D'], answer: 1, explanation: 'Pembahasan' },
]
const opponentProfile = {
  name: 'Mentari', avatar: 'robot', smartPoints: 120, wins: 1, draws: 0, losses: 2, gamesPlayed: 3,
  winRate: 33, accuracy: 50, rank: getRank(120),
}
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

function show(Component, state, session = { quit: vi.fn(), startGame: vi.fn(), reconnect: vi.fn(), playAgain: vi.fn() }) {
  act(() => root.render(h(SoundProvider, null, h(PreferencesProvider, null, h(Component, { state, session })))))
}
function showNode(node) {
  act(() => root.render(h(SoundProvider, null, h(PreferencesProvider, null, node))))
}
function click(element) { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }

function resultsState() {
  return {
    screen: 'results', role: 'host', connected: true, roomClosed: false, status: 'finished', error: '',
    selfName: 'Bintang', opponentName: 'Mentari', code: 'ABC123', rematchRequested: false, opponentRematchRequested: false,
    config: { ...DEFAULT_CONFIG, source: 'bank', count: 2 }, gameId: 'round-1',
    questions, answers: [0, 1], startedAt: Date.now() - 5000,
    result: {
      host: { name: 'Bintang', correct: 2, wrong: 0, skipped: 0, total: 2, score: 100, elapsedMs: 4000 },
      guest: { name: 'Mentari', correct: 1, wrong: 1, skipped: 0, total: 2, score: 50, elapsedMs: 6000 },
    },
    opponentProfile,
  }
}

describe('animasi juara dan profil pemain', () => {
  it('shows the champion celebration with confetti for the winner', () => {
    show(Results, resultsState())
    const celebration = container.querySelector('.champion-celebration')
    expect(celebration).not.toBeNull()
    expect(celebration.className).toContain('champion-self')
    expect(celebration.textContent).toContain('JUARA RONDE INI')
    expect(celebration.textContent).toContain('Bintang')
    expect(container.querySelectorAll('.confetti span').length).toBeGreaterThan(20)
    expect(container.querySelector('.champion-art').getAttribute('src')).toContain('champion.png')
  })

  it('does not crown anyone on a tie', () => {
    const state = resultsState()
    state.result.guest = { ...state.result.guest, score: 100, correct: 2, wrong: 0 }
    show(Results, state)
    expect(container.querySelector('.champion-celebration')).toBeNull()
    expect(container.textContent).toContain('Seri!')
  })

  it('opens another player profile from the results screen', () => {
    show(Results, resultsState())
    const buttons = [...container.querySelectorAll('.player-profile-link')]
    expect(buttons.length).toBe(2)
    click(buttons[1])
    const dialog = container.querySelector('.profile-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain('Mentari')
    expect(dialog.textContent).toContain('Bintang Muda')
    expect(dialog.textContent).toContain('33%')
    click(dialog.querySelector('.panel-close'))
    expect(container.querySelector('.profile-dialog')).toBeNull()
  })

  it('renders rank bling that grows with the rank class', () => {
    showNode(h(RankBadge, { rank: getRank(0) }))
    expect(container.querySelector('.rank-badge').className).toContain('rank-bling-0')
    expect(container.querySelectorAll('.rank-sparkle').length).toBe(0)
    showNode(h(RankBadge, { rank: getRank(4000) }))
    const badge = container.querySelector('.rank-badge')
    expect(badge.className).toContain('rank-bling-6')
    expect(container.querySelectorAll('.rank-sparkle').length).toBe(4)
  })

  it('shows winrate, smart points, and accuracy on the profile card', () => {
    showNode(h(ProfileCard, { profile: opponentProfile }))
    expect(container.textContent).toContain('Poin Kepintaran')
    expect(container.textContent).toContain('120')
    expect(container.textContent).toContain('33%')
    expect(container.textContent).toContain('50%')
    expect(container.textContent).toContain('1 / 3')
    expect(container.textContent).toContain('Bintang Muda')
  })

  it('lets lobby players open each other profiles', () => {
    const state = {
      screen: 'lobby', role: 'host', connected: true, roomClosed: false, status: 'joined', error: '',
      selfName: 'Bintang', opponentName: 'Mentari', code: 'ABC123',
      config: { ...DEFAULT_CONFIG, source: 'bank', count: 2 }, gameId: '', questions: [], answers: [],
      opponentProgress: 0, preparation: null, opponentProfile,
    }
    show(Lobby, state)
    expect(container.querySelectorAll('.player-profile-link').length).toBe(2)
    expect(container.textContent).toContain('Bintang Muda')
    click(container.querySelectorAll('.player-profile-link')[1])
    expect(container.querySelector('.profile-dialog').textContent).toContain('Mentari')
  })
})
