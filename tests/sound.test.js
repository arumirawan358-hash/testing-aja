import { describe, expect, it, vi } from 'vitest'
import { createSoundPlayer } from '../src/lib/sound.js'

function fakeAudio() {
  const nodes = []
  const context = {
    state: 'suspended', currentTime: 2, destination: {},
    resume: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue(),
    createOscillator: vi.fn(() => {
      const node = { frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      nodes.push(node)
      return node
    }),
    createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() })),
  }
  return { context, nodes }
}

describe('efek suara', () => {
  it('plays short synthesized effects with envelopes and closes the context', () => {
    const { context, nodes } = fakeAudio()
    const create = vi.fn(() => context)
    const player = createSoundPlayer(create)
    expect(player.play('answer')).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(context.resume).toHaveBeenCalled()
    expect(nodes).toHaveLength(2)
    expect(nodes[0].frequency.setValueAtTime).toHaveBeenCalledWith(660, expect.any(Number))
    expect(nodes[0].start).toHaveBeenCalled()
    expect(nodes[0].stop).toHaveBeenCalled()
    expect(player.play('finish')).toBe(true)
    expect(nodes).toHaveLength(6)
    player.destroy()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('fails quietly when Web Audio is unavailable or blocked', () => {
    expect(createSoundPlayer(() => null).play()).toBe(false)
    expect(createSoundPlayer(() => { throw new Error('blocked') }).play()).toBe(false)
  })
})
