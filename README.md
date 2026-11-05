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
- **Gemini AI** membuat soal baru sesuai jenjang, kelas, dan mata pelajaran menggunakan Gemini 2.5 Flash. Pembuat ruang perlu memasukkan [Gemini API key dari Google AI Studio](https://aistudio.google.com/app/apikey). Kunci disimpan hanya di memori browser selama sesi, dikirim langsung ke Google melalui HTTPS, dan tidak dikirim kepada pemain lain atau disimpan di repositori. Kuota, ketersediaan model, dan kemungkinan biaya mengikuti akun Google pemilik kunci. Jumlah besar dibuat bertahap sehingga membutuhkan lebih banyak waktu dan kuota. Tamu tidak membutuhkan kunci.

AI dapat membuat kesalahan. Periksa soal dan pembahasan dengan guru atau sumber tepercaya; aplikasi ini bukan pengganti penilaian resmi sekolah.

## Menjalankan di komputer sendiri

Persyaratan: Node.js 20 atau lebih baru dan npm.

```bash
npm ci
npm run dev
```

Buka alamat yang ditampilkan Vite. Perintah ini menjalankan server penghubung PeerJS lokal dan situs Vite; browser mengakses keduanya melalui origin yang sama. Untuk build dan pratinjau produksi lokal:

```bash
npm run build
npm run preview
```

Uji otomatis:

```bash
npm test
```

## GitHub Pages

Workflow `.github/workflows/deploy.yml` sudah menyiapkan build, pengujian, dan deployment ke GitHub Pages. Pada repositori GitHub:

1. Buka **Settings → Pages**.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**. Pastikan GitHub Actions diizinkan untuk repositori.
3. Jalankan workflow **Deploy KuisKita to GitHub Pages** dari tab **Actions**, atau gabungkan perubahan ini ke `main` agar push memicu workflow.
4. Setelah workflow berhasil, buka alamat yang ditampilkan pada tab Pages. Untuk repositori ini alamat yang diharapkan adalah `https://arumirawan358-hash.github.io/testing-aja/`.

Mode GitHub Pages tidak memerlukan server aplikasi milik sendiri: halaman statis menggunakan **PeerJS Cloud** untuk mempertemukan pemain dan koneksi **WebRTC** untuk mengirim data permainan. STUN dan relay TURN publik digunakan bila diperlukan. Layanan pihak ketiga tersebut dan jaringan masing-masing pemain memengaruhi ketersediaan; jaringan yang membatasi WebRTC, STUN, atau TURN dapat menghalangi koneksi. Untuk layanan yang lebih andal, sediakan PeerServer dan TURN sendiri.

### Pengaturan deployment alternatif

Variabel berikut dibaca saat **build**, bukan saat runtime:

- `VITE_BASE_PATH`: path situs, misalnya `/testing-aja/` di GitHub Pages, atau `/` pada root domain.
- `VITE_SIGNALING_MODE`: `local` (default, gunakan proxy yang disertakan) atau `cloud` (PeerJS Cloud).
- `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`: opsional untuk PeerServer sendiri saat mode `cloud`.
- `VITE_TURN_URLS` (dipisahkan koma), `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`: opsional untuk mengganti relay publik.

Semua variabel `VITE_` tertanam pada JavaScript yang dapat dilihat publik. **Jangan memasukkan kunci API atau kredensial TURN privat jangka panjang ke dalamnya.** Untuk TURN privat di produksi, sediakan kredensial sementara dari layanan backend yang aman.
