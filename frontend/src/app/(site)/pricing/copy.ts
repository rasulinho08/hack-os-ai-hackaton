/**
 * The pricing page's words, in three languages, kept next to the page like
 * the home page's copy (../welcome/copy.ts).
 *
 * Prices and limits are not written here: the page fills them in from
 * ../_plans.ts (the same numbers the checkout shows and the API copies into
 * an approved order), so "{n}", "{events}" and "{participants}" are slots.
 * What each plan includes follows the plan/module split agreed with the owner
 * (the API's src/constants/modules.js).
 */

export type Lang = "en" | "az" | "ru";
export type PlanId = "starter" | "professional" | "business" | "enterprise";

export interface TierCopy {
  tagline: string;
  best: string;
  support: string;
  includes: string[];
  /** The button of a plan without a listed price. */
  cta: string;
}

export interface PricingCopy {
  eyebrow: string;
  title: string;
  lead: string;
  billingLabel: string;
  perEvent: string;
  annual: string;
  annualHint: string;
  perEventHint: string;
  custom: string;
  quotedAnnually: string;
  quotedPerEvent: string;
  /** Under a price; the VAT words come from the seller's setting (vat.* in the i18n maps). */
  perYearUnit: string;
  perEventUnit: string;
  /** "{plan}" is the plan's name. */
  choose: string;
  /** "{who}" is the tier's audience. */
  bestFor: string;
  limitLabels: { events: string; participants: string; seats: string; support: string };
  /** "{n}" is the number from ../_plans.ts. */
  /** eventsYear / oneEvent fill the Business card's "{events}" by the billing period shown. */
  limitValues: { perYear: string; perEvent: string; unlimited: string; eventsYear: string; oneEvent: string };
  tiers: Record<PlanId, TierCopy>;
  note: string;
  compare: { eyebrow: string; title: string; lead: string; feature: string; included: string; notIncluded: string };
  /** Group title and row labels of the comparison table, by key (the page holds the values). */
  matrix: {
    event: { title: string; rows: Record<"registration" | "codes" | "teams" | "submissions" | "late" | "mentors" | "volunteers" | "forms" | "announcements" | "automations", string> };
    judging: { title: string; rows: Record<"weighted" | "normalisation" | "leaderboard" | "breakdown" | "stage" | "certificates" | "report", string> };
    /** eventsPerPurchase labels the events row when the table shows per-event prices. */
    workspace: { title: string; rows: Record<"events" | "seats" | "archive" | "roles", string>; eventsPerPurchase: string };
    platform: { title: string; rows: Record<"languages" | "csv" | "telegram" | "chat" | "branding" | "analytics" | "calendar" | "webhooks" | "domain" | "cloud", string> };
    support: { title: string; rows: Record<"email" | "onboarding" | "priority" | "named" | "sla", string> };
  };
  enterprise: { eyebrow: string; title: string; lead: string; contact: string; data: string; points: string[] };
  /**
   * The free Community plan for student clubs and non-commercial university
   * events: not sold, granted by the owner, so its button opens the contact
   * form. "{events}" and "{participants}" are filled in from the price list.
   */
  community: { name: string; free: string; title: string; body: string; points: string[]; cta: string };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  help: { title: string; body: string; walkthrough: string; contact: string };
}

const en: PricingCopy = {
  eyebrow: "Pricing",
  title: "Priced per organisation: participants are never charged",
  lead: "Every plan runs an event from registration to results. What changes is how many events and participants you can have, which modules come with it, how much support you want on the day, and whether the platform runs on our infrastructure or yours.",
  billingLabel: "Billing",
  perEvent: "Per event",
  annual: "Annual programme",
  annualHint: "The workspace stays open between events and past events stay browsable.",
  perEventHint: "You pay for the weekend and keep the archive afterwards.",
  custom: "Custom",
  quotedAnnually: "quoted annually",
  quotedPerEvent: "quoted per event",
  perYearUnit: "per year",
  perEventUnit: "per event",
  choose: "Choose {plan}",
  bestFor: "Best for: {who}",
  limitLabels: { events: "Events", participants: "Participants", seats: "Organiser seats", support: "Support" },
  limitValues: { perYear: "up to {n} / year", perEvent: "up to {n} per event", unlimited: "Unlimited", eventsYear: "Up to {n} events a year", oneEvent: "One event" },
  tiers: {
    starter: {
      tagline: "One hackathon, run properly.",
      best: "First-time organisers and single faculty events",
      support: "E-mail, 2 business days",
      includes: [
        "Organiser, judge and participant roles",
        "Registration, approvals and team formation",
        "Submissions with repo, demo and slides",
        "Weighted judging and leaderboard",
        "Announcements by e-mail and Telegram",
        "Certificates anyone can verify by code",
        "CSV export of participants",
      ],
      cta: "Get a quote",
    },
    professional: {
      tagline: "A few events a year, one workspace.",
      best: "Career centres and community organisers",
      support: "E-mail, next business day",
      includes: [
        "Everything in Starter",
        "Mentors with a help queue, and volunteers",
        "Custom registration forms and automatic announcements",
        "Presentations, elimination rounds and the big screen",
        "A post-event report (PDF) for your sponsors",
        "Your logo and colours on event pages, and advanced analytics",
        "Onboarding session for your team",
      ],
      cta: "Get a quote",
    },
    business: {
      tagline: "A programme, not a series of one-offs.",
      best: "Universities and companies running a calendar",
      support: "Priority on event days",
      includes: [
        "Everything in Professional",
        "Event chat with moderation",
        "Webhooks to your CRM and other systems",
        "Calendar feeds and add-to-calendar buttons",
        "{events}, {participants} participants per event",
        "Named contact during event days",
      ],
      cta: "Get a quote",
    },
    enterprise: {
      tagline: "Your infrastructure, your data, your domain.",
      best: "Public sector, banks, anyone with a procurement process",
      support: "Direct line, agreed response times",
      includes: [
        "Everything in Business",
        "Deployed in your cloud or on your servers",
        "Your own database, under your control",
        "Your domain and branding",
        "Security review and data-retention terms",
      ],
      cta: "Talk to us",
    },
  },
  note: "Prices are in manat; {vat}. Every order comes with an invoice, payable by bank transfer within 14 days of approval. Enterprise is quoted for your programme — and university and non-profit rates exist, so say which you are.",
  compare: {
    eyebrow: "Compare",
    title: "Everything, side by side",
    lead: "The full feature list. Where a plan shows a number rather than a tick, the number is the limit.",
    feature: "Feature",
    included: "Included",
    notIncluded: "Not included",
  },
  matrix: {
    event: {
      title: "Running the event",
      rows: {
        registration: "Registration and approvals",
        codes: "Invite codes and join links",
        teams: "Team formation with size limits",
        submissions: "Project submissions",
        late: "Late submission switch",
        mentors: "Mentor help queue",
        volunteers: "Volunteers and their tasks",
        forms: "Custom registration form fields",
        announcements: "Announcements with severity",
        automations: "Automatic announcements",
      },
    },
    judging: {
      title: "Judging and results",
      rows: {
        weighted: "Weighted criteria",
        normalisation: "Per-judge normalisation",
        leaderboard: "Leaderboard and podium",
        breakdown: "Per-criterion breakdown",
        stage: "Presentations, elimination rounds, big screen",
        certificates: "Certificates with public verification",
        report: "Post-event report (PDF) for sponsors",
      },
    },
    workspace: {
      title: "Workspace",
      rows: { events: "Events per year", seats: "Organiser seats", archive: "Archived events", roles: "Roles and permissions" },
      eventsPerPurchase: "Events per purchase",
    },
    platform: {
      title: "Platform",
      rows: {
        languages: "Azerbaijani, English, Russian",
        csv: "CSV export of participants",
        telegram: "Telegram announcements",
        chat: "Event chat with moderation",
        branding: "Your logo and colours on event pages",
        analytics: "Advanced analytics",
        webhooks: "Webhooks to your own systems",
        calendar: "Calendar feeds",
        domain: "Custom domain",
        cloud: "Runs in your own cloud",
      },
    },
    support: {
      title: "Support",
      rows: {
        email: "E-mail support",
        onboarding: "Onboarding session",
        priority: "Priority on event days",
        named: "Named contact",
        sla: "Agreed response times",
      },
    },
  },
  community: {
    name: "Community",
    free: "Free",
    title: "Free for student clubs and non-commercial university events",
    body: "Running a hackathon for your club or faculty, with no ticket sales and no sponsor fees? Tell us about it and we set up a Community workspace for you.",
    points: ["{events}", "Up to {participants} participants per event", "Everything in Starter, certificates included"],
    cta: "Apply",
  },
  enterprise: {
    eyebrow: "Enterprise",
    title: "Procurement, security review, your own cloud",
    lead: "Public bodies and banks have a process, and the process is the timeline. We answer security questionnaires, deploy into your tenancy, and put the retention terms in writing before anything is signed.",
    contact: "Contact sales",
    data: "How we handle data",
    points: [
      "Runs in your cloud account or on your servers",
      "Your database, your backups, your retention",
      "Unlimited organiser seats",
      "Custom domain and branding",
      "Security questionnaire answered in writing",
      "Agreed response times during event days",
    ],
  },
  faq: {
    eyebrow: "Questions",
    title: "About pricing",
    items: [
      {
        q: "What about VAT?",
        a: "{vat}. Prices are in manat, and every order comes with an invoice. Enterprise has no list price: it is quoted for your programme.",
      },
      {
        q: "What does 'per event' versus 'annual' change?",
        a: "Per event suits a one-off: you pay for the weekend and keep the archive. Annual suits a calendar: the workspace stays open between events and past events remain browsable.",
      },
      {
        q: "Can we start small and move up?",
        a: "Yes, and nothing is re-entered. The workspace is the same; the plan changes what it allows. Events already run stay exactly where they are.",
      },
      {
        q: "What happens to our data if we stop?",
        a: "You export it. Participants, teams and submissions come out as CSV from the interface, and on Enterprise the database was yours the whole time.",
      },
      {
        q: "Do participants or judges pay anything?",
        a: "No. Pricing is per organisation and nobody else pays. Judges, mentors and volunteers never count towards a limit; participants are counted per event, up to your plan's limit.",
      },
      {
        q: "Is there a discount for universities or non-profits?",
        a: "Yes. Say so when you get in touch and it will be reflected in the quote.",
      },
    ],
  },
  help: {
    title: "Not sure which plan fits?",
    body: "Open the workspace walkthrough and see what the platform actually does, then tell us the shape of your programme.",
    walkthrough: "Live walkthrough",
    contact: "Contact us",
  },
};

const az: PricingCopy = {
  eyebrow: "Qiymətlər",
  title: "Təşkilat üzrə qiymət: iştirakçılardan pul alınmır",
  lead: "Hər plan tədbiri qeydiyyatdan nəticələrə qədər aparır. Dəyişən odur ki, neçə tədbir və iştirakçın ola bilər, hansı modullar daxildir, tədbir günü nə qədər dəstək istəyirsən və platforma bizim, yoxsa sənin infrastrukturunda işləyir.",
  billingLabel: "Ödəniş",
  perEvent: "Tədbir başına",
  annual: "İllik proqram",
  annualHint: "İş sahəsi tədbirlər arasında açıq qalır, keçmiş tədbirlərə baxmaq olur.",
  perEventHint: "Həftəsonu üçün ödəyirsən, arxiv sonra da səndə qalır.",
  custom: "Fərdi",
  quotedAnnually: "illik qiymət təklifi ilə",
  quotedPerEvent: "tədbir üzrə qiymət təklifi ilə",
  perYearUnit: "ildə",
  perEventUnit: "tədbir başına",
  choose: "{plan} seç",
  bestFor: "Kimə uyğundur: {who}",
  limitLabels: { events: "Tədbirlər", participants: "İştirakçılar", seats: "Təşkilatçı yerləri", support: "Dəstək" },
  limitValues: { perYear: "ildə ən çox {n}", perEvent: "tədbir başına ən çox {n}", unlimited: "Limitsiz", eventsYear: "İldə ən çox {n} tədbir", oneEvent: "Bir tədbir" },
  tiers: {
    starter: {
      tagline: "Bir hackathon, layiqincə təşkil olunmuş.",
      best: "İlk dəfə təşkil edənlər və tək fakültə tədbirləri",
      support: "E-poçt, 2 iş günü",
      includes: [
        "Təşkilatçı, hakim və iştirakçı rolları",
        "Qeydiyyat, təsdiq və komanda qurulması",
        "Repozitoriya, demo və slaydlarla təqdimatlar",
        "Çəkili qiymətləndirmə və reytinq cədvəli",
        "E-poçt və Telegram ilə elanlar",
        "Hər kəsin kodla yoxlaya biləcəyi sertifikatlar",
        "İştirakçıların CSV ixracı",
      ],
      cta: "Qiymət təklifi al",
    },
    professional: {
      tagline: "İldə bir neçə tədbir, bir iş sahəsi.",
      best: "Karyera mərkəzləri və icma təşkilatçıları",
      support: "E-poçt, növbəti iş günü",
      includes: [
        "Starter-dəki hər şey",
        "Kömək növbəsi ilə mentorlar və könüllülər",
        "Fərdi qeydiyyat formları və avtomatik elanlar",
        "Təqdimatlar, eliminasiya mərhələləri və böyük ekran",
        "Sponsorlar üçün tədbirdən sonrakı hesabat (PDF)",
        "Tədbir səhifələrində sənin loqon və rənglərin, geniş analitika",
        "Komandan üçün başlanğıc təlimi",
      ],
      cta: "Qiymət təklifi al",
    },
    business: {
      tagline: "Ayrı-ayrı tədbirlər yox, bütöv proqram.",
      best: "Təqvim üzrə işləyən universitetlər və şirkətlər",
      support: "Tədbir günlərində prioritet",
      includes: [
        "Professional-dakı hər şey",
        "Moderasiyalı tədbir çatı",
        "CRM və digər sistemlərinə webhook-lar",
        "Təqvim lentləri və “Təqvimə əlavə et” düymələri",
        "{events}, tədbir başına {participants} iştirakçı",
        "Tədbir günlərində təyin olunmuş əlaqə şəxsi",
      ],
      cta: "Qiymət təklifi al",
    },
    enterprise: {
      tagline: "Sənin infrastrukturun, sənin datan, sənin domenin.",
      best: "Dövlət sektoru, banklar və satınalma prosesi olan hər kəs",
      support: "Birbaşa xətt, razılaşdırılmış cavab müddətləri",
      includes: [
        "Business-dəki hər şey",
        "Sənin buludunda və ya serverlərində quraşdırılır",
        "Öz bazan, tam sənin nəzarətində",
        "Öz domenin və brendin",
        "Təhlükəsizlik yoxlaması və datanın saxlanma şərtləri",
      ],
      cta: "Bizimlə danış",
    },
  },
  note: "Qiymətlər manatladır; {vat}. Hər sifarişlə hesab-faktura verilir, təsdiqdən sonra 14 gün ərzində bank köçürməsi ilə ödənilir. Enterprise qiyməti proqramına görə hesablanır — universitet və qeyri-kommersiya təşkilatları üçün xüsusi qiymətlər də var, kim olduğunu yaz.",
  compare: {
    eyebrow: "Müqayisə",
    title: "Hər şey yan-yana",
    lead: "İmkanların tam siyahısı. Planda işarə yerinə rəqəm görünürsə, o rəqəm limitdir.",
    feature: "İmkan",
    included: "Daxildir",
    notIncluded: "Daxil deyil",
  },
  matrix: {
    event: {
      title: "Tədbirin aparılması",
      rows: {
        registration: "Qeydiyyat və təsdiq",
        codes: "Dəvət kodları və qoşulma linkləri",
        teams: "Ölçü limiti ilə komanda qurulması",
        submissions: "Layihə təqdimatları",
        late: "Gecikmiş təqdimat açarı",
        mentors: "Mentor kömək növbəsi",
        volunteers: "Könüllülər və onların tapşırıqları",
        forms: "Qeydiyyat formunda fərdi sahələr",
        announcements: "Təcililik dərəcəsi ilə elanlar",
        automations: "Avtomatik elanlar",
      },
    },
    judging: {
      title: "Qiymətləndirmə və nəticələr",
      rows: {
        weighted: "Çəkili meyarlar",
        normalisation: "Hakim üzrə normallaşdırma",
        leaderboard: "Reytinq cədvəli və pyedestal",
        breakdown: "Meyar üzrə bölgü",
        stage: "Təqdimatlar, eliminasiya mərhələləri, böyük ekran",
        certificates: "İctimai yoxlanılan sertifikatlar",
        report: "Sponsorlar üçün tədbirdən sonrakı hesabat (PDF)",
      },
    },
    workspace: {
      title: "İş sahəsi",
      rows: { events: "İldə tədbir sayı", seats: "Təşkilatçı yerləri", archive: "Arxivlənmiş tədbirlər", roles: "Rollar və səlahiyyətlər" },
      eventsPerPurchase: "Bir alışda tədbir",
    },
    platform: {
      title: "Platforma",
      rows: {
        languages: "Azərbaycan, ingilis və rus dili",
        csv: "İştirakçıların CSV ixracı",
        telegram: "Telegram elanları",
        chat: "Moderasiyalı tədbir çatı",
        branding: "Tədbir səhifələrində öz loqon və rənglərin",
        analytics: "Geniş analitika",
        webhooks: "Öz sistemlərinə webhook-lar",
        calendar: "Təqvim lentləri",
        domain: "Öz domenin",
        cloud: "Öz buludunda işləyir",
      },
    },
    support: {
      title: "Dəstək",
      rows: {
        email: "E-poçt dəstəyi",
        onboarding: "Başlanğıc təlimi",
        priority: "Tədbir günlərində prioritet",
        named: "Təyin olunmuş əlaqə şəxsi",
        sla: "Razılaşdırılmış cavab müddətləri",
      },
    },
  },
  community: {
    name: "Community",
    free: "Pulsuz",
    title: "Tələbə klubları və qeyri-kommersiya universitet tədbirləri üçün pulsuz",
    body: "Klubun və ya fakültən üçün bilet satışı və sponsor ödənişi olmadan hackathon keçirirsən? Bizə yaz, sənin üçün Community iş sahəsi quraq.",
    points: ["{events}", "Tədbir başına {participants} iştirakçıya qədər", "Starter-dəki hər şey, sertifikatlar daxil"],
    cta: "Müraciət et",
  },
  enterprise: {
    eyebrow: "Enterprise",
    title: "Satınalma, təhlükəsizlik yoxlaması, öz buludun",
    lead: "Dövlət qurumlarının və bankların öz prosesi var və vaxt qrafikini də o proses müəyyən edir. Təhlükəsizlik sorğularını cavablandırırıq, platformanı sənin mühitinə quraşdırırıq və saxlama şərtlərini hər hansı sənəd imzalanmazdan əvvəl yazılı veririk.",
    contact: "Satış komandası ilə əlaqə",
    data: "Datanı necə idarə edirik",
    points: [
      "Sənin bulud hesabında və ya serverlərində işləyir",
      "Sənin bazan, sənin ehtiyat nüsxələrin, sənin saxlama qaydan",
      "Limitsiz təşkilatçı yeri",
      "Öz domenin və brendin",
      "Təhlükəsizlik sorğusu yazılı cavablandırılır",
      "Tədbir günlərində razılaşdırılmış cavab müddətləri",
    ],
  },
  faq: {
    eyebrow: "Suallar",
    title: "Qiymət haqqında",
    items: [
      {
        q: "ƏDV necə?",
        a: "{vat}. Qiymətlər manatladır və hər sifarişlə hesab-faktura verilir. Enterprise üçün sabit qiymət yoxdur: proqramına görə hesablanır.",
      },
      {
        q: "“Tədbir başına” ilə “illik” arasında fərq nədir?",
        a: "Tədbir başına plan tək tədbir üçündür: həftəsonuna görə ödəyirsən, arxiv səndə qalır. İllik plan təqvim üçündür: iş sahəsi tədbirlər arasında açıq qalır, keçmiş tədbirlərə baxmaq olur.",
      },
      {
        q: "Kiçikdən başlayıb sonra yuxarı plana keçə bilərikmi?",
        a: "Bəli, heç nəyi yenidən daxil etmək lazım deyil. İş sahəsi eyni qalır, plan isə nəyə icazə verildiyini dəyişir. Artıq keçirilmiş tədbirlər olduğu kimi yerində qalır.",
      },
      {
        q: "Dayandırsaq, datamız nə olur?",
        a: "Onu ixrac edirsən. İştirakçılar, komandalar və təqdimatlar interfeysdən CSV kimi çıxır, Enterprise planında isə baza əvvəldən sənin olub.",
      },
      {
        q: "İştirakçılar və ya hakimlər nəsə ödəyir?",
        a: "Xeyr. Qiymət təşkilat üzrədir, başqa heç kim ödəmir. Hakimlər, mentorlar və könüllülər heç bir limitə daxil deyil; iştirakçılar isə hər tədbirdə planının limitinə qədər sayılır.",
      },
      {
        q: "Universitetlər və ya qeyri-kommersiya təşkilatları üçün endirim varmı?",
        a: "Bəli. Bizə yazanda bunu qeyd et, qiymət təklifində nəzərə alınacaq.",
      },
    ],
  },
  help: {
    title: "Hansı planın uyğun olduğunu bilmirsən?",
    body: "İş sahəsinin nümayişini aç, platformanın əslində nə etdiyinə bax, sonra proqramının necə qurulduğunu bizə danış.",
    walkthrough: "Canlı nümayiş",
    contact: "Bizimlə əlaqə",
  },
};

const ru: PricingCopy = {
  eyebrow: "Цены",
  title: "Цена за организацию: участники ничего не платят",
  lead: "Каждый тариф ведёт событие от регистрации до результатов. Меняется другое: сколько событий и участников у вас может быть, какие модули входят, сколько поддержки нужно в день события и где работает платформа — у нас или в вашей инфраструктуре.",
  billingLabel: "Оплата",
  perEvent: "За событие",
  annual: "Годовая программа",
  annualHint: "Рабочее пространство открыто между событиями, прошедшие события остаются доступны для просмотра.",
  perEventHint: "Вы платите за уик-энд, а архив остаётся у вас и после.",
  custom: "Индивидуально",
  quotedAnnually: "расчёт на год",
  quotedPerEvent: "расчёт за событие",
  perYearUnit: "в год",
  perEventUnit: "за событие",
  choose: "Выбрать {plan}",
  bestFor: "Кому подходит: {who}",
  limitLabels: { events: "События", participants: "Участники", seats: "Места организаторов", support: "Поддержка" },
  limitValues: { perYear: "до {n} в год", perEvent: "до {n} на событие", unlimited: "Без ограничений", eventsYear: "До {n} событий в год", oneEvent: "Одно событие" },
  tiers: {
    starter: {
      tagline: "Один хакатон, проведённый как надо.",
      best: "Начинающие организаторы и события одного факультета",
      support: "Почта, 2 рабочих дня",
      includes: [
        "Роли организатора, судьи и участника",
        "Регистрация, одобрение и сбор команд",
        "Подача проектов с репозиторием, демо и слайдами",
        "Взвешенная оценка и рейтинг",
        "Объявления по почте и в Telegram",
        "Сертификаты, которые любой проверит по коду",
        "Выгрузка участников в CSV",
      ],
      cta: "Запросить расчёт",
    },
    professional: {
      tagline: "Несколько событий в год, одно рабочее пространство.",
      best: "Карьерные центры и организаторы сообществ",
      support: "Почта, следующий рабочий день",
      includes: [
        "Всё из Starter",
        "Менторы с очередью помощи и волонтёры",
        "Свои поля формы регистрации и автоматические объявления",
        "Выступления, раунды отсева и большой экран",
        "Итоговый отчёт для спонсоров (PDF)",
        "Ваш логотип и цвета на страницах событий, расширенная аналитика",
        "Вводное обучение вашей команды",
      ],
      cta: "Запросить расчёт",
    },
    business: {
      tagline: "Программа, а не череда разовых событий.",
      best: "Университеты и компании с календарём событий",
      support: "Приоритет в дни событий",
      includes: [
        "Всё из Professional",
        "Чат события с модерацией",
        "Вебхуки в вашу CRM и другие системы",
        "Ленты календаря и кнопки «Добавить в календарь»",
        "{events}, до {participants} участников на событие",
        "Персональный контакт в дни событий",
      ],
      cta: "Запросить расчёт",
    },
    enterprise: {
      tagline: "Ваша инфраструктура, ваши данные, ваш домен.",
      best: "Госсектор, банки и все, у кого есть процедура закупок",
      support: "Прямая линия, согласованное время ответа",
      includes: [
        "Всё из Business",
        "Разворачивается в вашем облаке или на ваших серверах",
        "Своя база данных под вашим контролем",
        "Ваш домен и ваш бренд",
        "Проверка безопасности и условия хранения данных",
      ],
      cta: "Обсудить",
    },
  },
  note: "Цены в манатах; {vat}. К каждому заказу прилагается счёт, оплата банковским переводом в течение 14 дней после одобрения. Enterprise рассчитывается под вашу программу — а для университетов и некоммерческих организаций есть отдельные условия, просто укажите, кто вы.",
  compare: {
    eyebrow: "Сравнение",
    title: "Всё рядом",
    lead: "Полный список возможностей. Где у тарифа вместо галочки число, это число — лимит.",
    feature: "Возможность",
    included: "Включено",
    notIncluded: "Не включено",
  },
  matrix: {
    event: {
      title: "Проведение события",
      rows: {
        registration: "Регистрация и одобрение",
        codes: "Коды приглашения и ссылки для входа",
        teams: "Сбор команд с лимитом размера",
        submissions: "Подача проектов",
        late: "Переключатель поздней подачи",
        mentors: "Очередь помощи менторов",
        volunteers: "Волонтёры и их задачи",
        forms: "Свои поля в форме регистрации",
        announcements: "Объявления с уровнем важности",
        automations: "Автоматические объявления",
      },
    },
    judging: {
      title: "Оценка и результаты",
      rows: {
        weighted: "Взвешенные критерии",
        normalisation: "Нормализация по судьям",
        leaderboard: "Рейтинг и пьедестал",
        breakdown: "Разбивка по критериям",
        stage: "Выступления, раунды отсева, большой экран",
        certificates: "Сертификаты с публичной проверкой",
        report: "Итоговый отчёт для спонсоров (PDF)",
      },
    },
    workspace: {
      title: "Рабочее пространство",
      rows: { events: "Событий в год", seats: "Места организаторов", archive: "Архив событий", roles: "Роли и права" },
      eventsPerPurchase: "Событий за покупку",
    },
    platform: {
      title: "Платформа",
      rows: {
        languages: "Азербайджанский, английский, русский",
        csv: "Выгрузка участников в CSV",
        telegram: "Объявления в Telegram",
        chat: "Чат события с модерацией",
        branding: "Ваш логотип и цвета на страницах событий",
        analytics: "Расширенная аналитика",
        webhooks: "Вебхуки в ваши системы",
        calendar: "Ленты календаря",
        domain: "Свой домен",
        cloud: "Работает в вашем облаке",
      },
    },
    support: {
      title: "Поддержка",
      rows: {
        email: "Поддержка по почте",
        onboarding: "Вводное обучение",
        priority: "Приоритет в дни событий",
        named: "Персональный контакт",
        sla: "Согласованное время ответа",
      },
    },
  },
  community: {
    name: "Community",
    free: "Бесплатно",
    title: "Бесплатно для студенческих клубов и некоммерческих университетских событий",
    body: "Проводите хакатон для клуба или факультета без продажи билетов и спонсорских взносов? Расскажите нам о нём, и мы откроем для вас пространство Community.",
    points: ["{events}", "До {participants} участников на событие", "Всё из Starter, включая сертификаты"],
    cta: "Подать заявку",
  },
  enterprise: {
    eyebrow: "Enterprise",
    title: "Закупки, проверка безопасности, ваше облако",
    lead: "У госорганов и банков есть процесс, и сроки задаёт именно он. Мы отвечаем на опросники по безопасности, разворачиваем платформу в вашей среде и фиксируем условия хранения данных письменно до подписания.",
    contact: "Связаться с отделом продаж",
    data: "Как мы обращаемся с данными",
    points: [
      "Работает в вашем облачном аккаунте или на ваших серверах",
      "Ваша база, ваши резервные копии, ваши правила хранения",
      "Неограниченное число мест организаторов",
      "Свой домен и бренд",
      "Письменные ответы на опросник по безопасности",
      "Согласованное время ответа в дни событий",
    ],
  },
  faq: {
    eyebrow: "Вопросы",
    title: "О ценах",
    items: [
      {
        q: "Как с НДС?",
        a: "{vat}. Цены указаны в манатах, к каждому заказу прилагается счёт. У Enterprise нет прайса: его рассчитывают под вашу программу.",
      },
      {
        q: "Чем «за событие» отличается от «годовой программы»?",
        a: "«За событие» подходит для разового мероприятия: вы платите за уик-энд и сохраняете архив. Годовая программа подходит для календаря: рабочее пространство открыто между событиями, прошедшие события доступны для просмотра.",
      },
      {
        q: "Можно начать с малого и перейти выше?",
        a: "Да, и ничего не нужно вводить заново. Рабочее пространство то же, тариф меняет только то, что в нём доступно. Проведённые события остаются на своих местах.",
      },
      {
        q: "Что будет с данными, если мы остановимся?",
        a: "Вы их выгружаете. Участники, команды и работы выгружаются в CSV прямо из интерфейса, а на Enterprise база с самого начала ваша.",
      },
      {
        q: "Платят ли что-то участники или судьи?",
        a: "Нет. Цена — за организацию, больше никто не платит. Судьи, менторы и волонтёры не входят ни в какой лимит; участники считаются по каждому событию в пределах лимита тарифа.",
      },
      {
        q: "Есть ли скидка для университетов или некоммерческих организаций?",
        a: "Да. Скажите об этом, когда свяжетесь с нами, и это будет учтено в расчёте.",
      },
    ],
  },
  help: {
    title: "Не уверены, какой тариф подойдёт?",
    body: "Откройте демонстрацию рабочего пространства, посмотрите, что платформа делает на самом деле, и расскажите нам о вашей программе.",
    walkthrough: "Живая демонстрация",
    contact: "Связаться с нами",
  },
};

export const PRICING_COPY: Record<Lang, PricingCopy> = { en, az, ru };
