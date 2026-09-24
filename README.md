# Vazifalar menejeri

Login, admin paneli va SQLite ma'lumotlar bazasiga ega vazifalar boshqaruv sayti.

## Imkoniyatlar

- foydalanuvchi ro'yxatdan o'tishi va login qilishi;
- vazifa yaratish, tahrirlash, bajarilgan deb belgilash va o'chirish;
- prioritet va muddat belgilash;
- vazifalarni qidirish va holati bo'yicha filtrlash;
- dashboard statistikasi;
- admin panelida foydalanuvchilar va barcha vazifalarni ko'rish;
- parollarni `bcrypt` orqali xeshlash;
- SQLite bazasini avtomatik yaratish va eski sxemani migratsiya qilish.

## Ishga tushirish

```bash
npm install
npm start
```

Brauzerda `http://localhost:3000` manzilini oching.

## Demo hisoblar

- Admin: `admin@demo.com` / `admin123`
- User: `user@demo.com` / `user123`

## Muhim sozlama

Production muhitida sessiya kalitini environment variable orqali bering:

```bash
SESSION_SECRET="uzun-va-maxfiy-kalit" npm start
```

Lokal development uchun standart kalit ishlaydi, lekin production'da uni almashtirish shart.

## Internetga joylashtirish

Loyiha Render uchun tayyorlangan. Repository'ni GitHub'ga push qiling, Render'da **Blueprint** orqali repository'ni ulang va `render.yaml` faylini tanlang. Render avtomatik ravishda build, start command, health check va persistent disk sozlamalarini oladi.

Render'da `starter` plan persistent disk uchun ishlatiladi. Disk SQLite bazasi va login sessiyalarini server qayta ishga tushganda ham saqlab qoladi.

Health check manzili:

```text
/health
```