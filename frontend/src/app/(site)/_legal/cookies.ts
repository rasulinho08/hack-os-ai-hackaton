/*
 * Cookie policy: every cookie and storage key the code sets, with the lifetime
 * it is set with. A new cookie or storage key belongs here the day it ships
 * (src/__tests__/legal.test.ts checks the names against the source).
 */
import type { LegalDocSet } from "./types";

export const COOKIES: LegalDocSet = {
  en: {
    title: "Cookie policy",
    summary:
      "The cookies and browser storage HackOS uses, what each one is for and how long it lasts. There are no advertising or analytics cookies.",
    updated: "23 October 2026",
    sections: [
      {
        id: "about",
        title: "What we use and why",
        blocks: [
          {
            kind: "p",
            text: "Cookies are small files a website keeps in your browser. HackOS uses them, together with your browser's local and session storage, only to sign you in, keep you in the right place and remember your settings.",
          },
          {
            kind: "p",
            text: "We use no advertising cookies and no third-party analytics, and the site loads no tracking scripts.",
          },
        ],
      },
      {
        id: "cookies",
        title: "Cookies",
        blocks: [
          {
            kind: "p",
            text: "All of these are strictly necessary: without them, signing in and moving between workspaces would not work.",
          },
          {
            kind: "table",
            head: ["Name", "Purpose", "Lifetime"],
            rows: [
              ["access_token", "Keeps you signed in. Set by our server; the page's scripts cannot read it, and in production it is sent only over HTTPS.", "30 days, or until you sign out"],
              ["hh_elev", "Only in the platform owner's console: shows that the second sign-in step was completed.", "12 hours"],
              ["hh_role", "Your role in the workspace you are in, so the right portal opens.", "14 days"],
              ["hh_email", "The account this browser is signed in to, so another account's saved state is never shown.", "14 days"],
              ["hh_status", "For participants: your registration status, so pages that are not open to you yet are not offered.", "14 days"],
              ["hh_event", "The event workspace you chose.", "30 days"],
            ],
          },
        ],
      },
      {
        id: "storage",
        title: "Browser storage",
        blocks: [
          {
            kind: "p",
            text: "These entries stay in your browser and are not sent to our servers. Local storage is kept until you clear it; session storage until you close the tab.",
          },
          {
            kind: "table",
            head: ["Key", "Purpose", "Kept"],
            rows: [
              ["hh_lang", "The interface language you chose.", "Until you clear it"],
              ["hh_theme, hs_theme", "Light or dark theme, in the platform and on this website.", "Until you clear it"],
              ["hh_active_event_id", "For organisers: the event the dashboard opens with.", "Until you clear it"],
              ["hh_hacker_profile_v1_…", "For participants: a copy of your own profile, so your details show while the page loads.", "Until you clear it"],
              ["hh:hacker_help:draft_v2", "A help request you started but have not sent.", "Until you send it or clear it"],
              ["hackos:presenter:…", "For organisers: the presentation timer, so reloading the page does not reset it.", "Until you clear it"],
              ["hh_verify", "Whether your e-mail address still needs confirming.", "Until you close the tab"],
              ["hh_platform_notice, hh_platform_notice_dismissed", "A service or maintenance notice, and whether you hid it.", "Until you close the tab"],
            ],
          },
        ],
      },
      {
        id: "choices",
        title: "Your choices",
        blocks: [
          {
            kind: "p",
            text: "Because every cookie we use is needed for the service to work, there is nothing to switch on or off and no consent banner. You can delete cookies and stored data in your browser's settings at any time; you will then be signed out and your settings forgotten.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        operator: true,
        blocks: [{ kind: "p", text: "Questions about cookies: write to {email}." }],
      },
    ],
  },

  az: {
    title: "Cookie siyasəti",
    summary:
      "HackOS-un istifadə etdiyi cookie-lər və brauzer yaddaşı, hər birinin nə üçün olduğu və nə qədər saxlanıldığı. Reklam və ya analitika cookie-ləri yoxdur.",
    updated: "23 oktyabr 2026",
    sections: [
      {
        id: "about",
        title: "Nədən və nə üçün istifadə edirik",
        blocks: [
          {
            kind: "p",
            text: "Cookie-lər saytın brauzerinizdə saxladığı kiçik fayllardır. HackOS onlardan və brauzerinizin lokal və sessiya yaddaşından yalnız sizi hesaba daxil etmək, düzgün iş yerində saxlamaq və ayarlarınızı yadda saxlamaq üçün istifadə edir.",
          },
          {
            kind: "p",
            text: "Reklam cookie-lərindən və üçüncü tərəf analitikasından istifadə etmirik, sayt heç bir izləmə skripti yükləmir.",
          },
        ],
      },
      {
        id: "cookies",
        title: "Cookie-lər",
        blocks: [
          {
            kind: "p",
            text: "Bunların hamısı mütləq zəruridir: onlarsız hesaba giriş və iş yerləri arasında keçid işləməz.",
          },
          {
            kind: "table",
            head: ["Ad", "Məqsəd", "Müddət"],
            rows: [
              ["access_token", "Hesabda qalmağınızı təmin edir. Serverimiz tərəfindən qoyulur; səhifənin skriptləri onu oxuya bilmir, istehsal mühitində isə yalnız HTTPS ilə göndərilir.", "30 gün və ya hesabdan çıxana qədər"],
              ["hh_elev", "Yalnız platforma sahibinin konsolunda: girişin ikinci addımının tamamlandığını göstərir.", "12 saat"],
              ["hh_role", "Olduğunuz iş yerindəki rolunuz — düzgün portal açılsın deyə.", "14 gün"],
              ["hh_email", "Bu brauzerin daxil olduğu hesab — başqa hesabın yadda saxlanmış vəziyyəti heç vaxt göstərilməsin deyə.", "14 gün"],
              ["hh_status", "İştirakçılar üçün: qeydiyyat statusunuz — hələ sizin üçün açıq olmayan səhifələr təklif olunmasın deyə.", "14 gün"],
              ["hh_event", "Seçdiyiniz tədbir iş yeri.", "30 gün"],
            ],
          },
        ],
      },
      {
        id: "storage",
        title: "Brauzer yaddaşı",
        blocks: [
          {
            kind: "p",
            text: "Bu qeydlər brauzerinizdə qalır və serverlərimizə göndərilmir. Lokal yaddaş siz onu təmizləyənə qədər, sessiya yaddaşı isə vərəqi bağlayana qədər saxlanılır.",
          },
          {
            kind: "table",
            head: ["Açar", "Məqsəd", "Saxlanma"],
            rows: [
              ["hh_lang", "Seçdiyiniz interfeys dili.", "Təmizləyənə qədər"],
              ["hh_theme, hs_theme", "Platformada və bu saytda açıq və ya tünd mövzu.", "Təmizləyənə qədər"],
              ["hh_active_event_id", "Təşkilatçılar üçün: idarə panelinin açıldığı tədbir.", "Təmizləyənə qədər"],
              ["hh_hacker_profile_v1_…", "İştirakçılar üçün: öz profilinizin surəti — səhifə yüklənərkən məlumatlarınız görünsün deyə.", "Təmizləyənə qədər"],
              ["hh:hacker_help:draft_v2", "Yazmağa başladığınız, amma göndərmədiyiniz kömək sorğusu.", "Göndərənə və ya təmizləyənə qədər"],
              ["hackos:presenter:…", "Təşkilatçılar üçün: təqdimat taymeri — səhifəni yeniləmək onu sıfırlamasın deyə.", "Təmizləyənə qədər"],
              ["hh_verify", "E-poçt ünvanınızın hələ təsdiq tələb edib-etmədiyi.", "Vərəqi bağlayana qədər"],
              ["hh_platform_notice, hh_platform_notice_dismissed", "Xidmət və ya texniki iş bildirişi və onu gizlədib-gizlətmədiyiniz.", "Vərəqi bağlayana qədər"],
            ],
          },
        ],
      },
      {
        id: "choices",
        title: "Seçimləriniz",
        blocks: [
          {
            kind: "p",
            text: "İstifadə etdiyimiz bütün cookie-lər xidmətin işləməsi üçün lazım olduğundan, açıb-bağlanacaq heç nə və razılıq banneri yoxdur. Cookie-ləri və saxlanmış məlumatları istənilən vaxt brauzerinizin ayarlarından silə bilərsiniz; bu zaman hesabdan çıxacaqsınız və ayarlarınız unudulacaq.",
          },
        ],
      },
      {
        id: "contact",
        title: "Əlaqə",
        operator: true,
        blocks: [{ kind: "p", text: "Cookie-lərlə bağlı suallar üçün {email} ünvanına yazın." }],
      },
    ],
  },

  ru: {
    title: "Политика cookie",
    summary:
      "Какие cookie и какое хранилище браузера использует HackOS, зачем нужен каждый из них и сколько он хранится. Рекламных и аналитических cookie нет.",
    updated: "23 октября 2026 г.",
    sections: [
      {
        id: "about",
        title: "Что мы используем и зачем",
        blocks: [
          {
            kind: "p",
            text: "Cookie — небольшие файлы, которые сайт хранит в вашем браузере. HackOS использует их, а также локальное и сессионное хранилище браузера, только чтобы вы оставались в учётной записи, попадали в нужное рабочее пространство и сохраняли свои настройки.",
          },
          {
            kind: "p",
            text: "Мы не используем рекламные cookie и стороннюю аналитику, и сайт не загружает никаких скриптов отслеживания.",
          },
        ],
      },
      {
        id: "cookies",
        title: "Файлы cookie",
        blocks: [
          {
            kind: "p",
            text: "Все они строго необходимы: без них не работали бы вход и переход между рабочими пространствами.",
          },
          {
            kind: "table",
            head: ["Название", "Назначение", "Срок"],
            rows: [
              ["access_token", "Сохраняет вход в учётную запись. Устанавливается нашим сервером; скрипты страницы не могут его прочитать, а в рабочей среде он передаётся только по HTTPS.", "30 дней или до выхода из учётной записи"],
              ["hh_elev", "Только в консоли владельца платформы: показывает, что второй шаг входа пройден.", "12 часов"],
              ["hh_role", "Ваша роль в текущем рабочем пространстве — чтобы открывался нужный портал.", "14 дней"],
              ["hh_email", "Учётная запись, в которую выполнен вход в этом браузере, — чтобы никогда не показывать сохранённое состояние другой учётной записи.", "14 дней"],
              ["hh_status", "Для участников: статус вашей регистрации — чтобы не предлагать страницы, которые для вас ещё закрыты.", "14 дней"],
              ["hh_event", "Выбранное вами рабочее пространство мероприятия.", "30 дней"],
            ],
          },
        ],
      },
      {
        id: "storage",
        title: "Хранилище браузера",
        blocks: [
          {
            kind: "p",
            text: "Эти записи остаются в вашем браузере и не отправляются на наши серверы. Локальное хранилище сохраняется, пока вы его не очистите, сессионное — пока вы не закроете вкладку.",
          },
          {
            kind: "table",
            head: ["Ключ", "Назначение", "Хранится"],
            rows: [
              ["hh_lang", "Выбранный вами язык интерфейса.", "Пока вы не очистите"],
              ["hh_theme, hs_theme", "Светлая или тёмная тема на платформе и на этом сайте.", "Пока вы не очистите"],
              ["hh_active_event_id", "Для организаторов: мероприятие, с которого открывается панель управления.", "Пока вы не очистите"],
              ["hh_hacker_profile_v1_…", "Для участников: копия вашего профиля — чтобы ваши данные были видны, пока страница загружается.", "Пока вы не очистите"],
              ["hh:hacker_help:draft_v2", "Начатый, но не отправленный запрос помощи.", "Пока вы не отправите или не очистите"],
              ["hackos:presenter:…", "Для организаторов: таймер выступлений — чтобы перезагрузка страницы его не сбрасывала.", "Пока вы не очистите"],
              ["hh_verify", "Нужно ли ещё подтвердить ваш адрес почты.", "Пока вы не закроете вкладку"],
              ["hh_platform_notice, hh_platform_notice_dismissed", "Уведомление о работе сервиса или плановых работах и то, скрыли ли вы его.", "Пока вы не закроете вкладку"],
            ],
          },
        ],
      },
      {
        id: "choices",
        title: "Ваш выбор",
        blocks: [
          {
            kind: "p",
            text: "Поскольку все наши cookie нужны для работы сервиса, включать или отключать нечего, и баннера согласия нет. Вы можете в любое время удалить cookie и сохранённые данные в настройках браузера; после этого вы выйдете из учётной записи, а ваши настройки сбросятся.",
          },
        ],
      },
      {
        id: "contact",
        title: "Контакты",
        operator: true,
        blocks: [{ kind: "p", text: "Вопросы о cookie: напишите на {email}." }],
      },
    ],
  },
};
