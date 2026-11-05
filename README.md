# KuisKita ✨

Game kuis berbahasa Indonesia untuk belajar sendiri atau bermain berdua dari jarak jauh. Pilih jenjang **SD, SMP, atau SMA**, kelas 1–12, mata pelajaran, dan **1–500 soal**. Buat ruang dengan kode enam karakter, bagikan kode atau tautannya, lalu lihat nilai dan pembahasan setelah kedua pemain selesai.

## Cara bermain

1. Isi nama, jenjang, kelas, mata pelajaran, dan jumlah soal pada **Buat ruang baru**.
2. Pilih sumber soal, lalu tekan **Buat ruang**. Tombol **Latihan sendiri** tersedia jika tidak ingin menunggu teman.
3. Kirim kode atau tautan undangan kepada seorang teman. Teman memasukkan nama dan bergabung lewat **Punya kode ruang?**
4. Host memulai permainan setelah kedua pemain terhubung. Kedua pemain menerima soal dan pilihan jawaban yang sama dan dapat menjawab dengan kecepatan masing-masing.
5. Setelah keduanya selesai, nilai, jumlah benar/salah/dilewati, dan pembahasan ditampilkan. Nilai = benar ÷ jumlah soal × 100, dibulatkan.

Ruang hanya menampung dua orang dan aktif selama halaman host tetap terbuka. Jangan menyegarkan atau menutup tab selama permainan: tidak ada akun atau penyimpanan permainan di server. Jika koneksi terputus tanpa menutup halaman, pemain tamu dapat mencoba tombol **Hubungkan lagi**.

## Sumber soal

- **Bank soal** langsung dapat dipakai tanpa kunci API. Bank ini adalah kumpulan latihan ringkas; terutama untuk jumlah besar, soal nonmatematika **dapat berulang**. Soal matematika dibuat dari pola dan angka yang bervariasi.
- **Groq AI** menggunakan `openai/gpt-oss-120b`, model berkemampuan tinggi di Groq. Setelah pengelola menyiapkan backend sesuai petunjuk di bawah, pemain **tidak perlu melihat atau memasukkan API key**. Topik khusus dan mata pelajaran lain dapat ditulis sendiri. Tanpa backend yang ditautkan, pilihan ini ditandai belum terhubung.
- **Gemini AI** menggunakan Gemini 2.5 Flash. Pembuat ruang memasukkan [Gemini API key dari Google AI Studio](https://aistudio.google.com/app/apikey). Kunci disimpan sementara dalam memori browser, dikirim langsung ke Google melalui HTTPS, dan tidak dibagikan kepada teman atau disimpan di repositori. Tamu tidak membutuhkan kunci. Topik dan mata pelajaran khusus juga didukung.

Soal AI dibuat bertahap; jumlah besar dapat memerlukan waktu dan kuota lebih banyak. Kuota, ketersediaan model, dan kemungkinan biaya mengikuti layanan serta akun pemilik kunci. AI dapat membuat kesalahan: periksa soal dan pembahasan dengan guru atau sumber tepercaya.

## Menjalankan di komputer sendiri

Persyaratan: Node.js 20 atau lebih baru dan npm.

```bash
npm ci
# Opsional untuk Groq: salin .env.example menjadi .env dan isi GROQ_API_KEY secara privat.
npm run dev
```

Buka alamat Vite yang ditampilkan. Perintah ini menjalankan server penghubung PeerJS lokal, server AI, dan Vite; browser mengakses server melalui proxy pada origin yang sama. Tanpa `GROQ_API_KEY`, server Groq akan menjelaskan bahwa konfigurasi belum tersedia, sedangkan bank soal dan Gemini tetap bisa dipakai. File `.env` diabaikan Git; jangan membagikannya atau memasukkan kunci ke kode.

Untuk build, pratinjau, dan uji otomatis:

```bash
npm test
npm run build
npm run preview
```

## GitHub Pages dan backend Groq

GitHub Pages hanya menyajikan file statis. **Ia tidak bisa menyimpan API key secara rahasia atau menjalankan server Groq.** Bank soal dan Gemini tetap berfungsi tanpa backend Groq. Mode berdua di Pages menggunakan **PeerJS Cloud** untuk mempertemukan pemain dan **WebRTC** untuk data permainan. Jaringan yang membatasi WebRTC/STUN/TURN atau gangguan layanan pihak ketiga dapat menghalangi koneksi.

### Mengaktifkan Groq untuk semua pemain

Dibutuhkan akun hosting yang dapat menjalankan Node.js. Contoh berikut memakai Render; `render.yaml` menyediakan konfigurasi awal layanan gratis (syarat, kuota, dan kebijakan penyedia dapat berubah).

1. **Cabut/rotate setiap API key yang pernah dibagikan atau terekspos**, lalu buat key baru di [Groq Console](https://console.groq.com/keys). Jangan kirim key baru lewat chat, commit, variabel GitHub publik, atau formulir permainan.
2. Setelah perubahan ini ada di branch `main` GitHub, [deploy backend ke Render](https://render.com/deploy?repo=https://github.com/arumirawan358-hash/testing-aja), atau buka [Render Dashboard](https://dashboard.render.com/) dan pilih **New → Blueprint**. Hubungkan repository ini dan gunakan branch `main` yang berisi `render.yaml`. Berikan key baru secara privat pada nilai environment **`GROQ_API_KEY`** yang diminta Render, lalu deploy. Jika layanan/Blueprint sudah ada dan Render tidak meminta key, tambahkan atau perbarui `GROQ_API_KEY` di menu **Environment** layanan dan deploy ulang. Jangan simpan key di file `render.yaml`.
3. Setelah layanan aktif, salin **URL HTTPS publik** layanan, misalnya `https://nama-layanan.onrender.com` (tanpa `/api/groq/questions`). Membuka `URL/health` hanya memeriksa bahwa server hidup; itu **belum** membuktikan Groq berhasil merespons.
4. Di GitHub repository buka **Settings → Secrets and variables → Actions → Variables → New repository variable**. Buat variabel **`GROQ_API_URL`** dengan nilai URL HTTPS backend tersebut. Variabel ini adalah URL publik, **bukan** API key; nilainya masuk ke JavaScript situs. Key Groq tetap hanya di environment server Render.
5. Buka **Actions → Deploy KuisKita to GitHub Pages → Run workflow**, pilih `main`, lalu jalankan. Tunggu build dan deployment berhasil. Workflow juga berjalan otomatis saat `main` diperbarui. Pastikan **Settings → Pages → Source** menggunakan **GitHub Actions**.
6. Untuk uji sungguhan, jalankan **Actions → Uji Groq langsung → Run workflow** pada `main`. Workflow meminta satu soal melalui backend dan memeriksa format jawabannya tanpa memerlukan API key di GitHub. Periksa status dan langkah uji di log Actions. Selanjutnya buka [KuisKita](https://arumirawan358-hash.github.io/testing-aja/), pilih **Groq AI**, lalu coba satu soal dengan **Latihan sendiri**. Tes otomatis lokal menggunakan respons tiruan, bukan bukti respons Groq nyata.

Origin yang diizinkan di `render.yaml` adalah `https://arumirawan358-hash.github.io` (origin tanpa path). Sesuaikan `ALLOWED_ORIGINS` pada environment server jika domain situs berubah; beberapa origin dapat dipisahkan dengan koma. `GROQ_MODEL` dapat diubah di server jika model tersebut tidak tersedia pada akun, tetapi ketersediaan dan perilaku formatnya harus diuji ulang.

**Batas dan keamanan:** layanan gratis Render dapat tertidur dan membutuhkan waktu untuk bangun. Kuota/rate limit Groq dapat memperlambat atau menggagalkan pembuatan banyak soal. Backend membatasi ukuran input, permintaan per IP dan jumlah permintaan bersamaan, tetapi endpoint tetap publik: CORS **bukan autentikasi** dan dapat dipalsukan oleh klien non-browser. Pembatasan dalam memori juga tidak menjamin batas global di beberapa instance/restart. Untuk penggunaan publik yang lebih luas, tambahkan autentikasi/anti-abuse dan batas di gateway, pantau penggunaan serta atur batas biaya/kuota di Groq. API key tidak dikirim ke browser maupun kepada pemain lain.

### Variabel build lainnya

Variabel berikut dibaca saat **build**, bukan saat runtime:

- `VITE_BASE_PATH`: path situs, misalnya `/testing-aja/` di GitHub Pages, atau `/` pada root domain.
- `VITE_SIGNALING_MODE`: `local` (default, gunakan proxy yang disertakan) atau `cloud` (PeerJS Cloud).
- `VITE_GROQ_API_URL`: URL HTTPS backend publik; workflow Pages mengisinya dari repository variable `GROQ_API_URL`.
- `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`: opsional untuk PeerServer sendiri saat mode `cloud`.
- `VITE_TURN_URLS` (dipisahkan koma), `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`: opsional untuk mengganti relay publik.

Semua variabel `VITE_` tertanam pada JavaScript yang dapat dilihat publik. **Jangan memasukkan kunci API atau kredensial TURN privat jangka panjang ke dalamnya.** Untuk TURN privat di produksi, sediakan kredensial sementara dari layanan backend yang aman.
