/**
 * Sales-page copy, kept next to the page rather than in src/lib/i18n.
 *
 * The shared dictionaries are UI strings — short labels the whole app reads.
 * This is long-form prose on its own schedule that nothing else imports;
 * putting it there would drown the labels. One file, three languages.
 *
 * Ground rules for anything written here: every capability listed is one the
 * product actually has, the figures on the page come from the API (never from
 * this file), and prices come from ../_plans.ts so the home page, the pricing
 * page and the checkout cannot disagree.
 */

export type Lang = "en" | "az" | "ru";

export interface Feature {
  title: string;
  body: string;
}
export interface Step {
  marker: string;
  title: string;
  body: string;
}
export interface Role {
  name: string;
  body: string;
}
export interface Faq {
  q: string;
  a: string;
}
export interface Integration {
  name: string;
  desc: string;
}
/** A hackathon run on HackOS, shown with its organisers' logo (public/logos). */
export interface UsedBy {
  logo: "azcon" | "holberton";
  name: string;
  hosts: string;
  meta: string;
  blurb: string;
}

export interface LandingCopy {
  hero: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    body: string;
    ctaPrimary: string;
    ctaSecondary: string;
    trust: string;
  };
  usedBy: { eyebrow: string; title: string; body: string; items: UsedBy[] };
  /** Labels for the figures GET /api/public/stats returns. */
  stats: { events: string; participants: string; teams: string; projects: string; caption: string };
  /** Long paragraph whose words light up as it scrolls past. */
  manifesto: { chapter: string; text: string };
  features: { eyebrow: string; title: string; body: string; items: Feature[] };
  preview: { eyebrow: string; title: string; body: string; cta: string; bullets: string[] };
  roles: { eyebrow: string; title: string; body: string; items: Role[] };
  /** Short mono labels under each role in the roles diagram (same order as roles.items). */
  roleTags: string[];
  how: { eyebrow: string; title: string; body: string; items: Step[] };
  integrations: { eyebrow: string; title: string; body: string; items: Integration[] };
  pricing: {
    eyebrow: string;
    title: string;
    body: string;
    perEvent: string;
    annual: string;
    perEventUnit: string;
    annualUnit: string;
    /** "{n}" is the number. */
    upTo: string;
    seats: string;
    eventsYear: string;
    oneEvent: string;
    taglines: { starter: string; professional: string; business: string };
    /** "{plan}" is the plan's name. */
    choose: string;
    compare: string;
    enterpriseBody: string;
    enterpriseCta: string;
    note: string;
  };
  faq: { eyebrow: string; title: string; items: Faq[] };
  contact: {
    eyebrow: string;
    title: string;
    body: string;
    cta: string;
    secondary: string;
    mailSubject: string;
  };
  ui: { faqMore: string; privacy: string; plans: string };
}

const en: LandingCopy = {
  hero: {
    eyebrow: "Hackathon management platform",
    title: "Run your hackathon on software",
    titleAccent: "built for it.",
    body: "Registration, teams, mentors, judging, results and certificates — one platform instead of six spreadsheets and a group chat. Organisers, judges, mentors, participants and volunteers each work in their own view of the same event.",
    ctaPrimary: "See plans and prices",
    ctaSecondary: "Open the live walkthrough",
    trust: "Used at AZCON Future Tech 2026 and at Holberton School Azerbaijan",
  },
  usedBy: {
    eyebrow: "In use",
    title: "Hackathons already run on HackOS",
    body: "Real events with real organisers — these ran on the platform.",
    items: [
      {
        logo: "azcon",
        name: "AZCON Future Tech: Transport, Telecom & AI Challenge",
        hosts: "AZCON Holding × Holberton School Azerbaijan",
        meta: "25–27 April 2026 · 48 hours · Baku",
        blurb: "Students built working prototypes for real challenges set by AZCON Holding's transport, telecom and AI companies, and pitched them on the final day.",
      },
      {
        logo: "holberton",
        name: "Holberton School Azerbaijan internal hackathon",
        hosts: "Holberton School Azerbaijan",
        meta: "In-school event · Baku",
        blurb: "A hackathon for Holberton School Azerbaijan's own students, run on HackOS.",
      },
    ],
  },
  stats: {
    events: "Events run",
    participants: "Participants registered",
    teams: "Teams formed",
    projects: "Projects submitted",
    caption: "Counted from the database and refreshed every ten minutes — not typed in by hand.",
  },
  manifesto: {
    chapter: "Why HackOS",
    text: "A hackathon should not run on six spreadsheets and a group chat. We built one system where registration, teams, judging and results know about each other, every role sees only what it needs, and the event keeps its own clock.",
  },
  features: {
    eyebrow: "Modules",
    title: "Everything the event needs, in one system",
    body: "Each part knows what phase the event is in and what the others are doing. Your plan switches modules on — nothing is bolted on.",
    items: [
      {
        title: "Registration and approval",
        body: "A public event page with your own form fields, file uploads, a capacity and a waiting list. Approve people one by one or in bulk.",
      },
      {
        title: "Teams",
        body: "Join codes and invitations, size limits, a looking-for-team pool with suggestions, and organiser assignment for anyone left out.",
      },
      {
        title: "Submissions",
        body: "Files and links per team with an enforced deadline, and a GitHub check that flags repositories created before the event.",
      },
      {
        title: "Judging",
        body: "Weighted criteria, assignment modes, conflict-of-interest declarations, blind scoring, a presenter timer and elimination rounds.",
      },
      {
        title: "Results and certificates",
        body: "Publish results with the visibility you choose, then send PDF certificates anyone can verify by their code.",
      },
      {
        title: "Communication",
        body: "Announcements by e-mail and Telegram, an event chat with moderation, a mentor help queue and a notification bell for everyone.",
      },
    ],
  },
  preview: {
    eyebrow: "The workspace",
    title: "One console for the whole programme",
    body: "Participants, teams, submissions, judging, the help queue and analytics in one place, with search and a command palette so nothing is more than a few keys away.",
    cta: "Open the live walkthrough",
    bullets: [
      "Command palette (⌘K) across the console",
      "Live dashboard: registrations, help requests, judging progress",
      "Role-based access, enforced on the server",
      "CSV export and the whole event as a ZIP archive",
    ],
  },
  roles: {
    eyebrow: "Access",
    title: "Five roles, one event, separate doors",
    body: "Each role gets its own interface and its own permissions, enforced on the server. A judge cannot open the organiser dashboard, a mentor sees only the teams in their event, a participant sees only their own team.",
    items: [
      { name: "Organiser", body: "Runs the event end to end and sees everything." },
      { name: "Judge", body: "Their assigned projects and the scoring sheet." },
      { name: "Mentor", body: "The help queue and the teams they support." },
      { name: "Participant", body: "Their team, their submission, the announcements." },
      { name: "Volunteer", body: "The task list assigned to them." },
    ],
  },
  roleTags: ["Everything", "Scoring", "Help queue", "Own team", "Tasks"],
  how: {
    eyebrow: "How it works",
    title: "From order to final scores",
    body: "No sales call needed to start. Choose a plan, and the platform is yours as soon as we confirm the order.",
    items: [
      { marker: "01", title: "Choose a plan", body: "Pay per event or for a year; every order comes with an invoice." },
      { marker: "02", title: "Set up", body: "We confirm the order and e-mail a setup link: your organisation, logo, colours and teammates." },
      { marker: "03", title: "Create", body: "Build the event in a guided builder with templates, then share its public page and registration form." },
      { marker: "04", title: "Run", body: "Approvals, teams, mentors, chat, judging, results and certificates — all from one console." },
    ],
  },
  integrations: {
    eyebrow: "Connects to",
    title: "It reaches people where they already are",
    body: "Announcements go out by e-mail and to Telegram, dates land in people's calendars, and your data comes out as CSV or a full archive when you need it elsewhere.",
    items: [
      { name: "Telegram", desc: "Announcements to a channel and personal notifications" },
      { name: "E-mail", desc: "Confirmations, announcements and certificates, in the event's language" },
      { name: "Google Calendar", desc: "Add-to-calendar buttons and a personal calendar feed" },
      { name: "CSV and ZIP", desc: "Participants, teams and submissions; the whole event as an archive" },
    ],
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Priced per organisation: participants are never charged",
    body: "Higher plans add modules and raise the limits. Prices in manat.",
    perEvent: "Per event",
    annual: "Annual",
    perEventUnit: "per event",
    annualUnit: "per year",
    upTo: "Up to {n} participants",
    seats: "{n} organiser seats",
    eventsYear: "Up to {n} events a year",
    oneEvent: "One event",
    taglines: {
      starter: "For a first hackathon or a club event",
      professional: "For universities and regular programmes",
      business: "For large and multi-track programmes",
    },
    choose: "Choose {plan}",
    compare: "Compare all plans",
    enterpriseBody: "Enterprise: no limits on events or participants, your own domain or your own servers — quoted for your programme.",
    enterpriseCta: "Talk to us",
    note: "{vat}. Every order comes with an invoice.",
  },
  faq: {
    eyebrow: "Questions",
    title: "Before you ask",
    items: [
      {
        q: "How quickly can we start?",
        a: "Order a plan and we confirm it; the setup link arrives by e-mail. Creating an event in the builder takes one sitting, and its public page and registration form are ready to share as soon as you publish.",
      },
      {
        q: "Which languages does it support?",
        a: "The whole interface is in Azerbaijani, English and Russian, switchable by each person. E-mails to participants go out in the event's language.",
      },
      {
        q: "Do participants need to install anything?",
        a: "No. Everything runs in the browser, on a phone as well as a laptop. Telegram is optional.",
      },
      {
        q: "What happens to our data after the event?",
        a: "Once the event is over it is archived (automatically, 14 days after its end): everything stays readable and nothing can be changed. You can download the whole event as a ZIP — CSV files plus uploads — at any time.",
      },
      {
        q: "How is participant data protected?",
        a: "Every organisation's data is kept apart, and every role is checked on the server, not just hidden in the interface. Accounts confirm their e-mail address. The privacy policy explains what is stored and why.",
      },
      {
        q: "Can we use our own domain or our own servers?",
        a: "Yes, on the Enterprise plan: the platform runs on your domain and, if you prefer, on your own infrastructure.",
      },
    ],
  },
  contact: {
    eyebrow: "Contact",
    title: "Tell us about your event",
    body: "Send us the dates, the expected number of participants and how you judge, and we will come back with the plan that fits and a walkthrough of the platform.",
    cta: "Write to us",
    secondary: "See the plans",
    mailSubject: "HackOS — enquiry about running our event",
  },
  ui: { faqMore: "More questions? Write to us.", privacy: "Read the privacy policy", plans: "See all plans" },
};

const az: LandingCopy = {
  hero: {
    eyebrow: "Hackathon idarəetmə platforması",
    title: "Hackathonunu bunun üçün qurulmuş",
    titleAccent: "proqramla apar.",
    body: "Qeydiyyat, komandalar, mentorlar, qiymətləndirmə, nəticələr və sertifikatlar — altı Excel faylı və qrup çatı əvəzinə bir platforma. Təşkilatçı, hakim, mentor, iştirakçı və könüllü — hər biri eyni tədbirin öz görüntüsündə işləyir.",
    ctaPrimary: "Planlara və qiymətlərə bax",
    ctaSecondary: "Canlı nümayişi aç",
    trust: "AZCON Future Tech 2026-da və Holberton School Azerbaijan-da istifadə olunub",
  },
  usedBy: {
    eyebrow: "İstifadədə",
    title: "HackOS-da artıq keçirilmiş hackathonlar",
    body: "Real təşkilatçılar, real tədbirlər — bunlar platformada keçirilib.",
    items: [
      {
        logo: "azcon",
        name: "AZCON Future Tech: Transport, Telecom & AI Challenge",
        hosts: "AZCON Holding × Holberton School Azerbaijan",
        meta: "25–27 aprel 2026 · 48 saat · Bakı",
        blurb: "Tələbələr AZCON Holding-in nəqliyyat, telekommunikasiya və süni intellekt şirkətlərinin real tapşırıqları üçün işlək prototiplər qurdu və son gün təqdim etdi.",
      },
      {
        logo: "holberton",
        name: "Holberton School Azerbaijan daxili hackathonu",
        hosts: "Holberton School Azerbaijan",
        meta: "Məktəbdaxili tədbir · Bakı",
        blurb: "Holberton School Azerbaijan-ın öz tələbələri üçün hackathon, HackOS üzərində keçirilib.",
      },
    ],
  },
  stats: {
    events: "Keçirilmiş tədbir",
    participants: "Qeydiyyatdan keçən iştirakçı",
    teams: "Qurulmuş komanda",
    projects: "Təqdim olunmuş layihə",
    caption: "Bazadan sayılır və hər on dəqiqədən bir yenilənir — əl ilə yazılmayıb.",
  },
  manifesto: {
    chapter: "Niyə HackOS",
    text: "Hackathon altı Excel faylı və bir qrup çatı ilə idarə olunmamalıdır. Biz qeydiyyatın, komandaların, qiymətləndirmənin və nəticələrin bir-birindən xəbərdar olduğu, hər rolun yalnız ona lazım olanı gördüyü və tədbirin öz saatı ilə işlədiyi vahid sistem qurduq.",
  },
  features: {
    eyebrow: "Modullar",
    title: "Tədbirə lazım olan hər şey bir sistemdə",
    body: "Hər hissə tədbirin hansı mərhələdə olduğunu və digərlərinin nə etdiyini bilir. Modulları planın açır — heç nə sonradan yamaq kimi əlavə olunmayıb.",
    items: [
      {
        title: "Qeydiyyat və təsdiq",
        body: "Öz sahələrin, fayl yükləmə, yer limiti və gözləmə siyahısı ilə ictimai tədbir səhifəsi. İştirakçıları tək-tək və ya toplu təsdiqlə.",
      },
      {
        title: "Komandalar",
        body: "Qoşulma kodları və dəvətlər, ölçü limiti, təkliflərlə “komanda axtarıram” hovuzu və kənarda qalanı təşkilatçının özü komandaya salması.",
      },
      {
        title: "Layihə təqdimatları",
        body: "Komanda başına fayl və linklər, son tarix tətbiq olunur; GitHub yoxlaması tədbirdən əvvəl yaradılmış repozitoriyaları göstərir.",
      },
      {
        title: "Qiymətləndirmə",
        body: "Çəkili meyarlar, təyinat rejimləri, maraq toqquşması bəyannaməsi, kor qiymətləndirmə, təqdimat taymeri və eliminasiya mərhələləri.",
      },
      {
        title: "Nəticələr və sertifikatlar",
        body: "Nəticələri seçdiyin görünmə ilə dərc et, sonra hər kəsin kodu ilə yoxlaya biləcəyi PDF sertifikatlar göndər.",
      },
      {
        title: "Kommunikasiya",
        body: "E-poçt və Telegram ilə elanlar, moderasiyalı tədbir çatı, mentor kömək növbəsi və hər kəs üçün bildiriş zəngi.",
      },
    ],
  },
  preview: {
    eyebrow: "İş sahəsi",
    title: "Bütün proqram üçün bir konsol",
    body: "İştirakçılar, komandalar, təqdimatlar, qiymətləndirmə, kömək növbəsi və analitika bir yerdə — axtarış və komanda paleti ilə hər şey bir neçə düymə uzaqlığındadır.",
    cta: "Canlı nümayişi aç",
    bullets: [
      "Konsol üzrə komanda paleti (⌘K)",
      "Canlı panel: qeydiyyatlar, kömək sorğuları, qiymətləndirmənin gedişi",
      "Rol əsaslı giriş, serverdə yoxlanılır",
      "CSV ixracı və bütün tədbirin ZIP arxivi",
    ],
  },
  roles: {
    eyebrow: "Giriş",
    title: "Beş rol, bir tədbir, ayrı qapılar",
    body: "Hər rolun öz interfeysi və öz səlahiyyəti var, serverdə yoxlanılır. Hakim təşkilatçı panelini aça bilmir, mentor yalnız öz tədbirinin komandalarını görür, iştirakçı yalnız öz komandasını.",
    items: [
      { name: "Təşkilatçı", body: "Tədbiri baş-ayağa aparır və hər şeyi görür." },
      { name: "Hakim", body: "Ona təyin olunmuş layihələr və qiymətləndirmə vərəqi." },
      { name: "Mentor", body: "Kömək növbəsi və dəstək verdiyi komandalar." },
      { name: "İştirakçı", body: "Öz komandası, öz təqdimatı, elanlar." },
      { name: "Könüllü", body: "Ona təyin olunmuş tapşırıq siyahısı." },
    ],
  },
  roleTags: ["Hər şey", "Qiymətləndirmə", "Kömək növbəsi", "Öz komandası", "Tapşırıqlar"],
  how: {
    eyebrow: "Necə işləyir",
    title: "Sifarişdən son bala qədər",
    body: "Başlamaq üçün satış zəngi lazım deyil. Plan seç — sifarişi təsdiqləyən kimi platforma sənindir.",
    items: [
      { marker: "01", title: "Plan seç", body: "Tədbir başına və ya illik ödə; hər sifarişlə faktura gəlir." },
      { marker: "02", title: "Qur", body: "Sifarişi təsdiqləyirik və e-poçtla setup linki göndəririk: təşkilatın, loqon, rənglərin və həmkarların." },
      { marker: "03", title: "Yarat", body: "Tədbiri şablonlu bələdçi konstruktorda qur, sonra ictimai səhifəsini və qeydiyyat formunu paylaş." },
      { marker: "04", title: "Apar", body: "Təsdiqlər, komandalar, mentorlar, çat, qiymətləndirmə, nəticələr və sertifikatlar — hamısı bir konsoldan." },
    ],
  },
  integrations: {
    eyebrow: "Qoşulur",
    title: "İnsanlara onsuz da olduqları yerdə çatır",
    body: "Elanlar e-poçtla və Telegram-a gedir, tarixlər insanların təqviminə düşür, data isə başqa yerdə lazım olanda CSV və ya tam arxiv kimi çıxır.",
    items: [
      { name: "Telegram", desc: "Kanala elanlar və şəxsi bildirişlər" },
      { name: "E-poçt", desc: "Təsdiqlər, elanlar və sertifikatlar — tədbirin dilində" },
      { name: "Google Calendar", desc: "“Təqvimə əlavə et” düymələri və şəxsi təqvim lenti" },
      { name: "CSV və ZIP", desc: "İştirakçılar, komandalar və təqdimatlar; bütün tədbir arxiv kimi" },
    ],
  },
  pricing: {
    eyebrow: "Qiymət",
    title: "Təşkilat üzrə qiymət: iştirakçılardan pul alınmır",
    body: "Yuxarı planlar modul əlavə edir və limitləri artırır. Qiymətlər manatla.",
    perEvent: "Tədbir başına",
    annual: "İllik",
    perEventUnit: "tədbir başına",
    annualUnit: "ildə",
    upTo: "{n} iştirakçıya qədər",
    seats: "{n} təşkilatçı yeri",
    eventsYear: "İldə {n} tədbirə qədər",
    oneEvent: "Bir tədbir",
    taglines: {
      starter: "İlk hackathon və ya klub tədbiri üçün",
      professional: "Universitetlər və müntəzəm proqramlar üçün",
      business: "Böyük və çox istiqamətli proqramlar üçün",
    },
    choose: "{plan} seç",
    compare: "Bütün planları müqayisə et",
    enterpriseBody: "Enterprise: tədbir və iştirakçı limiti yoxdur, öz domenin və ya öz serverlərin — qiymət proqramına görə verilir.",
    enterpriseCta: "Bizimlə danış",
    note: "{vat}. Hər sifarişlə hesab-faktura verilir.",
  },
  faq: {
    eyebrow: "Suallar",
    title: "Soruşmazdan əvvəl",
    items: [
      {
        q: "Nə qədər tez başlaya bilərik?",
        a: "Plan sifariş edirsən, biz təsdiqləyirik və setup linki e-poçtla gəlir. Tədbiri konstruktorda bir oturuşda yaradırsan; dərc edən kimi ictimai səhifəsi və qeydiyyat formu paylaşmağa hazırdır.",
      },
      {
        q: "Hansı dilləri dəstəkləyir?",
        a: "Bütün interfeys Azərbaycan, ingilis və rus dilindədir, hər kəs özü dəyişə bilir. İştirakçılara məktublar tədbirin dilində gedir.",
      },
      {
        q: "İştirakçılar nəsə quraşdırmalıdır?",
        a: "Xeyr. Hər şey brauzerdə işləyir — həm noutbukda, həm telefonda. Telegram istəyə bağlıdır.",
      },
      {
        q: "Tədbirdən sonra datamız nə olur?",
        a: "Tədbir bitəndən sonra arxivlənir (avtomatik olaraq, bitişindən 14 gün sonra): hər şey oxunur, heç nə dəyişdirilə bilməz. Bütün tədbiri istənilən vaxt ZIP kimi — CSV faylları və yüklənmiş fayllarla — endirə bilərsən.",
      },
      {
        q: "İştirakçı datası necə qorunur?",
        a: "Hər təşkilatın datası ayrıca saxlanılır, hər rol yalnız interfeysdə gizlədilmir, serverdə yoxlanılır. Hesablar e-poçt ünvanını təsdiqləyir. Nəyin və niyə saxlandığını məxfilik siyasəti izah edir.",
      },
      {
        q: "Öz domenimizi və ya öz serverlərimizi işlədə bilərikmi?",
        a: "Bəli, Enterprise planında: platforma sənin domenində və istəsən öz infrastrukturunda işləyir.",
      },
    ],
  },
  contact: {
    eyebrow: "Əlaqə",
    title: "Tədbirin haqqında danış",
    body: "Tarixləri, gözlənilən iştirakçı sayını və qiymətləndirmə üsulunu yaz — sənə uyğun planı və platformanın canlı təqdimatını təklif edək.",
    cta: "Bizə yaz",
    secondary: "Planlara bax",
    mailSubject: "HackOS — tədbirimiz üçün sorğu",
  },
  ui: { faqMore: "Başqa sualınız var? Bizə yazın.", privacy: "Məxfilik siyasətini oxu", plans: "Bütün planlara bax" },
};

const ru: LandingCopy = {
  hero: {
    eyebrow: "Платформа управления хакатоном",
    title: "Проводите хакатон на софте,",
    titleAccent: "сделанном для этого.",
    body: "Регистрация, команды, менторы, оценка, результаты и сертификаты — одна платформа вместо шести таблиц и группового чата. Организатор, судья, ментор, участник и волонтёр работают каждый в своей части одного события.",
    ctaPrimary: "Тарифы и цены",
    ctaSecondary: "Открыть живую демонстрацию",
    trust: "Использовалась на AZCON Future Tech 2026 и в Holberton School Azerbaijan",
  },
  usedBy: {
    eyebrow: "В работе",
    title: "Хакатоны, уже проведённые на HackOS",
    body: "Настоящие события с настоящими организаторами — они прошли на платформе.",
    items: [
      {
        logo: "azcon",
        name: "AZCON Future Tech: Transport, Telecom & AI Challenge",
        hosts: "AZCON Holding × Holberton School Azerbaijan",
        meta: "25–27 апреля 2026 · 48 часов · Баку",
        blurb: "Студенты собрали работающие прототипы для реальных задач транспортных, телеком- и ИИ-компаний AZCON Holding и представили их в последний день.",
      },
      {
        logo: "holberton",
        name: "Внутренний хакатон Holberton School Azerbaijan",
        hosts: "Holberton School Azerbaijan",
        meta: "Внутреннее событие школы · Баку",
        blurb: "Хакатон для студентов самой Holberton School Azerbaijan, проведённый на HackOS.",
      },
    ],
  },
  stats: {
    events: "Проведено событий",
    participants: "Зарегистрировано участников",
    teams: "Собрано команд",
    projects: "Подано проектов",
    caption: "Считается по базе и обновляется каждые десять минут — не вписано вручную.",
  },
  manifesto: {
    chapter: "Почему HackOS",
    text: "Хакатон не должен держаться на шести таблицах и групповом чате. Мы сделали одну систему, где регистрация, команды, судейство и результаты знают друг о друге, каждая роль видит только то, что ей нужно, а мероприятие живёт по своим часам.",
  },
  features: {
    eyebrow: "Модули",
    title: "Всё, что нужно событию, в одной системе",
    body: "Каждая часть знает, в какой фазе событие и что делают остальные. Модули включает ваш тариф — ничего не прикручено сбоку.",
    items: [
      {
        title: "Регистрация и одобрение",
        body: "Публичная страница события со своими полями формы, загрузкой файлов, лимитом мест и листом ожидания. Одобряйте по одному или сразу пачкой.",
      },
      {
        title: "Команды",
        body: "Коды и приглашения, лимиты размера, пул «ищу команду» с подсказками и распределение организатором тех, кто остался без команды.",
      },
      {
        title: "Подача проектов",
        body: "Файлы и ссылки от команды с жёстким дедлайном и проверкой GitHub, которая помечает репозитории, созданные до события.",
      },
      {
        title: "Оценка",
        body: "Взвешенные критерии, режимы назначения, декларации конфликта интересов, слепая оценка, таймер выступлений и раунды отсева.",
      },
      {
        title: "Результаты и сертификаты",
        body: "Публикуйте результаты с нужной видимостью и отправляйте PDF-сертификаты, которые любой проверит по коду.",
      },
      {
        title: "Коммуникация",
        body: "Объявления по почте и в Telegram, чат события с модерацией, очередь помощи менторов и колокольчик уведомлений для всех.",
      },
    ],
  },
  preview: {
    eyebrow: "Рабочее пространство",
    title: "Одна консоль на всю программу",
    body: "Участники, команды, работы, судейство, очередь помощи и аналитика в одном месте — с поиском и командной палитрой, так что всё в паре нажатий.",
    cta: "Открыть живую демонстрацию",
    bullets: [
      "Командная палитра (⌘K) по всей консоли",
      "Живая панель: регистрации, заявки о помощи, ход оценки",
      "Ролевой доступ, проверяемый на сервере",
      "Выгрузка в CSV и всё событие ZIP-архивом",
    ],
  },
  roles: {
    eyebrow: "Доступ",
    title: "Пять ролей, одно событие, разные двери",
    body: "У каждой роли свой интерфейс и свои права, проверяемые на сервере. Судья не откроет панель организатора, ментор видит только команды своего события, участник — только свою команду.",
    items: [
      { name: "Организатор", body: "Ведёт событие целиком и видит всё." },
      { name: "Судья", body: "Назначенные проекты и лист оценки." },
      { name: "Ментор", body: "Очередь помощи и команды, которые он ведёт." },
      { name: "Участник", body: "Своя команда, своя работа, объявления." },
      { name: "Волонтёр", body: "Назначенный ему список задач." },
    ],
  },
  roleTags: ["Всё", "Оценки", "Очередь помощи", "Своя команда", "Задачи"],
  how: {
    eyebrow: "Как это работает",
    title: "От заказа до итоговых баллов",
    body: "Чтобы начать, не нужен звонок с продажами. Выберите тариф — платформа ваша, как только мы подтвердим заказ.",
    items: [
      { marker: "01", title: "Выберите тариф", body: "Оплата за событие или за год; к каждому заказу прилагается счёт." },
      { marker: "02", title: "Настройте", body: "Мы подтверждаем заказ и присылаем ссылку настройки: ваша организация, логотип, цвета и коллеги." },
      { marker: "03", title: "Создайте", body: "Соберите событие в пошаговом конструкторе с шаблонами и поделитесь его публичной страницей и формой регистрации." },
      { marker: "04", title: "Проведите", body: "Одобрения, команды, менторы, чат, оценка, результаты и сертификаты — всё из одной консоли." },
    ],
  },
  integrations: {
    eyebrow: "Подключается к",
    title: "Доходит до людей там, где они уже есть",
    body: "Объявления уходят по почте и в Telegram, даты попадают в календари людей, а данные выгружаются в CSV или полным архивом, когда нужны в другом месте.",
    items: [
      { name: "Telegram", desc: "Объявления в канал и личные уведомления" },
      { name: "E-mail", desc: "Подтверждения, объявления и сертификаты — на языке события" },
      { name: "Google Calendar", desc: "Кнопки «Добавить в календарь» и личная лента календаря" },
      { name: "CSV и ZIP", desc: "Участники, команды и работы; всё событие архивом" },
    ],
  },
  pricing: {
    eyebrow: "Цены",
    title: "За организацию: участники ничего не платят",
    body: "Старшие тарифы добавляют модули и поднимают лимиты. Цены в манатах.",
    perEvent: "За событие",
    annual: "На год",
    perEventUnit: "за событие",
    annualUnit: "в год",
    upTo: "До {n} участников",
    seats: "Мест организаторов: {n}",
    eventsYear: "До {n} событий в год",
    oneEvent: "Одно событие",
    taglines: {
      starter: "Для первого хакатона или клубного события",
      professional: "Для университетов и регулярных программ",
      business: "Для больших и многотрековых программ",
    },
    choose: "Выбрать {plan}",
    compare: "Сравнить все тарифы",
    enterpriseBody: "Enterprise: без лимитов на события и участников, ваш домен или ваши серверы — расчёт под вашу программу.",
    enterpriseCta: "Обсудить",
    note: "{vat}. К каждому заказу прилагается счёт.",
  },
  faq: {
    eyebrow: "Вопросы",
    title: "Прежде чем спросить",
    items: [
      {
        q: "Как быстро можно начать?",
        a: "Вы заказываете тариф, мы подтверждаем, и ссылка настройки приходит на почту. Событие в конструкторе создаётся за один заход; после публикации его страница и форма регистрации готовы к рассылке.",
      },
      {
        q: "Какие языки поддерживаются?",
        a: "Весь интерфейс на азербайджанском, английском и русском, каждый переключает сам. Письма участникам уходят на языке события.",
      },
      {
        q: "Нужно ли участникам что-то устанавливать?",
        a: "Нет. Всё работает в браузере — и на ноутбуке, и на телефоне. Telegram — по желанию.",
      },
      {
        q: "Что происходит с данными после события?",
        a: "После окончания событие уходит в архив (автоматически, через 14 дней после окончания): всё читается, ничего нельзя изменить. Всё событие можно скачать в ZIP — CSV и загруженные файлы — в любой момент.",
      },
      {
        q: "Как защищены данные участников?",
        a: "Данные каждой организации хранятся раздельно, а каждая роль проверяется на сервере, а не просто скрыта в интерфейсе. Аккаунты подтверждают адрес почты. Что и зачем хранится, объясняет политика конфиденциальности.",
      },
      {
        q: "Можно ли использовать свой домен или свои серверы?",
        a: "Да, на тарифе Enterprise: платформа работает на вашем домене и, если нужно, в вашей инфраструктуре.",
      },
    ],
  },
  contact: {
    eyebrow: "Контакты",
    title: "Расскажите о вашем событии",
    body: "Напишите даты, ожидаемое число участников и как вы оцениваете работы — предложим подходящий тариф и покажем платформу вживую.",
    cta: "Написать нам",
    secondary: "Посмотреть тарифы",
    mailSubject: "HackOS — запрос по нашему событию",
  },
  ui: { faqMore: "Остались вопросы? Напишите нам.", privacy: "Политика конфиденциальности", plans: "Все тарифы" },
};

export const LANDING_COPY: Record<Lang, LandingCopy> = { en, az, ru };
