# 👟 eCom Tracking System

Aplikacija za praćenje porudžbina, finansija i popisa patika.

## 📚 Dokumentacija

👉 **Pogledaj `DEPLOYMENT.md` za kompletno uputstvo za postavljanje online.**

## 🛠 Tehnologija
- **React 18** + Vite
- **Supabase** — cloud baza i realtime sync
- **SheetJS (xlsx)** — Excel export

## 👥 Korisnici
- **Peconi** (admin) — pun pristup
- **Filip** (worker) — porudžbine, finansije, popis (pregled)
- **Mirela** (worker) — porudžbine, finansije, popis (pregled)

## 🚀 Start lokalno

```bash
npm install
cp .env.example .env.local
# popuni .env.local sa Supabase URL i key
npm run dev
```

Otvori http://localhost:3000
