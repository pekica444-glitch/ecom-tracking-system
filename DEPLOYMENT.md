# 🚀 eCom Tracking System — Uputstvo za deployment

Ovo uputstvo te vodi kroz postavljanje aplikacije online preko **Supabase** (baza) + **GitHub** (kod) + **Vercel** (hosting).

Sve tri usluge su **besplatne** za vaš obim korišćenja.

---

## 📋 Pre nego što počneš

Treba ti:
- Nalog na [github.com](https://github.com) (besplatno)
- Nalog na [supabase.com](https://supabase.com) (besplatno)
- Nalog na [vercel.com](https://vercel.com) (besplatno — može se registrovati preko GitHub naloga)
- **Git** instaliran na računaru → [git-scm.com](https://git-scm.com/downloads)
- **Node.js** instaliran (za lokalni test) → [nodejs.org](https://nodejs.org) (verzija 18 ili novija)

---

## KORAK 1 — Supabase (baza podataka)

### 1.1 Kreiraj projekat
1. Idi na [supabase.com](https://supabase.com) → **Sign In** (preko GitHub ili email)
2. Klikni **New Project**
3. Popuni:
   - **Name:** `ecom-tracking`
   - **Database Password:** nešto jako, **zapamti ga** (nećeš ga koristiti direktno)
   - **Region:** `Central EU (Frankfurt)` — najbliži Srbiji
4. Klikni **Create new project** — pričekaj 1-2 min dok se ne napravi

### 1.2 Pokreni SQL šemu
1. Kad se projekat otvori, u levom meniju klikni **SQL Editor**
2. Klikni **New query**
3. **Otvori fajl `supabase-schema.sql`** iz ovog paketa, kopiraj sav sadržaj
4. Zalepi u SQL editor
5. Klikni **Run** (ili Ctrl+Enter)
6. Trebalo bi da piše `Success. No rows returned`

### 1.3 Omogući Realtime (BITNO!)
1. U levom meniju idi na **Database** → **Replication**
2. Nađi tabelu **app_state** u listi
3. Klikni toggle da uključiš Realtime za nju
4. (Alternativno, Realtime može već biti uključen automatski SQL skriptom)

### 1.4 Pokupi URL i API ključ
1. Idi na **Settings** (točkić) → **API**
2. Pronađi i sačuvaj ove vrednosti negde:
   - **Project URL** — izgleda kao `https://xxxxxxxxxxxxx.supabase.co`
   - **anon public** (API Keys sekcija) — dugačak JWT token tipa `eyJhbGci...`

**Ovo su ti `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY`** — trebaće ti u sledećim koracima.

---

## KORAK 2 — GitHub (hostovanje koda)

### 2.1 Kreiraj repository
1. Idi na [github.com](https://github.com) → **New repository**
2. **Repository name:** `ecom-tracking-system`
3. **Private** (da niko ne može da vidi tvoj kod)
4. **Ne** čekiraj "Add a README" — ostavi prazno
5. Klikni **Create repository**

### 2.2 Ubaci kod na GitHub (sa računara)

Otvori **Terminal** (Mac/Linux) ili **Command Prompt / PowerShell** (Windows) i uradi:

```bash
# Idi u folder gde su skinuti fajlovi (raspakovano iz zip-a)
cd putanja/do/ecom-deploy

# Inicijalizuj git
git init
git add .
git commit -m "Initial commit"

# Poveži sa GitHub repozitorijumom (zameni TVOJ-USERNAME)
git remote add origin https://github.com/TVOJ-USERNAME/ecom-tracking-system.git
git branch -M main
git push -u origin main
```

Ako pita za lozinku, moraćeš da napraviš **Personal Access Token** na GitHub-u:
- Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token
- Scope: čekiraj **repo**
- Kopiraj token i koristi ga umesto lozinke

---

## KORAK 3 — Vercel (hosting aplikacije)

### 3.1 Uveži projekat
1. Idi na [vercel.com](https://vercel.com) → **Sign Up / Log In** sa GitHub-om
2. Klikni **Add New...** → **Project**
3. U listi repozitorijuma nađi `ecom-tracking-system` i klikni **Import**

### 3.2 Podesi Environment Variables (BITNO!)
Pre nego što deploy-uješ, rastvori **Environment Variables** sekciju i dodaj:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | URL iz Supabase (korak 1.4) |
| `VITE_SUPABASE_ANON_KEY` | anon ključ iz Supabase (korak 1.4) |

### 3.3 Deploy
- Framework Preset: **Vite** (trebalo bi da se automatski prepozna)
- Klikni **Deploy**
- Čekaj 1-2 min

Dobićeš link tipa `https://ecom-tracking-system.vercel.app` — to je tvoja aplikacija online!

---

## 🎉 Gotovo!

Sad mogu Peconi, Filip i Mirela da pristupe aplikaciji sa bilo kog uređaja preko tog linka. Svi vide iste podatke u realnom vremenu.

### Dodaj na početni ekran telefona (PWA)
1. Otvori link u **Chrome/Safari** na telefonu
2. **Dodaj na početni ekran** (kod Android: meni ⋮ → "Add to Home screen", iPhone: deli ikonica → "Add to Home Screen")
3. Ikonica se pojavi kao obična aplikacija

---

## 🔄 Kako da ažuriraš aplikaciju kasnije

Kad hoćeš da izmeniš nešto u kodu (dodaš novu funkciju, promeniš izgled):

```bash
cd putanja/do/ecom-deploy
# napravi izmene u src/App.jsx
git add .
git commit -m "Opis izmena"
git push
```

Vercel automatski detektuje push i za 1-2 min aplikacija je updated online.

---

## 📂 Struktura fajlova u paketu

```
ecom-deploy/
├── src/
│   ├── App.jsx           ← Glavna aplikacija (Supabase verzija)
│   └── main.jsx          ← Entry point
├── index.html            ← HTML template
├── package.json          ← npm dependencies
├── vite.config.js        ← Vite konfiguracija
├── vercel.json           ← Vercel SPA routing
├── supabase-schema.sql   ← SQL za Supabase bazu
├── .env.example          ← Primer environment varijabli
├── .gitignore            ← Šta git ignoriše
└── DEPLOYMENT.md         ← Ovo uputstvo
```

---

## 🧪 Lokalno testiranje (opcionalno)

Pre deploy-a na Vercel, možeš testirati lokalno:

```bash
cd putanja/do/ecom-deploy

# Napravi kopiju .env.example i popuni je
cp .env.example .env.local
# Otvori .env.local i zameni vrednosti sa pravim URL i key

# Instaliraj dependencies
npm install

# Pokreni lokalno
npm run dev
```

Otvori http://localhost:3000

---

## 💾 Backup podataka

**Supabase besplatni plan čuva backup 7 dana automatski.** 

Za dodatni backup koristi dugme **📊 Excel izvoz** u aplikaciji (stranica "Više") — izvozi sve tabele u .xlsx. Preporučujem nedeljni manuelni backup.

---

## ⚠️ Sigurnosne napomene

- **Anon key** iz Supabase-a je bezbedan za client-side aplikaciju (dizajnirao ga Supabase za to)
- **NIKAD** ne commit-uj `.env.local` ili prave ključeve direktno u kod (`.gitignore` to već sprečava)
- **Lozinke korisnika** (Peconi/Filip/Mirela) su trenutno u samom kodu — ako treba jača sigurnost kasnije, možemo preći na Supabase Auth

---

## 📞 Pomoć

Ako negde zaglavi proces:
- **Supabase neće da se poveže:** proveri da li si stavio tačan URL i key u Vercel env variables
- **Vercel deploy fail-uje:** pogledaj Build Logs u Vercel dashboard-u, pošalji mi grešku
- **Podaci se ne sinhronizuju u realnom vremenu:** proveri da li je Realtime uključen za `app_state` tabelu u Supabase-u

Javi ako naiđeš na problem, pa ćemo rešiti!
