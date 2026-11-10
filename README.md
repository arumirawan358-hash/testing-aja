# KuisKita ✦

Kuis belajar SD, SMP, dan SMA: bermain sendiri atau berdua jarak jauh, dengan **1–500 soal**, nilai, dan pembahasan setelah selesai.

**Mainkan:** https://arumirawan358-hash.github.io/testing-aja/

## Cara bermain

1. Buka KuisKita dan isi nama, jenjang, kelas, mata pelajaran, jumlah soal, dan jika perlu topik khusus. Untuk pelajaran lain, pilih **Lainnya (khusus AI)**.
2. **Groq AI** dipilih secara awal. Untuk membuat soal AI, pemain solo atau pembuat ruang memasukkan API key miliknya di formulir. Buat key di [Groq Console](https://console.groq.com/keys); jangan kirim key lewat chat atau simpan di repository.
3. Pilih **Latihan sendiri** atau **Buat ruang**. Jika berdua, bagikan kode/tautan kepada teman. Teman hanya mengisi nama dan kode ruang—**tidak perlu API key**. Setelah teman bergabung, pembuat ruang menekan **Mulai permainan**.
4. Jawab atau lewati setiap soal. Dalam permainan berdua, hasil dan pembahasan muncul setelah kedua pemain selesai. Jika koneksi terputus setelah soal dimulai, kedua pemain tetap dapat menjawab; aplikasi mencoba menyambung kembali dan menyinkronkan progres serta hasil. Jawaban hanya tersimpan sementara di tab: **jangan tutup atau muat ulang halaman**. Hasil bersama memerlukan kedua pemain tetap berada di ruang dan koneksi kembali.
5. Pada hasil, pilih **Main lagi** untuk soal baru dengan pengaturan yang sama. Untuk permainan berdua, kedua pemain dapat membaca pembahasan dahulu dan masing-masing memilih **Main lagi**; mereka kembali ke ruang dan pembuat ruang memulai ronde berikutnya. Kunci tidak perlu dimasukkan ulang selama tetap di ruang yang sama.

Pilih **Bank soal** bila ingin mencoba tanpa API key. Bank soal non-matematika jumlahnya terbatas dan bisa berulang, terutama saat meminta banyak soal.

## Profil dan pengaturan

- Klik ikon **Profil** di bagian atas untuk mengubah nama panggilan, memilih **avatar**, dan melihat kartu profil: rank, poin kepintaran, winrate, dan kepintaran (akurasi). Nama yang disimpan otomatis mengisi formulir pemain berikutnya. Profil dan statistik tidak disinkronkan antarperangkat dan hilang jika data situs dihapus; tidak diperlukan akun.
- Dalam permainan berdua, ringkasan profil saling dikirim langsung antar pemain. Klik tombol **Profil** di kartu pemain (ruang tunggu maupun layar hasil) untuk melihat profil teman, termasuk rank dan winrate-nya.
- Klik ikon **Pengaturan** untuk mengatur efek suara dan membuka **Tentang web**. Pengaturan berlaku di browser ini dan dapat diubah saat kuis berlangsung.

## Rank kepintaran dan animasi juara

- Setiap permainan menambah **poin kepintaran**: 10 poin per jawaban benar, bonus menang +30 / seri +15 / kalah +5, dan bonus +20 bila semua jawaban benar.
- Poin menentukan kelas rank: **Tunas Bintang** (0), **Bintang Muda** (100), **Bintang Terang** (300), **Bintang Cemerlang** (700), **Bintang Gemilang** (1500), **Bintang Agung** (2500), dan **Galaksi Cendekia** (4000). Semakin tinggi rank, semakin meriah efek "bling" lencananya — efek ini terlihat oleh pemain lain saat mereka membuka profilmu.
- **Winrate** dihitung dari permainan berdua (menang / (menang + seri + kalah)), dan **kepintaran** adalah persentase jawaban benar dari seluruh soal yang pernah dijawab di perangkat itu.
- Pada layar hasil, pemenang ronde dirayakan dengan **animasi juara**: konfeti, piala, dan nama pemenang. Tidak ada animasi juara saat skor berakhir seri.

## Soal Groq dan variasi

- Kuis menggunakan model `openai/gpt-oss-120b` melalui Groq Chat Completions. Soal diminta berdasarkan jenjang, kelas, pelajaran, topik, dan jumlah yang dipilih. Soal dibuat bertahap, awalnya maksimum 8 per permintaan, dan ukuran batch otomatis diperkecil jika Groq menolak permintaan yang terlalu besar. Jawaban diacak dengan tetap menjaga indeks jawaban yang benar.
- Aplikasi memvalidasi struktur dan menolak soal dengan teks yang sama, termasuk yang baru dibuat pada batch sebelumnya dan riwayat terbaru dalam tab tersebut. Riwayat dibatasi hingga 1.000 teks soal per kombinasi pengaturan, untuk maksimal 10 kombinasi, dan hilang saat halaman ditutup atau dimuat ulang. Randomisasi dan riwayat membantu variasi; **AI tetap dapat mengulang konsep atau memparafrasekan soal**, dan tidak ada jaminan soal selalu berbeda atau selalu benar. Periksa pembahasan dengan guru atau sumber tepercaya.
- Groq memiliki batas permintaan, token, kuota, dan kemungkinan biaya sesuai paket akun. Pembuatan 500 soal memerlukan banyak permintaan dan dapat memakan waktu, terkena batas kuota, atau gagal. Dalam ruang berdua, batch yang sudah dibuat disimpan sementara di tab host untuk melanjutkan setelah kegagalan; jangan tutup atau muat ulang tab jika ingin melanjutkan. Jika kuota habis, tunggu atau periksa [batas akun Groq](https://console.groq.com/settings/limits). Topik yang terlalu sempit juga dapat menyulitkan pembuatan banyak soal berbeda.
- Hanya host membuat soal. Paket dikirim dalam potongan kecil, diperiksa, dan dikirim ulang bila perlu. Kuis mulai otomatis setelah teman menerima paket yang sama. Jika koneksi terputus sebelum mulai, host mempertahankan soal yang sudah disiapkan selama tab tetap terbuka dan akan mengirimkannya saat teman kembali.

## Keamanan dan privasi

- Situs ini statis dan **tidak membutuhkan Render atau server Groq milik pengelola**. Browser pemain solo/pembuat ruang mengirim key langsung ke `https://api.groq.com` melalui HTTPS dalam header `Authorization`, bersama pengaturan kuis yang diperlukan untuk membuat soal.
- Aplikasi menyimpan key sementara di memori tab selama sesi (termasuk saat main ulang) dan menghapus rujukannya saat keluar. Aplikasi tidak sengaja menyimpan key di localStorage, sessionStorage, URL, repository, atau pesan permainan kepada teman. Nama profil, statistik kuis lokal, dan preferensi pengaturan disimpan di localStorage browser.
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
