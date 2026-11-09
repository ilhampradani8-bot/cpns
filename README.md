# Bot WhatsApp CPNS Hub (CRUD System)

Bot WhatsApp berbasis Baileys yang didedikasikan khusus untuk **Grup CPNS** dan **Testing Chat Pribadi**, fokus pada manajemen bank materi / catatan CPNS dengan fungsionalitas CRUD lengkap, penomoran urut otomatis, pemanggilan fleksibel (1-2 kata), serta penyimpanan data persisten anti-hilang.

---

## 🚀 Fitur Utama

1. **Akses Terbatas (Whitelist)**:
   - Hanya merespon grup CPNS yang telah didaftarkan.
   - Mendukung pendaftaran nomor pribadi untuk mode pengujian (test mode).
   - Chat dari grup/orang lain di luar whitelist diabaikan secara senyap.
2. **Sistem CRUD Bank Materi CPNS**:
   - **Create / Simpan**: Menyimpan materi baru dengan nomor urut otomatis.
   - **Read / Panggil**: Membuka materi dengan nama panggilan langsung (1-2 kata), via `panggil <nama>`, atau via nomor urut `panggil <nomor>`.
   - **Read List / Daftar**: Menampilkan seluruh judul materi yang terdata dengan format bernomor rapi.
   - **Update Nama**: Mengganti kata kunci / nama panggilan materi (`edit ... to ...`).
   - **Update Isi**: Menimpa isi materi dengan konten baru (`edit isi ... isi ...`).
   - **Delete / Hapus**: Menghapus materi dari database (`hapus ...`).
3. **Data Persisten & Anti Hilang**:
   - Disimpan secara lokal dalam file database JSON dengan mekanisme *atomic write* (mencegah korupsi data).
   - Backup otomatis dibuat setiap kali ada perubahan data ke folder `data/backups/`.

---

## 📋 Daftar Perintah (Format Chat WA)

| Perintah | Format Contoh | Deskripsi |
| :--- | :--- | :--- |
| **Registrasi Grup / Test** | `daftar cpns` | Ketik di grup untuk mendaftarkan grup CPNS, atau ketik di DM pribadi untuk testing. |
| **Simpan Catatan Teks** | `save (twk pancasila) isi (Pancasila adalah dasar filosofis...)` | Menyimpan materi baru berupa teks catatan. |
| **Simpan Berkas File (PDF/Foto)** | Kirim PDF/Foto/Doc dengan caption:<br>`save (modul twk)`<br>atau reply file lalu ketik:<br>`save (modul twk) isi (Keterangan file...)` | Mengunduh dan menyimpan berkas fisik (PDF, gambar, dokumen, dll) ke database server. |
| **Panggil Materi / File (Read)** | `twk pancasila`<br>atau `modul twk`<br>atau `panggil 1` | Menampilkan catatan teks atau **langsung mengirimkan berkas file aslinya**. |
| **Lihat Semua Materi (List)** | `daftar` atau `list` | Menampilkan seluruh materi & file terdata dengan ikon status (`📄`, `🖼️`, `📝`). |
| **Ubah Nama Panggilan** | `edit (twk pancasila) to (pilar kebangsaan)` | Mengubah nama panggilan dari yang lama ke yang baru. |
| **Ubah/Timpa Isi** | `edit isi (pilar kebangsaan) isi (Isi terbaru...)` | Menimpa isi teks/keterangan materi dengan penjelasan baru. |
| **Hapus Materi / File** | `hapus pilar kebangsaan`<br>atau `hapus 1` | Menghapus materi dari database (termasuk menghapus berkas fisik file dari server). |
| **Pengumuman Hidetag (Admin)** | `hidetag (isi pengumuman)`<br>atau reply pesan lalu ketik `hidetag` | Menandai (tagall) seluruh anggota grup CPNS untuk info penting. |
| **Bantuan / Menu** | `menu` atau `help` | Menampilkan panduan ringkas format perintah. |

---

## 🏃 Cara Menjalankan

### Mode 1: Login via Scan QR Code di Terminal
```bash
cd /root/CPNS
node index.js
```

### Mode 2: Login via Pairing Code (Tanpa Scan Kamera)
```bash
cd /root/CPNS
node index.js --pairing
```
Masukkan nomor WhatsApp bot saat diminta (contoh: `628123456789`), lalu masukkan kode pairing 8 digit di WhatsApp HP Anda (*Perangkat Tertaut > Tautkan dengan nomor telepon*).

