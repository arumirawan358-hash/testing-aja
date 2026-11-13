import { QUESTION_BANK } from '../data/questionBank.js'
import { effectiveGrade, validateConfig } from '../data/subjects.js'

export function shuffle(items, random = Math.random) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const randomInt = (min, max, random) => Math.floor(random() * (max - min + 1)) + min

function numericQuestion(prompt, correct, explanation, random) {
  const distractors = new Set()
  const offsets = shuffle([1, -1, 2, -2, 3, -3, 5, 10], random)
  for (const offset of offsets) {
    const value = correct + offset
    if (value !== correct && (correct < 0 || value >= 0)) distractors.add(value)
    if (distractors.size === 3) break
  }
  let extra = 11
  while (distractors.size < 3) distractors.add(correct + extra++)
  const values = shuffle([correct, ...distractors], random)
  return {
    prompt,
    options: values.map(String),
    answer: values.indexOf(correct),
    explanation,
  }
}

export function makeMathQuestion(grade, kind, random) {
  const n = (min, max) => randomInt(min, max, random)
  let a, b, c, result, prompt, explanation

  if (grade <= 3) {
    a = n(grade === 1 ? 0 : 2, grade === 1 ? 12 : grade === 2 ? 50 : 100)
    b = n(grade === 1 ? 0 : 2, grade === 1 ? 12 : grade === 2 ? 30 : 50)
    if (kind === 0) {
      result = a + b
      prompt = `Berapakah ${a} + ${b}?`
      explanation = `${a} ditambah ${b} sama dengan ${result}.`
    } else if (kind === 1) {
      result = a
      prompt = `Berapakah ${a + b} − ${b}?`
      explanation = `${a + b} dikurangi ${b} sama dengan ${result}.`
    } else if (kind === 2 && grade >= 2) {
      a = n(2, grade === 2 ? 10 : 12); b = n(2, 10); result = a * b
      prompt = random() < 0.5 ? `Berapakah ${a} × ${b}?` : `Ada ${a} kantong berisi ${b} kelereng tiap kantong. Berapa jumlah kelereng seluruhnya?`
      explanation = `${a} dikali ${b} sama dengan ${result}.`
    } else if (kind === 3 && grade >= 3) {
      a = n(2, 12); b = n(2, 10); result = a
      prompt = random() < 0.5 ? `Berapakah ${a * b} ÷ ${b}?` : `Sebanyak ${a * b} permen dibagi rata kepada ${b} anak. Berapa permen yang diterima setiap anak?`
      explanation = `${a * b} dibagi ${b} sama dengan ${result}.`
    } else if (kind === 2) {
      result = b
      prompt = `Lengkapi: ${a} + … = ${a + b}. Berapa angka yang hilang?`
      explanation = `Angka yang hilang adalah ${a + b} − ${a} = ${b}.`
    } else {
      result = a + b
      prompt = `Rani punya ${a} pensil dan mendapat ${b} pensil lagi. Berapa jumlah pensilnya?`
      explanation = `Jumlahnya ${a} + ${b} = ${result} pensil.`
    }
  } else if (grade <= 6) {
    a = n(2, 40); b = n(2, 30)
    if (kind === 0) {
      result = 2 * (a + b)
      prompt = `Persegi panjang memiliki panjang ${a} cm dan lebar ${b} cm. Berapa kelilingnya dalam cm?`
      explanation = `Keliling = 2 × (panjang + lebar) = 2 × (${a} + ${b}) = ${result} cm.`
    } else if (kind === 1) {
      result = a * b
      prompt = `Berapa luas persegi panjang dengan panjang ${a} cm dan lebar ${b} cm dalam cm²?`
      explanation = `Luas = panjang × lebar = ${a} × ${b} = ${result} cm².`
    } else if (kind === 2) {
      a = n(2, 12); b = n(2, 80); result = b
      prompt = `Berapakah 1/${a} dari ${a * b}?`
      explanation = `1/${a} × ${a * b} = ${a * b} ÷ ${a} = ${result}.`
    } else {
      a = [10, 20, 25, 50, 75][n(0, 4)]; b = n(1, 50) * 100; result = a * b / 100
      prompt = `Berapakah ${a}% dari ${b}?`
      explanation = `${a}% × ${b} = ${a}/100 × ${b} = ${result}.`
    }
  } else if (grade <= 9) {
    a = n(2, 40); b = n(2, 50); c = n(2, 15)
    if (kind === 0) {
      result = b
      prompt = `Jika x + ${a} = ${a + b}, berapakah nilai x?`
      explanation = `x = ${a + b} − ${a} = ${result}.`
    } else if (kind === 1) {
      result = a * c + b
      prompt = `Jika f(x) = ${a}x + ${b}, berapakah nilai f(${c})?`
      explanation = `f(${c}) = ${a} × ${c} + ${b} = ${result}.`
    } else if (kind === 2) {
      result = a * b / 2
      // An even base keeps the answer an integer.
      a *= 2; result = a * b / 2
      prompt = `Berapa luas segitiga dengan alas ${a} cm dan tinggi ${b} cm dalam cm²?`
      explanation = `Luas = ½ × alas × tinggi = ½ × ${a} × ${b} = ${result} cm².`
    } else {
      a = [10, 20, 25, 50, 75][n(0, 4)]; b = n(1, 100) * 100; result = a * b / 100
      prompt = `Sebuah barang seharga Rp${b.toLocaleString('id-ID')} mendapat diskon ${a}%. Berapa besar diskonnya dalam rupiah?`
      explanation = `Diskon = ${a}/100 × ${b} = Rp${result.toLocaleString('id-ID')}.`
    }
  } else {
    a = n(1, 20); b = n(1, 30); c = n(2, 15)
    if (kind === 0) {
      result = a + (c - 1) * b
      prompt = `Barisan aritmetika memiliki suku pertama ${a} dan beda ${b}. Berapakah suku ke-${c}?`
      explanation = `Uₙ = a + (n − 1)b, sehingga U${c} = ${a} + (${c} − 1) × ${b} = ${result}.`
    } else if (kind === 1) {
      result = a * c + b
      prompt = `Diketahui f(x) = ${a}x + ${b}. Berapakah f(${c})?`
      explanation = `Substitusikan x = ${c}: f(${c}) = ${a} × ${c} + ${b} = ${result}.`
    } else if (kind === 2) {
      a = n(2, 30); result = a * a + b
      prompt = `Jika x = ${a}, berapakah nilai x² + ${b}?`
      explanation = `x² + ${b} = ${a}² + ${b} = ${result}.`
    } else if (grade === 10) {
      result = a * c - b
      prompt = `Jika g(x) = ${a}x − ${b}, berapakah g(${c})?`
      explanation = `g(${c}) = ${a} × ${c} − ${b} = ${result}.`
    } else if (grade === 11) {
      result = 2 * a * c + b
      prompt = `Jika f(x) = ${a}x² + ${b}x, berapakah nilai f′(${c})?`
      explanation = `f′(x) = ${2 * a}x + ${b}, sehingga f′(${c}) = ${result}.`
    } else {
      result = a * c
      prompt = `Berapakah nilai integral tentu ∫₀^${c} ${a} dx?`
      explanation = `Integral konstanta ${a} dari 0 sampai ${c} adalah ${a} × (${c} − 0) = ${result}.`
    }
  }
  return numericQuestion(prompt, result, explanation, random)
}

export function isValidQuestion(question) {
  return Boolean(
    question && typeof question.prompt === 'string' && question.prompt.trim().length > 0 && question.prompt.length <= 2500 &&
    Array.isArray(question.options) && question.options.length === 4 &&
    question.options.every((option) => typeof option === 'string' && option.trim().length > 0 && option.length <= 800) &&
    new Set(question.options.map((option) => option.trim().toLocaleLowerCase('id-ID'))).size === 4 &&
    Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4 &&
    typeof question.explanation === 'string' && question.explanation.trim().length > 0 && question.explanation.length <= 3000,
  )
}

export function makePracticeQuestions(config, random = Math.random) {
  const error = validateConfig(config)
  if (error) throw new Error(error)
  const count = Number(config.count)
  // Jenjang baru (Perguruan Tinggi/Umum) dipetakan ke tingkat kesulitan setara.
  const grade = effectiveGrade(config)
  const questions = []

  if (config.subject === 'Matematika') {
    const seen = new Set()
    let attempts = 0
    while (questions.length < count && attempts < count * 100) {
      const item = makeMathQuestion(grade, questions.length % 4, random)
      attempts += 1
      if (seen.has(item.prompt)) continue
      seen.add(item.prompt)
      questions.push({ ...item, id: `q-${questions.length + 1}` })
    }
    if (questions.length !== count) throw new Error('Tidak dapat menyiapkan soal matematika. Silakan coba lagi.')
    return questions
  }

  const bank = QUESTION_BANK[config.subject]?.filter((item) => grade >= item.min && grade <= item.max) || []
  if (bank.length === 0) throw new Error('Bank soal untuk pilihan ini belum tersedia. Pilih sumber soal AI.')
  let lastPrompt = ''
  while (questions.length < count) {
    const round = shuffle(bank, random)
    if (round.length > 1 && round[0].prompt === lastPrompt) [round[0], round[1]] = [round[1], round[0]]
    for (const item of round) {
      if (questions.length === count) break
      const options = shuffle([item.correct, ...item.wrong], random)
      questions.push({
        id: `q-${questions.length + 1}`,
        prompt: item.prompt,
        options,
        answer: options.indexOf(item.correct),
        explanation: item.explanation,
      })
      lastPrompt = item.prompt
    }
  }
  return questions
}

export function scoreAnswers(questions, answers) {
  let correct = 0
  let skipped = 0
  questions.forEach((question, index) => {
    const answer = answers[index]
    if (answer === null || answer === undefined) skipped += 1
    else if (answer === question.answer) correct += 1
  })
  const total = questions.length
  return {
    correct,
    wrong: total - correct - skipped,
    skipped,
    total,
    score: total ? Math.round((correct / total) * 100) : 0,
  }
}

export function areAnswersValid(answers, total) {
  return Array.isArray(answers) && answers.length <= total && answers.every((answer) => answer === null || (Number.isInteger(answer) && answer >= 0 && answer <= 3))
}
