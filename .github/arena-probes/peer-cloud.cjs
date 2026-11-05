const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.APP_URL || 'http://127.0.0.1:4179/testing-aja/';
const root = path.resolve('dist');
const types = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.woff2':'font/woff2'};
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, base).pathname;
  if (!pathname.startsWith('/testing-aja/')) { res.writeHead(404).end(); return; }
  const filename = path.resolve(root, decodeURIComponent(pathname.slice('/testing-aja/'.length)) || 'index.html');
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(filename, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, {'Content-Type':types[path.extname(filename)] || 'application/octet-stream'}).end(data);
  });
});
const errors = [];

async function buildGame(browser, count = 3, ai = false) {
  const hostContext = await browser.newContext({viewport:{width:1280,height:900}});
  const guestContext = await browser.newContext({viewport:{width:320,height:720}, isMobile:true, hasTouch:true});
  for (const context of [hostContext, guestContext]) {
    await context.addInitScript(() => {
      const Native = window.RTCPeerConnection;
      window.__pcs = [];
      window.__blockRTC = false;
      window.RTCPeerConnection = class extends Native {
        constructor(...args) {
          if (window.__blockRTC) throw new Error('Simulated temporary WebRTC outage');
          super(...args);
          window.__pcs.push(this);
        }
      };
    });
  }
  const calls = { host: 0, guest: 0, next: 0 };
  if (ai) {
    await hostContext.route('https://api.groq.com/**', async route => {
      const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Content-Type':'application/json'};
      if (route.request().method() === 'OPTIONS') return route.fulfill({status:204, headers});
      calls.host++;
      const amount = Number(route.request().postDataJSON().messages[1].content.match(/Buat tepat (\d+) soal/)[1]);
      if (amount > 4) return route.fulfill({status:413, headers, body:'{}'});
      const questions = Array.from({length:amount}, () => ({prompt:`Pertanyaan tiruan nomor ${++calls.next}?`, options:['Jawaban benar','Pilihan B','Pilihan C','Pilihan D'], answer:0, explanation:'Pembahasan pendidikan. ' + 'penjelasan '.repeat(45)}));
      return route.fulfill({status:200, headers, body:JSON.stringify({choices:[{message:{content:JSON.stringify({questions})}}]})});
    });
    await guestContext.route('https://api.groq.com/**', async route => { calls.guest++; await route.abort(); });
  }
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  host.on('pageerror', error => errors.push('host: '+error.message));
  guest.on('pageerror', error => errors.push('guest: '+error.message));
  await Promise.all([host.goto(base), guest.goto(base)]);
  await host.getByLabel('Nama panggilan pembuat ruang').fill('Bintang');
  await host.locator('input[type=number]').fill(String(count));
  if (ai) await host.getByPlaceholder('Masukkan API key Groq').fill('fake-key-for-local-test-only');
  else await host.getByRole('radio', {name:'Bank soal Langsung main'}).click();
  await host.getByRole('button', {name:'Buat ruang', exact:false}).last().click();
  await host.locator('.room-code').waitFor();
  const label = await host.locator('.room-code').getAttribute('aria-label');
  const code = label.replace('Kode ruang ', '');
  await guest.getByLabel('Nama panggilan untuk bergabung').fill('Mentari');
  await guest.getByLabel('Kode ruang').fill(code);
  await guest.getByRole('button', {name:'Gabung ruang'}).click();
  await host.getByRole('button', {name:'Mulai permainan'}).waitFor({state:'visible', timeout:20000});
  await host.waitForFunction(() => !document.querySelector('.lobby-start')?.disabled, null, {timeout:30000});
  await host.getByRole('button', {name:'Mulai permainan'}).click();
  await Promise.all([host.locator('.question-card').waitFor({timeout:30000}), guest.locator('.question-card').waitFor({timeout:30000})]);
  return {host, guest, hostContext, guestContext, calls};
}

async function answer(page, index, total, choice) {
  await page.waitForFunction(index => document.querySelector('.question-count')?.textContent.includes(`SOAL ${index+1}`), index);
  const option = page.locator('.answer-option').nth(choice);
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  assert.ok(overflow.scroll <= overflow.width, `horizontal overflow: ${JSON.stringify(overflow)}`);
  const answerText = (await option.locator('.answer-text').innerText()).trim();
  await option.click();
  assert.equal(await option.getAttribute('aria-checked'), 'true');
  const next = page.locator('.next-button');
  assert.equal(await next.isEnabled(), true, `next disabled at Q${index+1}`);
  await next.click();
  if (index < total - 1) await page.waitForFunction(index => document.querySelector('.question-count')?.textContent.includes(`SOAL ${index+2}`), index);
  return answerText;
}

async function checkAnswers(page, answers) {
  await page.locator('.review-item').first().waitFor({timeout:30000});
  const reviews = page.locator('.review-item');
  assert.equal(await reviews.count(), answers.length);
  for (let i=0; i<answers.length; i++) {
    const content = await reviews.nth(i).innerText();
    assert.ok(content.includes(`Jawabanmu: ${answers[i]}`), `review ${i+1} differs: ${content}`);
  }
}

(async()=> {
  if (!process.env.APP_URL) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4179, '127.0.0.1', resolve); });
  const executablePath = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
  assert.ok(executablePath, 'Chrome is not installed on the runner');
  const browser = await chromium.launch({executablePath, headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    // A real two-player WebRTC session: host finishes first, guest uses A/B/C.
    {
      const {host, guest, hostContext, guestContext} = await buildGame(browser);
      const hostAnswers = [], guestAnswers = [];
      for (let i=0;i<3;i++) hostAnswers.push(await answer(host, i, 3, 3));
      await host.getByRole('heading', {name:'Kamu sudah selesai!'}).waitFor();
      for (let i=0;i<3;i++) guestAnswers.push(await answer(guest, i, 3, i));
      await Promise.all([checkAnswers(host, hostAnswers), checkAnswers(guest, guestAnswers)]);
      const hostScores = await host.locator('.score-number').allTextContents();
      const guestScores = await guest.locator('.score-number').allTextContents();
      assert.deepEqual(hostScores, guestScores.slice().reverse());
      console.log('PASS real WebRTC: host finishes first; guest clicks A, B, C and advances; answers and scores agree');
      await hostContext.close(); await guestContext.close();
    }
    // Break the actual WebRTC connection while preventing a reconnect for a moment.
    {
      const {host, guest, hostContext, guestContext} = await buildGame(browser);
      const before = await guest.evaluate(() => window.__pcs.length);
      assert.ok(before > 0, 'no RTCPeerConnection recorded');
      await guest.evaluate(() => { window.__blockRTC = true; for (const pc of window.__pcs) pc.close(); });
      await Promise.all([
        host.locator('[role=alert]').waitFor({timeout:30000}),
        guest.locator('[role=alert]').waitFor({timeout:30000}),
      ]);
      const hostNotice = await host.locator('[role=alert]').innerText();
      const guestNotice = await guest.locator('[role=alert]').innerText();
      assert.match(guestNotice, /lanjut|tersimpan/i);
      assert.match(hostNotice, /lanjut/i);
      const hostAnswers = [], guestAnswers = [];
      for (let i=0;i<3;i++) hostAnswers.push(await answer(host, i, 3, 0));
      for (let i=0;i<3;i++) guestAnswers.push(await answer(guest, i, 3, i));
      await Promise.all([host.getByRole('heading',{name:'Kamu sudah selesai!'}).waitFor(),guest.getByRole('heading',{name:'Kamu sudah selesai!'}).waitFor()]);
      assert.match(await guest.locator('.waiting-card').innerText(), /Jangan tutup atau muat ulang/);
      await guest.evaluate(() => { window.__blockRTC = false; });
      await Promise.all([checkAnswers(host, hostAnswers), checkAnswers(guest, guestAnswers)]);
      const hostScores = await host.locator('.score-number').allTextContents();
      const guestScores = await guest.locator('.score-number').allTextContents();
      assert.deepEqual(hostScores, guestScores.slice().reverse());
      console.log('PASS real WebRTC outage: both answer while disconnected; auto reconnect; identical results and full answer reviews');
      await hostContext.close(); await guestContext.close();
    }
    {
      const {host, guest, hostContext, guestContext, calls} = await buildGame(browser, 50, true);
      assert.ok(calls.host > 10, `expected split mocked AI batches; got ${calls.host}`);
      assert.equal(calls.guest, 0);
      const firstHost = await host.locator('.question-card h2').innerText();
      const firstGuest = await guest.locator('.question-card h2').innerText();
      assert.equal(firstGuest, firstHost);
      for (let i=0; i<3; i++) await answer(guest, i, 50, i);
      await host.waitForFunction(() => document.querySelectorAll('.progress-label b')[1]?.textContent.includes('3/50'));
      console.log('PASS 50 mocked Groq questions: chunk transfer, guest A/B/C navigation, progress, and host-only AI requests');
      await hostContext.close(); await guestContext.close();
    }
    {
      const {host, guest, hostContext, guestContext} = await buildGame(browser);
      host.once('dialog', dialog => dialog.accept());
      await host.getByRole('button',{name:'Keluar dari permainan'}).click();
      await guest.locator('[role=alert]').waitFor({timeout:10000});
      assert.match(await guest.locator('[role=alert]').innerText(), /meninggalkan ruang/i);
      console.log('PASS room closure is distinguished from a temporary outage');
      await hostContext.close(); await guestContext.close();
    }
    if (errors.length) throw new Error('Browser errors: '+errors.join('; '));
    console.log('PASS no uncaught browser errors');
  } finally { await browser.close(); if (!process.env.APP_URL) await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(`::error::${String(e.stack || e).replace(/\n/g, ' %0A ')}`); process.exit(1); });
