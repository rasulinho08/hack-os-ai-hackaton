/**
 * The solutions page's words, in three languages, kept next to the page like
 * the home page's copy (../welcome/copy.ts). The page keeps the order, the
 * anchors and the icons; this file holds what is said about each kind of
 * organisation.
 */

export type Lang = "en" | "az" | "ru";
export type SegmentId = "universities" | "corporates" | "accelerators" | "public";

export interface SegmentCopy {
  name: string;
  headline: string;
  body: string;
  pains: string[];
  fit: { title: string; body: string }[];
  /** The plan it usually starts on, as shown on the badge. */
  plan: string;
  /** Labels for the figures under "Already run on the platform" (the page holds the values). */
  proof?: string[];
}

export interface SolutionsCopy {
  eyebrow: string;
  title: string;
  lead: string;
  pains: string;
  proof: string;
  startsOn: string;
  talk: string;
  notSure: string;
  notSureLead: string;
  walkthrough: string;
  compare: string;
  segments: Record<SegmentId, SegmentCopy>;
}

const en: SolutionsCopy = {
  eyebrow: "Solutions",
  title: "The same platform, four different jobs",
  lead: "A university spring hackathon, a bank’s recruitment weekend, an accelerator demo day and a ministry programme are not the same event. They need the same machinery and very different answers about scale, judging and where the data lives.",
  pains: "What usually goes wrong",
  proof: "Already run on the platform",
  startsOn: "Usually starts on",
  talk: "Talk about your programme",
  notSure: "Not sure which one you are?",
  notSureLead: "Most programmes are a mix. Open the walkthrough, look at what the console does, and tell us the shape of your year — the plan follows from that, not the other way round.",
  walkthrough: "Open the walkthrough",
  compare: "Compare plans",
  segments: {
    universities: {
      name: "Universities",
      headline: "A calendar of events, not a scramble each spring",
      body: "Faculty hackathons, an open annual event, a datathon for one department. Different organisers each time, the same expectations from the administration afterwards.",
      pains: [
        "A new spreadsheet and a new group chat every year",
        "Judging that different faculties score differently",
        "No archive when the administration asks what happened",
      ],
      fit: [
        { title: "One workspace, many events", body: "Every faculty event lives in the same place, with its own dates, criteria and roster." },
        { title: "Consistent judging", body: "Weighted criteria and per-judge normalisation keep different panels comparable." },
        { title: "The archive stays", body: "Last year's event is still browsable, with its results intact." },
        { title: "Three languages", body: "Azerbaijani, English and Russian, switchable per user." },
      ],
      plan: "Professional or Business",
    },
    corporates: {
      name: "Corporates",
      headline: "A hiring channel that produces evidence, not impressions",
      body: "Graduate recruitment, internal innovation sprints, partner challenges. The point is what people did over the weekend, and being able to show it afterwards.",
      pains: [
        "Judging notes scattered across a dozen inboxes",
        "No consistent way to compare candidates across teams",
        "Nothing to hand HR when the weekend is over",
      ],
      fit: [
        { title: "Criteria you can defend", body: "Weight the rubric toward the signals you actually hire on." },
        { title: "Every score attributable", body: "Who scored what, on which criterion, with coverage visible." },
        { title: "Export to your process", body: "Participants and submissions out as CSV, ready for your ATS." },
        { title: "Mentors from your teams", body: "Engineers work a help queue instead of wandering the room." },
      ],
      plan: "Business",
      proof: ["Participants in one event", "Scores recorded"],
    },
    accelerators: {
      name: "Accelerators",
      headline: "Demo day, with the judging under control",
      body: "A short build window, a heavy panel, investors in the room waiting for the result. The format is different from a student hackathon and the software should not fight it.",
      pains: [
        "Late entries argued over at the deadline",
        "Panels large enough that partial scoring skews the board",
        "Pitch order decided the night before, on paper",
      ],
      fit: [
        { title: "A deadline that holds", body: "Late submissions are refused unless you switch them on." },
        { title: "Normalised panels", body: "A judge who scored half the criteria does not distort the ranking." },
        { title: "Presentation scheduling", body: "Order, slots and links, visible to everyone at once." },
        { title: "Results you can publish", body: "Leaderboard, podium and per-criterion breakdown as soon as scores are in." },
      ],
      plan: "Professional",
    },
    public: {
      name: "Public sector",
      headline: "Procurement-ready, and it runs where you say",
      body: "Ministries and agencies have a process before they have an event. The questions are about data residency, audit and retention, and they come before anyone talks about features.",
      pains: [
        "Participant data that may not leave the country",
        "A security questionnaire that blocks the timeline",
        "Retention terms nobody can put in writing",
      ],
      fit: [
        { title: "Your infrastructure", body: "Deployed into your cloud account or onto your servers." },
        { title: "Your database", body: "The data never leaves your tenancy, and the backups are yours." },
        { title: "Answered in writing", body: "Security questionnaire completed, retention terms agreed before signature." },
        { title: "Access checked on the server", body: "Five roles, each enforced server-side, so nobody sees more than their part." },
      ],
      plan: "Enterprise",
    },
  },
};

const az: SolutionsCopy = {
  eyebrow: "Həllər",
  title: "Eyni platforma, dörd fərqli iş",
  lead: "Universitetin yaz hackathonu, bankın işə qəbul həftəsonu, akseleratorun demo günü və nazirliyin proqramı eyni tədbir deyil. Onlara eyni mexanizm, miqyas, qiymətləndirmə və datanın harada saxlanması barədə isə çox fərqli cavablar lazımdır.",
  pains: "Adətən nə səhv gedir",
  proof: "Platformada artıq keçirilib",
  startsOn: "Adətən bu planla başlayır",
  talk: "Proqramını müzakirə et",
  notSure: "Hansı olduğunu bilmirsən?",
  notSureLead: "Əksər proqramlar qarışıqdır. Nümayişi aç, konsolun nə etdiyinə bax və ilinin necə qurulduğunu bizə danış — plan bundan çıxır, əksinə yox.",
  walkthrough: "Nümayişi aç",
  compare: "Planları müqayisə et",
  segments: {
    universities: {
      name: "Universitetlər",
      headline: "Hər yaz təlaş yox, tədbirlər təqvimi",
      body: "Fakültə hackathonları, illik açıq tədbir, bir kafedra üçün datathon. Hər dəfə başqa təşkilatçılar, sonra isə rəhbərliyin eyni gözləntiləri.",
      pains: [
        "Hər il yeni Excel faylı və yeni qrup çatı",
        "Fakültələrin fərqli ballandırdığı qiymətləndirmə",
        "Rəhbərlik nə baş verdiyini soruşanda arxiv yoxdur",
      ],
      fit: [
        { title: "Bir iş sahəsi, çox tədbir", body: "Hər fakültə tədbiri öz tarixləri, meyarları və iştirakçı siyahısı ilə eyni yerdədir." },
        { title: "Ardıcıl qiymətləndirmə", body: "Çəkili meyarlar və hakim üzrə normallaşdırma fərqli hakim heyətlərini müqayisə edilə bilən saxlayır." },
        { title: "Arxiv qalır", body: "Keçən ilin tədbirinə hələ də baxmaq olur, nəticələri toxunulmaz qalır." },
        { title: "Üç dil", body: "Azərbaycan, ingilis və rus dili, hər istifadəçi özü dəyişir." },
      ],
      plan: "Professional və ya Business",
    },
    corporates: {
      name: "Şirkətlər",
      headline: "Təəssürat yox, sübut verən işə qəbul kanalı",
      body: "Məzunların işə qəbulu, daxili innovasiya sprintləri, tərəfdaş çağırışları. Əsas məsələ insanların həftəsonu nə etdiyi və bunu sonra göstərə bilməkdir.",
      pains: [
        "Onlarla poçt qutusuna səpələnmiş qiymətləndirmə qeydləri",
        "Namizədləri komandalar arasında müqayisə etməyin ardıcıl yolu yoxdur",
        "Həftəsonu bitəndə HR-a veriləcək heç nə yoxdur",
      ],
      fit: [
        { title: "Əsaslandıra biləcəyin meyarlar", body: "Meyarların çəkisini işə qəbulda həqiqətən baxdığın göstəricilərə görə qur." },
        { title: "Hər balın müəllifi bəllidir", body: "Kim hansı meyar üzrə nə bal verib — əhatə də görünür." },
        { title: "Öz prosesinə ixrac", body: "İştirakçılar və təqdimatlar CSV kimi çıxır, ATS sisteminə hazırdır." },
        { title: "Öz komandalarından mentorlar", body: "Mühəndislər zalda dolaşmaq əvəzinə kömək növbəsi ilə işləyir." },
      ],
      plan: "Business",
      proof: ["Bir tədbirdə iştirakçı", "Verilmiş bal"],
    },
    accelerators: {
      name: "Akseleratorlar",
      headline: "Qiymətləndirmə nəzarət altında olan demo günü",
      body: "Qısa iş pəncərəsi, böyük hakim heyəti, zalda nəticəni gözləyən investorlar. Format tələbə hackathonundan fərqlidir və proqram ona mane olmamalıdır.",
      pains: [
        "Son tarixdə mübahisəyə səbəb olan gecikmiş təqdimatlar",
        "Qismən qiymətləndirmənin reytinqi əydiyi böyük hakim heyətləri",
        "Çıxış sırası bir gecə əvvəl kağız üzərində təyin olunur",
      ],
      fit: [
        { title: "Pozulmayan son tarix", body: "Gecikmiş təqdimatlar sən açmasan qəbul edilmir." },
        { title: "Normallaşdırılmış hakim heyətləri", body: "Meyarların yarısını qiymətləndirən hakim reytinqi təhrif etmir." },
        { title: "Təqdimat cədvəli", body: "Sıra, vaxt aralıqları və linklər hamıya eyni anda görünür." },
        { title: "Dərc edə biləcəyin nəticələr", body: "Ballar daxil olan kimi reytinq cədvəli, pyedestal və meyar üzrə bölgü." },
      ],
      plan: "Professional",
    },
    public: {
      name: "Dövlət sektoru",
      headline: "Satınalmaya hazır və sənin dediyin yerdə işləyir",
      body: "Nazirliklərin və agentliklərin tədbirdən əvvəl prosesi olur. Suallar datanın harada saxlanması, audit və saxlama müddəti haqqındadır və onlar imkanlardan söz düşməmiş gəlir.",
      pains: [
        "Ölkədən çıxmamalı olan iştirakçı datası",
        "Vaxt qrafikini dayandıran təhlükəsizlik sorğusu",
        "Heç kimin yazılı verə bilmədiyi saxlama şərtləri",
      ],
      fit: [
        { title: "Sənin infrastrukturun", body: "Sənin bulud hesabına və ya serverlərinə quraşdırılır." },
        { title: "Sənin bazan", body: "Data sənin mühitindən çıxmır, ehtiyat nüsxələr də sənindir." },
        { title: "Yazılı cavab", body: "Təhlükəsizlik sorğusu doldurulur, saxlama şərtləri imzadan əvvəl razılaşdırılır." },
        { title: "Giriş serverdə yoxlanılır", body: "Beş rol, hər biri serverdə yoxlanılır — heç kim öz hissəsindən artığını görmür." },
      ],
      plan: "Enterprise",
    },
  },
};

const ru: SolutionsCopy = {
  eyebrow: "Решения",
  title: "Одна платформа, четыре разные задачи",
  lead: "Весенний хакатон университета, рекрутинговые выходные банка, демо-день акселератора и программа министерства — это разные события. Им нужен один и тот же механизм и очень разные ответы о масштабе, оценке и о том, где хранятся данные.",
  pains: "Что обычно идёт не так",
  proof: "Уже проведено на платформе",
  startsOn: "Обычно начинают с",
  talk: "Обсудить вашу программу",
  notSure: "Не уверены, что из этого про вас?",
  notSureLead: "Большинство программ — смесь. Откройте демонстрацию, посмотрите, что делает консоль, и расскажите нам, как устроен ваш год, — тариф следует из этого, а не наоборот.",
  walkthrough: "Открыть демонстрацию",
  compare: "Сравнить тарифы",
  segments: {
    universities: {
      name: "Университеты",
      headline: "Календарь событий, а не аврал каждую весну",
      body: "Факультетские хакатоны, открытое ежегодное событие, датафон для одной кафедры. Каждый раз другие организаторы — и одни и те же ожидания администрации после.",
      pains: [
        "Каждый год новая таблица и новый групповой чат",
        "Оценка, которую разные факультеты ставят по-разному",
        "Нет архива, когда администрация спрашивает, как всё прошло",
      ],
      fit: [
        { title: "Одно рабочее пространство, много событий", body: "Каждое факультетское событие живёт в одном месте — со своими датами, критериями и составом." },
        { title: "Согласованная оценка", body: "Взвешенные критерии и нормализация по судьям делают разные жюри сопоставимыми." },
        { title: "Архив остаётся", body: "Прошлогоднее событие по-прежнему доступно, его результаты целы." },
        { title: "Три языка", body: "Азербайджанский, английский и русский — каждый пользователь переключает сам." },
      ],
      plan: "Professional или Business",
    },
    corporates: {
      name: "Компании",
      headline: "Канал найма, который даёт доказательства, а не впечатления",
      body: "Найм выпускников, внутренние инновационные спринты, партнёрские челленджи. Главное — что люди сделали за выходные, и возможность показать это потом.",
      pains: [
        "Заметки жюри, разбросанные по десятку почтовых ящиков",
        "Нет единого способа сравнить кандидатов из разных команд",
        "Нечего передать HR, когда выходные закончились",
      ],
      fit: [
        { title: "Критерии, которые можно обосновать", body: "Расставьте веса критериев по тем сигналам, на которые вы действительно смотрите при найме." },
        { title: "У каждой оценки есть автор", body: "Кто, что и по какому критерию поставил — и видно покрытие." },
        { title: "Выгрузка в ваш процесс", body: "Участники и работы выгружаются в CSV, готовые для вашей ATS." },
        { title: "Менторы из ваших команд", body: "Инженеры работают с очередью помощи, а не бродят по залу." },
      ],
      plan: "Business",
      proof: ["Участников в одном событии", "Выставленных оценок"],
    },
    accelerators: {
      name: "Акселераторы",
      headline: "Демо-день, где оценка под контролем",
      body: "Короткое окно разработки, большое жюри, инвесторы в зале ждут результата. Формат не такой, как у студенческого хакатона, и софт не должен ему мешать.",
      pains: [
        "Поздние заявки, о которых спорят в дедлайн",
        "Жюри настолько большие, что частичная оценка искажает рейтинг",
        "Порядок выступлений решают накануне вечером на бумаге",
      ],
      fit: [
        { title: "Дедлайн, который держится", body: "Поздние подачи отклоняются, пока вы их не разрешите." },
        { title: "Нормализованное жюри", body: "Судья, оценивший половину критериев, не искажает рейтинг." },
        { title: "Расписание выступлений", body: "Порядок, слоты и ссылки видны всем сразу." },
        { title: "Результаты, которые можно публиковать", body: "Рейтинг, пьедестал и разбивка по критериям, как только оценки готовы." },
      ],
      plan: "Professional",
    },
    public: {
      name: "Госсектор",
      headline: "Готово к закупкам и работает там, где вы скажете",
      body: "У министерств и агентств процесс появляется раньше, чем событие. Вопросы касаются места хранения данных, аудита и сроков хранения — и звучат до того, как кто-то заговорит о функциях.",
      pains: [
        "Данные участников, которые не могут покидать страну",
        "Опросник по безопасности, который тормозит сроки",
        "Условия хранения, которые никто не может зафиксировать письменно",
      ],
      fit: [
        { title: "Ваша инфраструктура", body: "Разворачивается в вашем облачном аккаунте или на ваших серверах." },
        { title: "Ваша база данных", body: "Данные не покидают вашу среду, резервные копии — ваши." },
        { title: "Ответы в письменном виде", body: "Опросник по безопасности заполнен, условия хранения согласованы до подписания." },
        { title: "Доступ проверяется на сервере", body: "Пять ролей, каждая проверяется на сервере, поэтому никто не видит больше своей части." },
      ],
      plan: "Enterprise",
    },
  },
};

export const SOLUTIONS_COPY: Record<Lang, SolutionsCopy> = { en, az, ru };
