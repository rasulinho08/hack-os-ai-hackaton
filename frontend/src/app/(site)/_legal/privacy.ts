/*
 * Privacy policy. Every statement here describes what the code does; check it
 * again when the data model, the providers or the retention jobs change.
 */
import type { LegalDocSet } from "./types";

export const PRIVACY: LegalDocSet = {
  en: {
    title: "Privacy policy",
    summary:
      "What personal data HackOS keeps, why, who helps us run the service, how long the data stays and how to reach us about it.",
    updated: "23 October 2026",
    sections: [
      {
        id: "scope",
        title: "Who we are and what this covers",
        blocks: [
          {
            kind: "p",
            text: "HackOS is a platform for running hackathons. Organisations buy a plan and set up their events; the people at those events — participants, judges, mentors and volunteers — take part through the platform. This policy covers the hack-os.app websites, the platform itself and the e-mails it sends.",
          },
          {
            kind: "p",
            text: "Who is responsible depends on the data. For the people at an event, the organisation that runs the event decides what is collected and why, and HackOS stores and processes that data on its behalf. For customer accounts, orders and invoices, and for this website, HackOS itself is responsible.",
          },
        ],
      },
      {
        id: "data",
        title: "What we keep",
        blocks: [
          {
            kind: "list",
            items: [
              "Account: your name, your e-mail address and a password, which we store only as a one-way hash. We also record when you confirmed your e-mail address.",
              "Event roles: the events you take part in and your role in each; for mentors their expertise and availability, for volunteers their tasks.",
              "Profile, if you fill it in: phone number, age, country, time zone, university and cohort, links to GitHub and LinkedIn, skills and experience, dietary needs, T-shirt size and similar details an event asks for.",
              "Registration: your answers to the event's registration form, any files you attach (for example a CV), and your status — pending, approved, waitlisted or rejected.",
              "Teams and projects: team membership and invitations, your project's links and files, and presentation slots.",
              "Judging: the scores and comments judges give, a history of every change to a score, conflict-of-interest declarations, votes in a people's choice vote where an event holds one, and the results the organiser publishes.",
              "Communication within an event: chat messages and reports about them, help requests to mentors (topic, description, where you are sitting and, if you give one, a contact phone number), announcements and the notifications sent to you.",
              "Certificates: your name as printed, the event, your team and placing, and the certificate's code. Anyone who has the code can check the certificate on the public verification page; it shows the name, the event and the award, never your e-mail address.",
              "Feedback: ratings and comments you leave after an event. Answers to the “would you recommend it” question are shown to organisers without names.",
              "Customers: the organisation's name, legal name, tax number, country, city, website and billing e-mail address, the contact people there, and orders with their status history and invoices. For an order placed with a card we keep only the card brand and the last four digits.",
              "Security records: for important actions — the owner console's second sign-in step, changes to roles and passwords, e-mail confirmations, decisions on orders, publishing and archiving events, chat moderation — we record who acted, when, and the IP address the request came from.",
              "Messages sent through the website's contact form are delivered to our mailbox; the form does not store them in the platform.",
            ],
          },
        ],
      },
      {
        id: "purposes",
        title: "Why we use it",
        blocks: [
          {
            kind: "list",
            items: [
              "To run the events you organise or take part in: registration, teams, submissions, judging, results, certificates, announcements, chat and help requests.",
              "To keep your account secure: signing in, confirming your e-mail address, resetting passwords and limiting repeated failed attempts.",
              "To process orders and issue invoices for customers.",
              "To send the e-mails the service needs: confirmation links, invitations, order updates, announcements from your organiser and certificates.",
              "To investigate problems and misuse, using the security records described above.",
            ],
          },
          {
            kind: "p",
            text: "We do not sell personal data, show advertising or use your data to build profiles for anyone else.",
          },
        ],
      },
      {
        id: "providers",
        title: "Who helps us run the service",
        blocks: [
          { kind: "p", text: "We work with a small number of providers, each only for its part of the service:" },
          {
            kind: "list",
            items: [
              "Vercel hosts the website and the platform's interface.",
              "Render runs the platform's servers, in its Frankfurt (Germany) region.",
              "Supabase provides the PostgreSQL database in which the data above is stored.",
              "An e-mail delivery service — Resend or Brevo, or an SMTP mail server, depending on our configuration — sends the platform's e-mails.",
              "Telegram is used only if you link your Telegram account to receive notifications, or an organiser links a Telegram channel to repeat announcements there. We then keep your Telegram chat ID, username, first name and language.",
              "GitHub: when a submission links to a GitHub repository, the platform reads the repository's public details through GitHub's public API to check when it was created and worked on. The request contains only the repository's address.",
              "Calendar apps such as Google Calendar receive event dates only when you choose “Add to calendar” or subscribe to your personal calendar feed.",
            ],
          },
          {
            kind: "p",
            text: "Some of these providers process data outside Azerbaijan, for example in the European Union or the United States. They act on our instructions and under their own security and data-protection commitments.",
          },
        ],
      },
      {
        id: "retention",
        title: "How long we keep it",
        blocks: [
          {
            kind: "list",
            items: [
              "Events stay in the platform after they end. Fourteen days after the end an event is archived: it can still be read and exported, but nothing in it can be changed.",
              "An organiser can delete their event. Its registrations, teams, submissions, scores, chat, certificates and files are deleted with it.",
              "In-app notifications are deleted after 90 days.",
              "When a chat message is removed, its text is erased at once; only a “message removed” marker remains.",
              "E-mail confirmation links expire after 72 hours and password reset links after one hour.",
              "Telegram link codes are deleted a day after they expire, and the record of messages received from Telegram after seven days.",
              "Your account stays until it is deleted. To have it deleted, write to {email}.",
              "Orders and invoices are kept for accounting, and security records to investigate problems.",
            ],
          },
        ],
      },
      {
        id: "rights",
        title: "Your rights",
        blocks: [
          {
            kind: "p",
            text: "Under the Law of the Republic of Azerbaijan “On Personal Data” you can ask to see the personal data we hold about you, to have it corrected or deleted, and to object to how it is used.",
          },
          {
            kind: "list",
            items: [
              "You can change your profile in the platform at any time.",
              "Data that belongs to an event — your registration, team, submission or scores — is managed by the event's organiser: ask them to correct it, to remove you from the event or to export the event's data.",
              "You can unlink Telegram, and reset the link to your personal calendar feed, in the platform.",
              "For anything else, or if an organiser does not answer, write to {email}. We check that a request really comes from you before we act on it.",
            ],
          },
        ],
      },
      {
        id: "security",
        title: "How we protect it",
        blocks: [
          {
            kind: "list",
            items: [
              "All connections to the platform are encrypted (HTTPS).",
              "Passwords are stored only as bcrypt hashes. Your session is kept in a cookie that the page's own scripts cannot read, and changing your password signs out every other device.",
              "Every request is checked on the server against your role in the event concerned; one organisation cannot see another organisation's events.",
              "Confirmation and password reset links work once and expire.",
            ],
          },
          {
            kind: "p",
            text: "No system is perfectly secure. If you think your account or data has been exposed, write to {email} straight away.",
          },
        ],
      },
      {
        id: "children",
        title: "Children",
        blocks: [
          {
            kind: "p",
            text: "HackOS is meant for people aged 16 and over. Younger people take part only with the consent of a parent or guardian, which the event's organiser arranges and is responsible for.",
          },
        ],
      },
      {
        id: "changes",
        title: "Changes to this policy",
        blocks: [
          {
            kind: "p",
            text: "When we change this policy we update the date at the top of the page. If a change affects how your data is used, we will also tell you in the platform or by e-mail.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        operator: true,
        blocks: [{ kind: "p", text: "Questions about this policy or your data: write to {email}." }],
      },
    ],
  },

  az: {
    title: "Məxfilik siyasəti",
    summary:
      "HackOS hansı fərdi məlumatları saxlayır, nə üçün, xidməti işlətməkdə bizə kimlər kömək edir, məlumatlar nə qədər saxlanılır və bununla bağlı bizimlə necə əlaqə saxlamaq olar.",
    updated: "23 oktyabr 2026",
    sections: [
      {
        id: "scope",
        title: "Biz kimik və bu siyasət nəyi əhatə edir",
        blocks: [
          {
            kind: "p",
            text: "HackOS hackathonların keçirilməsi üçün platformadır. Təşkilatlar plan alır və öz tədbirlərini qurur; həmin tədbirlərin iştirakçıları, hakimləri, mentorları və könüllüləri platforma vasitəsilə iştirak edir. Bu siyasət hack-os.app saytlarını, platformanın özünü və onun göndərdiyi e-poçtları əhatə edir.",
          },
          {
            kind: "p",
            text: "Məsuliyyət məlumatın növündən asılıdır. Tədbir iştirakçılarına aid məlumatlarda nəyin və nə üçün toplanacağına tədbiri keçirən təşkilat qərar verir, HackOS isə bu məlumatları onun adından saxlayır və emal edir. Müştəri hesabları, sifarişlər, fakturalar və bu sayt üçün məsuliyyəti HackOS özü daşıyır.",
          },
        ],
      },
      {
        id: "data",
        title: "Nəyi saxlayırıq",
        blocks: [
          {
            kind: "list",
            items: [
              "Hesab: adınız, e-poçt ünvanınız və şifrəniz — şifrəni yalnız geri qaytarıla bilməyən heş şəklində saxlayırıq. E-poçt ünvanınızı nə vaxt təsdiqlədiyinizi də qeyd edirik.",
              "Tədbir rolları: iştirak etdiyiniz tədbirlər və hər birindəki rolunuz; mentorlar üçün ixtisas sahəsi və əlçatanlıq vaxtları, könüllülər üçün tapşırıqlar.",
              "Profil (doldurduğunuz halda): telefon nömrəsi, yaş, ölkə, saat qurşağı, universitet və qrup, GitHub və LinkedIn linkləri, bacarıqlar və təcrübə, qida tələbləri, köynək ölçüsü və tədbirin soruşduğu digər oxşar məlumatlar.",
              "Qeydiyyat: tədbirin qeydiyyat formasına cavablarınız, əlavə etdiyiniz fayllar (məsələn, CV) və statusunuz — gözləmədə, təsdiqlənib, gözləmə siyahısında və ya rədd edilib.",
              "Komandalar və layihələr: komanda üzvlüyü və dəvətlər, layihənizin linkləri və faylları, təqdimat vaxtları.",
              "Qiymətləndirmə: hakimlərin verdiyi ballar və şərhlər, hər bal dəyişikliyinin tarixçəsi, maraq toqquşması bəyannamələri, tədbir keçirirsə iştirakçıların səsverməsində verilən səslər və təşkilatçının dərc etdiyi nəticələr.",
              "Tədbir daxilində ünsiyyət: çat mesajları və onlara dair şikayətlər, mentorlara kömək sorğuları (mövzu, təsvir, oturduğunuz yer və göstərsəniz əlaqə telefonu), elanlar və sizə göndərilən bildirişlər.",
              "Sertifikatlar: çap olunan adınız, tədbir, komandanız və yeriniz, sertifikatın kodu. Kodu bilən hər kəs sertifikatı ictimai yoxlama səhifəsində yoxlaya bilər; orada ad, tədbir və mükafat görünür, e-poçt ünvanınız isə heç vaxt göstərilmir.",
              "Rəylər: tədbirdən sonra verdiyiniz qiymət və şərhlər. “Tövsiyə edərdinizmi” sualına cavablar təşkilatçılara adsız göstərilir.",
              "Müştərilər: təşkilatın adı, hüquqi adı, vergi nömrəsi, ölkəsi, şəhəri, saytı və hesab-faktura üçün e-poçt ünvanı, oradakı əlaqə şəxsləri, sifarişlər, onların status tarixçəsi və fakturalar. Kartla verilən sifarişdə yalnız kartın növünü və son dörd rəqəmini saxlayırıq.",
              "Təhlükəsizlik qeydləri: vacib əməliyyatlar üçün — sahib konsoluna girişin ikinci addımı, rol və şifrə dəyişiklikləri, e-poçt təsdiqləri, sifarişlərlə bağlı qərarlar, tədbirlərin dərci və arxivlənməsi, çat moderasiyası — kimin, nə vaxt etdiyini və sorğunun hansı IP ünvanından gəldiyini qeyd edirik.",
              "Saytdakı əlaqə forması ilə göndərilən mesajlar bizim poçt qutumuza çatır; forma onları platformada saxlamır.",
            ],
          },
        ],
      },
      {
        id: "purposes",
        title: "Nə üçün istifadə edirik",
        blocks: [
          {
            kind: "list",
            items: [
              "Təşkil etdiyiniz və ya iştirak etdiyiniz tədbirləri işlətmək üçün: qeydiyyat, komandalar, təqdimatlar, qiymətləndirmə, nəticələr, sertifikatlar, elanlar, çat və kömək sorğuları.",
              "Hesabınızı qorumaq üçün: giriş, e-poçt ünvanının təsdiqi, şifrənin bərpası və təkrarlanan uğursuz cəhdlərin məhdudlaşdırılması.",
              "Müştərilərin sifarişlərini emal etmək və faktura vermək üçün.",
              "Xidmətin tələb etdiyi e-poçtları göndərmək üçün: təsdiq linkləri, dəvətlər, sifariş yenilikləri, təşkilatçının elanları və sertifikatlar.",
              "Yuxarıda təsvir olunan təhlükəsizlik qeydləri ilə problemləri və sui-istifadəni araşdırmaq üçün.",
            ],
          },
          {
            kind: "p",
            text: "Fərdi məlumatları satmırıq, reklam göstərmirik və məlumatlarınızdan başqaları üçün profil yaratmırıq.",
          },
        ],
      },
      {
        id: "providers",
        title: "Xidməti işlətməkdə bizə kim kömək edir",
        blocks: [
          { kind: "p", text: "Az sayda provayderlə işləyirik, hər biri yalnız xidmətin öz hissəsi üçün:" },
          {
            kind: "list",
            items: [
              "Vercel saytı və platformanın interfeysini yerləşdirir.",
              "Render platformanın serverlərini öz Frankfurt (Almaniya) regionunda işlədir.",
              "Supabase yuxarıdakı məlumatların saxlandığı PostgreSQL bazasını təqdim edir.",
              "E-poçt göndərmə xidməti — konfiqurasiyamızdan asılı olaraq Resend və ya Brevo, yaxud SMTP poçt serveri — platformanın e-poçtlarını göndərir.",
              "Telegram yalnız bildiriş almaq üçün Telegram hesabınızı bağladığınız və ya təşkilatçı elanları təkrarlamaq üçün Telegram kanalı bağladığı halda istifadə olunur. Bu zaman Telegram çat identifikatorunuzu, istifadəçi adınızı, adınızı və dilinizi saxlayırıq.",
              "GitHub: təqdimatda GitHub repozitoriyasına link olduqda platforma repozitoriyanın nə vaxt yaradıldığını və üzərində nə vaxt işlənildiyini yoxlamaq üçün onun ictimai məlumatlarını GitHub-ın ictimai API-si ilə oxuyur. Sorğuda yalnız repozitoriyanın ünvanı olur.",
              "Google Calendar kimi təqvim tətbiqləri tədbir tarixlərini yalnız siz “Təqvimə əlavə et” seçdikdə və ya şəxsi təqvim lentinizə abunə olduqda alır.",
            ],
          },
          {
            kind: "p",
            text: "Bu provayderlərin bəziləri məlumatları Azərbaycandan kənarda, məsələn, Avropa İttifaqında və ya ABŞ-da emal edir. Onlar bizim göstərişlərimizlə və öz təhlükəsizlik və məlumat qorunması öhdəlikləri çərçivəsində işləyir.",
          },
        ],
      },
      {
        id: "retention",
        title: "Nə qədər saxlayırıq",
        blocks: [
          {
            kind: "list",
            items: [
              "Tədbirlər bitdikdən sonra platformada qalır. Bitmədən 14 gün sonra tədbir arxivlənir: onu oxumaq və ixrac etmək olur, amma içində heç nə dəyişdirilə bilməz.",
              "Təşkilatçı öz tədbirini silə bilər. Bu zaman tədbirin qeydiyyatları, komandaları, təqdimatları, balları, çatı, sertifikatları və faylları da silinir.",
              "Platformadaxili bildirişlər 90 gündən sonra silinir.",
              "Çat mesajı silindikdə onun mətni dərhal pozulur; yerində yalnız “mesaj silinib” işarəsi qalır.",
              "E-poçt təsdiqi linkləri 72 saatdan, şifrə bərpası linkləri isə bir saatdan sonra etibarsız olur.",
              "Telegram bağlantı kodları vaxtı bitdikdən bir gün sonra, Telegram-dan alınan mesajların qeydi isə yeddi gündən sonra silinir.",
              "Hesabınız silinənə qədər qalır. Silinməsini istəsəniz, {email} ünvanına yazın.",
              "Sifarişlər və fakturalar mühasibat üçün, təhlükəsizlik qeydləri isə problemləri araşdırmaq üçün saxlanılır.",
            ],
          },
        ],
      },
      {
        id: "rights",
        title: "Hüquqlarınız",
        blocks: [
          {
            kind: "p",
            text: "Azərbaycan Respublikasının “Fərdi məlumatlar haqqında” Qanununa əsasən siz haqqınızda saxladığımız fərdi məlumatlarla tanış olmağı, onların düzəldilməsini və ya silinməsini tələb edə, onlardan istifadəyə etiraz edə bilərsiniz.",
          },
          {
            kind: "list",
            items: [
              "Profilinizi platformada istənilən vaxt dəyişə bilərsiniz.",
              "Tədbirə aid məlumatları — qeydiyyatınızı, komandanızı, təqdimatınızı və ya ballarınızı — tədbirin təşkilatçısı idarə edir: onları düzəltməyi, sizi tədbirdən çıxarmağı və ya tədbirin məlumatlarını ixrac etməyi ondan xahiş edin.",
              "Telegram bağlantısını açmaq və şəxsi təqvim lentinizin linkini yeniləmək platformada mümkündür.",
              "Digər hallarda və ya təşkilatçı cavab vermədikdə {email} ünvanına yazın. Sorğu üzrə hərəkət etməzdən əvvəl onun həqiqətən sizdən gəldiyini yoxlayırıq.",
            ],
          },
        ],
      },
      {
        id: "security",
        title: "Məlumatları necə qoruyuruq",
        blocks: [
          {
            kind: "list",
            items: [
              "Platformaya bütün bağlantılar şifrələnir (HTTPS).",
              "Şifrələr yalnız bcrypt heşi şəklində saxlanılır. Sessiyanız səhifənin skriptlərinin oxuya bilmədiyi cookie-də saxlanılır, şifrəni dəyişmək isə bütün digər cihazlardan çıxış edir.",
              "Hər sorğu serverdə müvafiq tədbirdəki rolunuza görə yoxlanılır; bir təşkilat başqa təşkilatın tədbirlərini görə bilməz.",
              "Təsdiq və şifrə bərpası linkləri bir dəfə işləyir və vaxtı bitir.",
            ],
          },
          {
            kind: "p",
            text: "Heç bir sistem tam təhlükəsiz deyil. Hesabınızın və ya məlumatlarınızın ələ keçirildiyini düşünürsünüzsə, dərhal {email} ünvanına yazın.",
          },
        ],
      },
      {
        id: "children",
        title: "Uşaqlar",
        blocks: [
          {
            kind: "p",
            text: "HackOS 16 yaş və yuxarı şəxslər üçün nəzərdə tutulub. Daha kiçik yaşlılar yalnız valideynin və ya qəyyumun razılığı ilə iştirak edir; bu razılığı tədbirin təşkilatçısı təmin edir və buna görə məsuliyyət daşıyır.",
          },
        ],
      },
      {
        id: "changes",
        title: "Bu siyasətdə dəyişikliklər",
        blocks: [
          {
            kind: "p",
            text: "Bu siyasəti dəyişdikdə səhifənin yuxarısındakı tarixi yeniləyirik. Dəyişiklik məlumatlarınızdan istifadə qaydasına təsir edirsə, bunu həmçinin platformada və ya e-poçtla bildirəcəyik.",
          },
        ],
      },
      {
        id: "contact",
        title: "Əlaqə",
        operator: true,
        blocks: [{ kind: "p", text: "Bu siyasət və ya məlumatlarınızla bağlı suallar üçün {email} ünvanına yazın." }],
      },
    ],
  },

  ru: {
    title: "Политика конфиденциальности",
    summary:
      "Какие персональные данные хранит HackOS, зачем, кто помогает нам поддерживать сервис, как долго хранятся данные и как связаться с нами по этим вопросам.",
    updated: "23 октября 2026 г.",
    sections: [
      {
        id: "scope",
        title: "Кто мы и что охватывает эта политика",
        blocks: [
          {
            kind: "p",
            text: "HackOS — платформа для проведения хакатонов. Организации покупают тариф и настраивают свои мероприятия; участники, судьи, менторы и волонтёры этих мероприятий работают через платформу. Эта политика распространяется на сайты hack-os.app, саму платформу и письма, которые она отправляет.",
          },
          {
            kind: "p",
            text: "Ответственность зависит от вида данных. По данным людей на мероприятии решение о том, что собирать и зачем, принимает организация, которая проводит мероприятие, а HackOS хранит и обрабатывает эти данные от её имени. За учётные записи клиентов, заказы и счета, а также за этот сайт отвечает сам HackOS.",
          },
        ],
      },
      {
        id: "data",
        title: "Что мы храним",
        blocks: [
          {
            kind: "list",
            items: [
              "Учётная запись: ваше имя, адрес электронной почты и пароль — пароль мы храним только в виде необратимого хеша. Мы также фиксируем, когда вы подтвердили адрес почты.",
              "Роли на мероприятиях: мероприятия, в которых вы участвуете, и ваша роль в каждом; для менторов — специализация и время доступности, для волонтёров — их задачи.",
              "Профиль, если вы его заполнили: номер телефона, возраст, страна, часовой пояс, университет и группа, ссылки на GitHub и LinkedIn, навыки и опыт, ограничения в питании, размер футболки и похожие сведения, которые запрашивает мероприятие.",
              "Регистрация: ваши ответы на регистрационную форму мероприятия, приложенные файлы (например, резюме) и ваш статус — на рассмотрении, одобрен, в листе ожидания или отклонён.",
              "Команды и проекты: состав команды и приглашения, ссылки и файлы вашего проекта, слоты выступлений.",
              "Оценивание: баллы и комментарии судей, история каждого изменения балла, декларации о конфликте интересов, голоса в голосовании участников, если мероприятие его проводит, и результаты, которые публикует организатор.",
              "Общение внутри мероприятия: сообщения в чате и жалобы на них, запросы помощи менторам (тема, описание, где вы сидите и, если вы его укажете, контактный телефон), объявления и уведомления, отправленные вам.",
              "Сертификаты: ваше имя в том виде, в каком оно напечатано, мероприятие, команда и место, а также код сертификата. Любой, у кого есть код, может проверить сертификат на публичной странице проверки; там видны имя, мероприятие и награда, но никогда — ваш адрес почты.",
              "Отзывы: оценки и комментарии, которые вы оставляете после мероприятия. Ответы на вопрос «порекомендовали бы вы его» организаторы видят без имён.",
              "Клиенты: название организации, юридическое название, налоговый номер, страна, город, сайт и адрес почты для счетов, контактные лица, а также заказы с историей статусов и счета. Для заказа, оплаченного картой, мы храним только тип карты и последние четыре цифры.",
              "Записи безопасности: для важных действий — второго шага входа в консоль владельца, изменения ролей и паролей, подтверждения почты, решений по заказам, публикации и архивации мероприятий, модерации чата — мы фиксируем, кто действовал, когда и с какого IP-адреса пришёл запрос.",
              "Сообщения из контактной формы сайта приходят в наш почтовый ящик; форма не сохраняет их на платформе.",
            ],
          },
        ],
      },
      {
        id: "purposes",
        title: "Зачем мы их используем",
        blocks: [
          {
            kind: "list",
            items: [
              "Чтобы проводить мероприятия, которые вы организуете или в которых участвуете: регистрация, команды, проекты, оценивание, результаты, сертификаты, объявления, чат и запросы помощи.",
              "Чтобы защищать вашу учётную запись: вход, подтверждение адреса почты, восстановление пароля и ограничение повторных неудачных попыток.",
              "Чтобы обрабатывать заказы клиентов и выставлять счета.",
              "Чтобы отправлять письма, без которых сервис не работает: ссылки для подтверждения, приглашения, новости по заказам, объявления организатора и сертификаты.",
              "Чтобы расследовать проблемы и злоупотребления с помощью описанных выше записей безопасности.",
            ],
          },
          {
            kind: "p",
            text: "Мы не продаём персональные данные, не показываем рекламу и не используем ваши данные для составления профилей для кого-либо ещё.",
          },
        ],
      },
      {
        id: "providers",
        title: "Кто помогает нам поддерживать сервис",
        blocks: [
          { kind: "p", text: "Мы работаем с небольшим числом поставщиков, каждый — только для своей части сервиса:" },
          {
            kind: "list",
            items: [
              "Vercel размещает сайт и интерфейс платформы.",
              "Render обслуживает серверы платформы в своём регионе Франкфурт (Германия).",
              "Supabase предоставляет базу данных PostgreSQL, в которой хранятся описанные выше данные.",
              "Сервис отправки почты — Resend или Brevo либо почтовый сервер SMTP, в зависимости от нашей настройки, — отправляет письма платформы.",
              "Telegram используется, только если вы привязали свой аккаунт Telegram для уведомлений или организатор привязал канал Telegram, чтобы дублировать туда объявления. Тогда мы храним идентификатор вашего чата в Telegram, имя пользователя, имя и язык.",
              "GitHub: если в проекте есть ссылка на репозиторий GitHub, платформа читает его публичные сведения через открытый API GitHub, чтобы проверить, когда он был создан и когда в нём работали. Запрос содержит только адрес репозитория.",
              "Календари, например Google Календарь, получают даты мероприятия, только если вы выбрали «Добавить в календарь» или подписались на свою личную ленту календаря.",
            ],
          },
          {
            kind: "p",
            text: "Некоторые из этих поставщиков обрабатывают данные за пределами Азербайджана, например в Европейском союзе или США. Они действуют по нашим указаниям и в рамках собственных обязательств по безопасности и защите данных.",
          },
        ],
      },
      {
        id: "retention",
        title: "Как долго мы их храним",
        blocks: [
          {
            kind: "list",
            items: [
              "Мероприятия остаются на платформе после окончания. Через 14 дней после окончания мероприятие архивируется: его можно читать и выгружать, но ничего в нём изменить нельзя.",
              "Организатор может удалить своё мероприятие. Вместе с ним удаляются его регистрации, команды, проекты, баллы, чат, сертификаты и файлы.",
              "Уведомления внутри платформы удаляются через 90 дней.",
              "Когда сообщение в чате удаляют, его текст сразу стирается; остаётся только отметка «сообщение удалено».",
              "Ссылки для подтверждения почты перестают действовать через 72 часа, ссылки для восстановления пароля — через час.",
              "Коды привязки Telegram удаляются через день после истечения срока, а записи о сообщениях, полученных из Telegram, — через семь дней.",
              "Учётная запись хранится, пока её не удалят. Чтобы удалить свою, напишите на {email}.",
              "Заказы и счета хранятся для бухгалтерского учёта, записи безопасности — для расследования проблем.",
            ],
          },
        ],
      },
      {
        id: "rights",
        title: "Ваши права",
        blocks: [
          {
            kind: "p",
            text: "По Закону Азербайджанской Республики «О персональных данных» вы можете запросить сведения о персональных данных, которые мы о вас храним, потребовать их исправления или удаления и возразить против их использования.",
          },
          {
            kind: "list",
            items: [
              "Свой профиль вы можете изменить на платформе в любое время.",
              "Данными мероприятия — вашей регистрацией, командой, проектом или баллами — управляет его организатор: попросите его исправить их, исключить вас из мероприятия или выгрузить данные мероприятия.",
              "Отвязать Telegram и сбросить ссылку на личную ленту календаря можно на платформе.",
              "В остальных случаях или если организатор не отвечает, напишите на {email}. Прежде чем выполнить запрос, мы проверяем, что он действительно от вас.",
            ],
          },
        ],
      },
      {
        id: "security",
        title: "Как мы их защищаем",
        blocks: [
          {
            kind: "list",
            items: [
              "Все соединения с платформой шифруются (HTTPS).",
              "Пароли хранятся только в виде хешей bcrypt. Сессия хранится в cookie, недоступном для скриптов страницы, а смена пароля завершает сеансы на всех остальных устройствах.",
              "Каждый запрос проверяется на сервере по вашей роли в соответствующем мероприятии; одна организация не видит мероприятия другой.",
              "Ссылки для подтверждения и восстановления пароля срабатывают один раз и имеют срок действия.",
            ],
          },
          {
            kind: "p",
            text: "Ни одна система не защищена полностью. Если вы считаете, что ваша учётная запись или данные стали доступны посторонним, сразу напишите на {email}.",
          },
        ],
      },
      {
        id: "children",
        title: "Дети",
        blocks: [
          {
            kind: "p",
            text: "HackOS рассчитан на людей от 16 лет. Младшие участвуют только с согласия родителя или опекуна, которое обеспечивает организатор мероприятия и за которое он отвечает.",
          },
        ],
      },
      {
        id: "changes",
        title: "Изменения этой политики",
        blocks: [
          {
            kind: "p",
            text: "Когда мы меняем эту политику, мы обновляем дату вверху страницы. Если изменение касается того, как используются ваши данные, мы также сообщим об этом на платформе или по почте.",
          },
        ],
      },
      {
        id: "contact",
        title: "Контакты",
        operator: true,
        blocks: [{ kind: "p", text: "Вопросы об этой политике или ваших данных: напишите на {email}." }],
      },
    ],
  },
};
