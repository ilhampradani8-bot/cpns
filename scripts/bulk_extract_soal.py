#!/usr/bin/env python3
"""
Bulk Question Extractor for CPNS WhatsApp Bot & Website CBT.
Uses open-source PyMuPDF to extract text with 0 token AI cost.
"""

import os
import re
import json
import urllib.request
import pymupdf

DATA_DIR = '/root/CPNS/data'
PDF_DIR = os.path.join(DATA_DIR, 'pdf_raw')
CATALOG_PATH = os.path.join(DATA_DIR, 'gdrive_complete_database.json')
MASTER_OUTPUT = os.path.join(DATA_DIR, 'bank_soal_master.json')

os.makedirs(PDF_DIR, exist_ok=True)

def download_file(file_id, dest_path):
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000:
        return True
    url = f'https://drive.google.com/uc?export=download&id={file_id}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        content = urllib.request.urlopen(req, timeout=30).read()
        with open(dest_path, 'wb') as f:
            f.write(content)
        return True
    except Exception as e:
        print(f"[Error downloading {file_id}]: {e}")
        return False

def parse_soal_latihan(pdf_path, prefix_id):
    """
    Parser untuk format 'SOAL LATIHAN TWK-TIU-TKP (1-8)'
    Halaman awal: Soal 1-100
    Halaman akhir: Pembahasan TWK, TIU, dan Tabel Poin TKP
    """
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as e:
        print(f"Failed to open {pdf_path}: {e}")
        return []

    # Deteksi letak halaman kunci/pembahasan
    split_page = -1
    for pno in range(len(doc)):
        txt = doc[pno].get_text()
        if 'TES WAWASAN KEBANGSAAN' in txt and ('1. ' in txt or '1.' in txt) and ('HAM' in txt or 'Pancasila' in txt or 'UUD' in txt or 'Jawaban' in txt or '(' in txt):
            # Cek apakah ini pembahasan
            if 'pembahasan' in txt.lower() or 'jawaban' in txt.lower() or 'merupakan' in txt.lower() or '(a)' in txt.lower():
                split_page = pno
                break

    if split_page == -1:
        split_page = max(1, len(doc) - 5)

    text_soal = ''
    for i in range(split_page):
        text_soal += doc[i].get_text() + '\n'

    text_kunci = ''
    for i in range(split_page, len(doc)):
        text_kunci += doc[i].get_text() + '\n'

    # Clean headers
    text_soal = re.sub(r'INI HANYA SOAL LATIHAN', '', text_soal)
    text_kunci = re.sub(r'INI HANYA SOAL LATIHAN', '', text_kunci)

    # 1. Parse Kunci & Pembahasan TWK + TIU
    kunci_map = {}
    matches = list(re.finditer(r'(?:^|\n)\s*(\d+)[\.\)]\s*(.*?)(?=\n\s*\d+[\.\)]|\Z)', text_kunci, re.DOTALL))
    for m in matches:
        nomor = int(m.group(1))
        content = m.group(2).strip()
        ans_m = re.search(r'\(([A-E])\)', content) or re.search(r'Jawaban\s*:\s*([A-E])', content, re.I)
        ans = ans_m.group(1).upper() if ans_m else ''
        pembahasan = re.sub(r'\([A-E]\)', '', content)
        pembahasan = re.sub(r'Jawaban\s*:\s*[A-E]', '', pembahasan, flags=re.I).strip()
        kunci_map[nomor] = {'kunci': ans, 'pembahasan': pembahasan}

    # 2. Parse Tabel Poin TKP (biasanya di halaman terakhir)
    last_pages_text = '\n'.join([doc[p].get_text() for p in range(max(0, len(doc)-2), len(doc))])
    tkp_matches = re.findall(r'(\d{2,3})\s*\n\s*([A-E])\s*\n\s*([A-E])\s*\n\s*([A-E])\s*\n\s*([A-E])\s*\n\s*([A-E])', last_pages_text)
    for tm in tkp_matches:
        nomor = int(tm[0])
        p5, p4, p3, p2, p1 = tm[1], tm[2], tm[3], tm[4], tm[5]
        kunci_map[nomor] = {
            'kunci': p5,
            'skor_tkp': {'5': p5, '4': p4, '3': p3, '2': p2, '1': p1},
            'pembahasan': f'Skor TKP: Opsi {p5}=5 poin, {p4}=4 poin, {p3}=3 poin, {p2}=2 poin, {p1}=1 poin.'
        }

    # 3. Parse Soal
    soal_splits = list(re.finditer(r'(?:^|\n)\s*(\d+)[\.\)]\s*(.*?)(?=(?:\n\s*\d+[\.\)]|\Z))', text_soal, re.DOTALL))
    questions = []

    for m in soal_splits:
        nomor = int(m.group(1))
        body = m.group(2).strip()

        opts = {}
        opt_matches = list(re.finditer(r'(?:^|\n)\s*([A-E])[\.\)]\s*(.*?)(?=(?:\n\s*[A-E][\.\)]|\Z))', body, re.DOTALL))
        if opt_matches:
            pertanyaan = body[:opt_matches[0].start()].strip()
            for om in opt_matches:
                opts[om.group(1)] = om.group(2).strip()
        else:
            pertanyaan = body

        k_info = kunci_map.get(nomor, {'kunci': '', 'pembahasan': ''})

        if nomor <= 30:
            kategori = 'TWK'
        elif nomor <= 65:
            kategori = 'TIU'
        else:
            kategori = 'TKP'

        q_item = {
            'id': f'{prefix_id}_{nomor:03d}',
            'nomor': nomor,
            'kategori': kategori,
            'pertanyaan': re.sub(r'\s+', ' ', pertanyaan).strip(),
            'opsi': {k: re.sub(r'\s+', ' ', v).strip() for k, v in opts.items()},
            'kunci': k_info.get('kunci', ''),
            'pembahasan': re.sub(r'\s+', ' ', k_info.get('pembahasan', '')).strip()
        }
        if 'skor_tkp' in k_info:
            q_item['skor_tkp'] = k_info['skor_tkp']

        if q_item['pertanyaan'] and len(q_item['opsi']) >= 3:
            questions.append(q_item)

    return questions

def parse_simulasi(pdf_path, prefix_id):
    """
    Parser untuk format 'SIMULASI CPNS 2024-2025 (1-10)'
    Halaman awal: 110 Soal (TWK 1-30, TIU 31-65, TKP 66-110)
    Halaman akhir: Pembahasan lengkap (XX. Jawaban : X \n Pembahasan : ...)
    """
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as e:
        print(f"Failed to open {pdf_path}: {e}")
        return []

    split_page = -1
    for pno in range(len(doc)):
        txt = doc[pno].get_text()
        if 'kunci jawaban' in txt.lower() or 'pembahasan simulasi' in txt.lower() or ('jawaban :' in txt.lower() and 'pembahasan :' in txt.lower()):
            split_page = pno
            break

    if split_page == -1:
        split_page = max(1, len(doc) - 6)

    text_soal = '\n'.join([doc[p].get_text() for p in range(split_page)])
    text_kunci = '\n'.join([doc[p].get_text() for p in range(split_page, len(doc))])

    # Parse Kunci & Pembahasan
    kunci_map = {}
    k_matches = list(re.finditer(r'(?:^|\n)\s*(\d+)[\.\)]\s*Jawaban\s*:\s*([a-eA-E])\s*(?:Pembahasan\s*:\s*(.*?))(?=(?:\n\s*\d+[\.\)]\s*Jawaban|\Z))', text_kunci, re.DOTALL | re.I))
    for km in k_matches:
        nomor = int(km.group(1))
        ans = km.group(2).upper()
        pemb = km.group(3).strip()
        kunci_map[nomor] = {'kunci': ans, 'pembahasan': pemb}

    # Parse Soal
    soal_splits = list(re.finditer(r'(?:^|\n)\s*(\d+)[\.\)]\s*(.*?)(?=(?:\n\s*\d+[\.\)]|\Z))', text_soal, re.DOTALL))
    questions = []

    for m in soal_splits:
        nomor = int(m.group(1))
        body = m.group(2).strip()

        opts = {}
        opt_matches = list(re.finditer(r'(?:^|\n)\s*([A-Ea-e])[\.\)]\s*(.*?)(?=(?:\n\s*[A-Ea-e][\.\)]|\Z))', body, re.DOTALL))
        if opt_matches:
            pertanyaan = body[:opt_matches[0].start()].strip()
            for om in opt_matches:
                opts[om.group(1).upper()] = om.group(2).strip()
        else:
            pertanyaan = body

        k_info = kunci_map.get(nomor, {'kunci': '', 'pembahasan': ''})

        if nomor <= 30:
            kategori = 'TWK'
        elif nomor <= 65:
            kategori = 'TIU'
        else:
            kategori = 'TKP'

        q_item = {
            'id': f'{prefix_id}_{nomor:03d}',
            'nomor': nomor,
            'kategori': kategori,
            'pertanyaan': re.sub(r'\s+', ' ', pertanyaan).strip(),
            'opsi': {k: re.sub(r'\s+', ' ', v).strip() for k, v in opts.items()},
            'kunci': k_info.get('kunci', ''),
            'pembahasan': re.sub(r'\s+', ' ', k_info.get('pembahasan', '')).strip()
        }

        if q_item['pertanyaan'] and len(q_item['opsi']) >= 3:
            questions.append(q_item)

    return questions

def main():
    print("=== STARTING BULK QUESTION EXTRACTION ===")
    with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
        catalog = json.load(f)

    items = catalog.get('items', [])
    soal_files = [x for x in items if x.get('kategori_utama') == 'BANK_SOAL_SKD']
    print(f"Found {len(soal_files)} question bank PDF items in catalog.")

    all_master_questions = []

    for idx, sf in enumerate(soal_files, 1):
        name = sf['nama_file']
        fid = sf['id']
        safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', name)
        dest = os.path.join(PDF_DIR, safe_name)

        print(f"\n[{idx}/{len(soal_files)}] Processing: {name}")
        downloaded = download_file(fid, dest)
        if not downloaded:
            continue

        prefix = f"skd_set{idx}"
        if 'SOAL LATIHAN' in name.upper():
            parsed = parse_soal_latihan(dest, prefix)
        elif 'SIMULASI' in name.upper():
            parsed = parse_simulasi(dest, prefix)
        else:
            # Coba simulasi dulu, jika 0 coba parse_soal_latihan
            parsed = parse_simulasi(dest, prefix)
            if not parsed:
                parsed = parse_soal_latihan(dest, prefix)

        print(f" -> Extracted {len(parsed)} questions (With answer key: {sum(1 for q in parsed if q['kunci'])})")
        all_master_questions.extend(parsed)

    # Save to Master JSON
    result = {
        'total_soal': len(all_master_questions),
        'total_twk': sum(1 for q in all_master_questions if q.get('kategori') == 'TWK'),
        'total_tiu': sum(1 for q in all_master_questions if q.get('kategori') == 'TIU'),
        'total_tkp': sum(1 for q in all_master_questions if q.get('kategori') == 'TKP'),
        'questions': all_master_questions
    }

    with open(MASTER_OUTPUT, 'w', encoding='utf-8') as out:
        json.dump(result, out, indent=2, ensure_ascii=False)

    print("\n=== BULK EXTRACTION COMPLETED! ===")
    print(f"Master file saved: {MASTER_OUTPUT}")
    print(f"Total Soal: {result['total_soal']}")
    print(f"  - TWK: {result['total_twk']}")
    print(f"  - TIU: {result['total_tiu']}")
    print(f"  - TKP: {result['total_tkp']}")

if __name__ == '__main__':
    main()
