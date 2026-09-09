# תקציב הטיול - Trip Budget Tracker

אפליקציית מעקב הוצאות עצמאית לטיול, עם מסד נתונים משותף (Supabase) ו-URL קבוע (Vercel).
לא תלויה ב-Claude או בכל שירות אחר — הקוד והנתונים שלך לגמרי.

## מה יש כאן

- **Next.js 14** (App Router) + TypeScript — פרונטאנד פשוט, ריאקט
- **Supabase** (Postgres) — מסד נתונים, כולל realtime sync בין מכשירים
- **Vercel** — hosting חינמי, URL קבוע, דיפלוי אוטומטי מ-GitHub

---

## שלב 1: הקמת Supabase (5 דקות)

1. היכנס ל-[supabase.com](https://supabase.com) והתחבר (או הירשם, חינמי)
2. **New Project** → תן שם (למשל `trip-budget`), בחר סיסמה למסד הנתונים (שמור אותה), ובחר region קרוב (Europe)
3. המתן ~2 דקות שהפרויקט יוקם
4. בתפריט הצד: **SQL Editor** → **New query**
5. פתח את הקובץ `supabase-schema.sql` מהפרויקט הזה, העתק את כל התוכן, הדבק ב-SQL Editor, ולחץ **Run**
   - זה יוצר את טבלת `expenses` ומפעיל realtime
6. בתפריט הצד: **Project Settings** (⚙️) → **API**
   - העתק את **Project URL**
   - העתק את **anon public key** (לא את ה-`service_role` — זה חייב להישאר סודי)

## שלב 2: הרצה מקומית (אופציונלי, לבדיקה)

```bash
npm install
cp .env.local.example .env.local
# ערוך את .env.local והדבק את ה-URL וה-key מ-Supabase
npm run dev
```

פתח [http://localhost:3000](http://localhost:3000).

## שלב 3: דיפלוי ל-Vercel (5 דקות, URL קבוע)

1. צור repo חדש ב-GitHub והעלה את הקוד:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/trip-budget.git
   git push -u origin main
   ```
2. היכנס ל-[vercel.com](https://vercel.com) → **Add New** → **Project**
3. בחר את ה-repo `trip-budget` מ-GitHub
4. לפני שלוחצים Deploy: פתח **Environment Variables** והוסף:
   - `NEXT_PUBLIC_SUPABASE_URL` = ה-URL מ-Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = ה-anon key מ-Supabase
5. לחץ **Deploy**. אחרי כדקה תקבל URL קבוע כמו:
   `https://trip-budget-yourname.vercel.app`

**זהו — זה ה-URL הקבוע.** שתף אותו עם אשתך. שניכם נכנסים לאותו קישור, רואים ומעדכנים את אותה טבלה, בזמן אמת.

---

## איך זה עובד

- **Baseline** (טיסות, מלונות, ביטוח) — קבוע בקוד ב-`app/page.tsx`, בערך `BASELINE`. לעדכן: ערוך את המערך, `git commit`, `git push` — Vercel יעשה דיפלוי אוטומטי תוך דקה.
- **הוצאות שוטפות** — נשמרות ב-Supabase, כל שינוי (הוספה/עריכה/מחיקה) מתפרסם מיידית לכל המכשירים הפתוחים דרך Supabase Realtime.
- **בעלות מלאה** — אין תלות ב-Claude. גם אם תסגור את הצ'אט הזה, האתר ימשיך לפעול לצמיתות (כל עוד יש לך חשבון Supabase ו-Vercel, שניהם בחינם בהיקף השימוש הזה).

## עדכון ה-baseline (טיסות/מלונות)

פתח את `app/page.tsx`, מצא את המערך `BASELINE` בתחילת הקובץ, וערוך:

```ts
const BASELINE = [
  { label: 'טיסות (הלוך ושוב, שני נוסעים)', amount: 13563 },
  { label: 'מלון בנגקוק - Chatrium Grand (26-29.9, 3 לילות)', amount: 1814.77 },
  { label: 'מלון קו פנגן - Varivana Resort (10-13.9, 3 לילות)', amount: 1739.01 },
  { label: 'ביטוח נסיעות ובריאות (PassportCard)', amount: 1067.5 },
  // הוסף כאן שורות נוספות
];
```

שמור, `git add . && git commit -m "update baseline" && git push` — Vercel יפרסם אוטומטית.

## שינוי היעד/תקרת התקציב

באותו קובץ, למעלה:

```ts
const TARGET_BUDGET = 40000;
const CAP_BUDGET = 50000;
```

## אבטחה — הערה חשובה

הטבלה מוגדרת כרגע עם הרשאות פתוחות (כל אחד עם הקישור לאתר יכול לקרוא/לכתוב), כי זה נוח לשימוש בין שני אנשים בלי מערכת login. זה בסדר גמור לשימוש הזה, אבל:
- אל תשתף את ה-URL בפומבי (למשל ברשתות חברתיות)
- ה-`anon key` גלוי בצד הלקוח בכל מקרה (זה נורמלי ומתוכנן ב-Supabase) — ההגנה היחידה היא סודיות ה-URL עצמו
- אם בעתיד תרצה הרשאות אמיתיות (רק אתה ואשתך מחוברים), אפשר להוסיף Supabase Auth — תגיד לי ואני אוסיף
