# KuisKita ✦

Kuis belajar SD, SMP, dan SMA: bermain sendiri atau berdua jarak jauh, dengan **1–500 soal**, nilai, dan pembahasan setelah selesai.

**Mainkan:** https://arumirawan358-hash.github.io/testing-aja/

## Cara bermain

1. Buka KuisKita dan isi nama, jenjang, kelas, mata pelajaran, jumlah soal, dan jika perlu topik khusus. Untuk pelajaran lain, pilih **Lainnya (khusus AI)**.
2. **Groq AI** dipilih secara awal. Untuk membuat soal AI, pemain solo atau pembuat ruang memasukkan API key miliknya di formulir. Buat key di [Groq Console](https://console.groq.com/keys); jangan kirim key lewat chat atau simpan di repository.
3. Pilih **Latihan sendiri** atau **Buat ruang**. Jika berdua, bagikan kode/tautan kepada teman. Teman hanya mengisi nama dan kode ruang—**tidak perlu API key**. Setelah teman bergabung, pembuat ruang menekan **Mulai permainan**.
4. Jawab atau lewati setiap soal. Dalam permainan berdua, hasil dan pembahasan muncul setelah kedua pemain selesai.
5. Pada hasil, pilih **Main lagi** untuk soal baru dengan pengaturan yang sama. Untuk permainan berdua, kedua pemain dapat membaca pembahasan dahulu dan masing-masing memilih **Main lagi**; mereka kembali ke ruang dan pembuat ruang memulai ronde berikutnya. Kunci tidak perlu dimasukkan ulang selama tetap di ruang yang sama.

Pilih **Bank soal** bila ingin mencoba tanpa API key. Bank soal non-matematika jumlahnya terbatas dan bisa berulang, terutama saat meminta banyak soal. Efek suara dapat dinyalakan atau dimatikan melalui tombol suara di bagian atas halaman; preferensi suara disimpan di browser.

## Soal Groq dan variasi

- Kuis menggunakan model `openai/gpt-oss-120b` melalui Groq Chat Completions. Soal diminta berdasarkan jenjang, kelas, pelajaran, topik, dan jumlah yang dipilih. Soal dibuat bertahap, maksimum 15 per permintaan, dan jawaban diacak dengan tetap menjaga indeks jawaban yang benar.
- Aplikasi memvalidasi struktur dan menolak soal dengan teks yang sama, termasuk yang baru dibuat pada batch sebelumnya dan riwayat terbaru dalam tab tersebut. Riwayat dibatasi hingga 1.000 teks soal per kombinasi pengaturan, untuk maksimal 10 kombinasi, dan hilang saat halaman ditutup atau dimuat ulang. Randomisasi dan riwayat membantu variasi; **AI tetap dapat mengulang konsep atau memparafrasekan soal**, dan tidak ada jaminan soal selalu berbeda atau selalu benar. Periksa pembahasan dengan guru atau sumber tepercaya.
- Groq memiliki batas permintaan, token, kuota, dan kemungkinan biaya sesuai paket akun. Pembuatan 500 soal memerlukan banyak permintaan dan dapat memakan waktu, terkena batas kuota, atau gagal. Jika terjadi, tunggu, coba jumlah lebih kecil, atau periksa [batas akun Groq](https://console.groq.com/settings/limits). Topik yang terlalu sempit juga dapat menyulitkan pembuatan banyak soal berbeda.

## Keamanan dan privasi

- Situs ini statis dan **tidak membutuhkan Render atau server Groq milik pengelola**. Browser pemain solo/pembuat ruang mengirim key langsung ke `https://api.groq.com` melalui HTTPS dalam header `Authorization`, bersama pengaturan kuis yang diperlukan untuk membuat soal.
- Aplikasi menyimpan key sementara di memori tab selama sesi (termasuk saat main ulang) dan menghapus rujukannya saat keluar. Aplikasi tidak sengaja menyimpan key di localStorage, sessionStorage, URL, repository, atau pesan permainan kepada teman. Hanya preferensi aktif/mati suara yang disimpan di localStorage.
- Memasukkan key di browser **bukan penyimpanan rahasia yang sempurna**. Orang yang memiliki akses ke perangkat, DevTools, atau ekstensi berbahaya dapat melihatnya. Gunakan perangkat yang tepercaya, atur batas penggunaan di Groq, dan cabut/rotasi key jika pernah dibagikan atau terekspos. Jangan memasukkan informasi pribadi dalam topik atau soal.
- Mode berdua memakai PeerJS untuk mempertemukan pemain dan WebRTC untuk mengirim data permainan. Soal dan jawaban dikirim ke perangkat teman; bagikan kode ruang hanya dengan orang yang dipercaya. Gangguan PeerJS, WebRTC, STUN/TURN, jaringan, pembatas browser/CORS, atau Groq dapat menghambat permainan.

## Menjalankan lokal

Diperlukan Node.js 22 dan npm:

```bash
npm ci
npm run dev
```

Buka alamat Vite yang ditampilkan. Mode development menjalankan server penghubung PeerJS lokal dan proxy Vite; browser memanggil Groq langsung setelah pemain memasukkan key. Tidak perlu file `.env` atau backend AI. Di jaringan lokal, izinkan WebSocket dan WebRTC jika ingin bermain dari perangkat lain.

```bash
npm test
npm run build
npm run preview
```

Tes otomatis memakai respons Groq tiruan (mock) dan **tidak membuktikan bahwa key/kuota nyata aktif**. Untuk mengecek respons AI nyata, jalankan situs di browser yang memiliki akses internet, masukkan key baru secara privat di formulir KuisKita, pilih Groq dan coba satu soal. Jangan membagikan key kepada pengembang atau di chat.

## Deploy GitHub Pages

Workflow `.github/workflows/deploy.yml` menjalankan tes dan build pada pull request, lalu men-deploy `main` ke GitHub Pages dengan `VITE_SIGNALING_MODE=cloud`. Aktifkan **Settings → Pages → Build and deployment → GitHub Actions** pada repository. Tidak diperlukan variabel GitHub atau secret Groq: setiap pemain solo/host memasukkan key masing-masing di situs.

Vite memakai `VITE_BASE_PATH` saat build untuk subdirektori Pages. Pengelola yang membutuhkan layanan penghubung atau TURN sendiri dapat mengatur `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`, `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, dan `VITE_TURN_CREDENTIAL` saat build. Nilai `VITE_` masuk ke JavaScript publik: **jangan masukkan API key Groq atau rahasia lainnya di sana**.
