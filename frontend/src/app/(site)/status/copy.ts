/**
 * The words of the status page in the three languages of the site: what is
 * checked, what each state means for someone using the platform, and when it
 * was last looked at.
 */

import type { CheckKey, CheckState, Overall } from "@/lib/platformStatus";

export type StatusLang = "az" | "en" | "ru";

export interface StatusCopy {
  chapter: string;
  title: string;
  lead: string;
  overall: Record<Overall, { title: string; body: string }>;
  state: Record<CheckState, string>;
  checksLabel: string;
  /** Per check: its name, what it is for, and a sentence per state it can be in. */
  checks: Record<CheckKey, { name: string; what: string } & Partial<Record<CheckState, string>> & { unknown: string }>;
  latency: string;
  lag: { none: string; s: string; min: string };
  updated: string;
  auto: string;
  refresh: string;
  checking: string;
  version: string;
  help: { title: string; body: string; cta: string };
}

export const STATUS_COPY: Record<StatusLang, StatusCopy> = {
  en: {
    chapter: "Status",
    title: "HackOS status",
    lead: "Whether the platform works right now: the API, the database, background jobs and e-mail. The page checks again every minute.",
    overall: {
      ok: { title: "Everything is working", body: "Every check passes." },
      degraded: { title: "Working, with problems", body: "The platform is up, but a part of it is slow or limited. The checks below say which." },
      down: { title: "The platform is down", body: "Pages and actions that need data do not work right now." },
      unreachable: { title: "No answer from the platform", body: "This page could not reach HackOS. If that lasts more than a few minutes, the platform is down — or this network blocks it." },
    },
    state: { ok: "Working", degraded: "Degraded", down: "Down", off: "Off", unknown: "Unknown" },
    checksLabel: "Checks",
    checks: {
      api: { name: "API", what: "The service the pages and apps talk to.", ok: "Answers requests.", down: "Does not answer requests.", unknown: "Not checked." },
      database: {
        name: "Database", what: "Where events, people and projects are kept.",
        ok: "Reads and saves data.", degraded: "Slow to answer: pages load slowly.", down: "Does not answer: nothing can be read or saved.", unknown: "Not checked.",
      },
      jobs: {
        name: "Background jobs", what: "Announcements, e-mails, Telegram messages and reminders.",
        ok: "Messages go out on time.", degraded: "Running behind: messages go out late.", down: "Stopped: messages are not going out.", unknown: "Could not be checked.",
      },
      mail: {
        name: "E-mail", what: "Invitations, confirmations and notifications.",
        ok: "Set up: invitations and notifications go out by e-mail.", off: "Not set up: nothing goes out by e-mail.", unknown: "Not checked.",
      },
    },
    latency: "Response: {ms} ms",
    lag: { none: "No delay", s: "Longest wait: {n} s", min: "Longest wait: {n} min" },
    updated: "Last checked {time}",
    auto: "Checks again every minute.",
    refresh: "Check now",
    checking: "Checking…",
    version: "Version {v}",
    help: {
      title: "Something not working for you?",
      body: "If this page says everything works but something is broken for you, tell us what you see.",
      cta: "Contact us",
    },
  },
  az: {
    chapter: "Status",
    title: "HackOS-un vəziyyəti",
    lead: "Platformanın hazırda işləyib-işləmədiyi: API, verilənlər bazası, fon tapşırıqları və e-poçt. Səhifə hər dəqiqə yenidən yoxlayır.",
    overall: {
      ok: { title: "Hər şey işləyir", body: "Bütün yoxlamalar uğurludur." },
      degraded: { title: "İşləyir, amma problemlər var", body: "Platforma işləyir, lakin bir hissəsi yavaşdır və ya məhduddur. Hansı olduğu aşağıdakı yoxlamalarda görünür." },
      down: { title: "Platforma işləmir", body: "Məlumat tələb edən səhifələr və əməliyyatlar hazırda işləmir." },
      unreachable: { title: "Platformadan cavab yoxdur", body: "Bu səhifə HackOS-a qoşula bilmədi. Bir neçə dəqiqədən çox davam edərsə, platforma işləmir — ya da bu şəbəkə onu bloklayır." },
    },
    state: { ok: "İşləyir", degraded: "Problem var", down: "İşləmir", off: "Söndürülüb", unknown: "Məlum deyil" },
    checksLabel: "Yoxlamalar",
    checks: {
      api: { name: "API", what: "Səhifələrin və tətbiqlərin müraciət etdiyi xidmət.", ok: "Sorğulara cavab verir.", down: "Sorğulara cavab vermir.", unknown: "Yoxlanmayıb." },
      database: {
        name: "Verilənlər bazası", what: "Tədbirlər, insanlar və layihələr burada saxlanılır.",
        ok: "Məlumatları oxuyur və saxlayır.", degraded: "Gec cavab verir: səhifələr yavaş açılır.", down: "Cavab vermir: heç nə oxunmur və saxlanmır.", unknown: "Yoxlanmayıb.",
      },
      jobs: {
        name: "Fon tapşırıqları", what: "Elanlar, e-məktublar, Telegram mesajları və xatırlatmalar.",
        ok: "Mesajlar vaxtında gedir.", degraded: "Gecikir: mesajlar gec gedir.", down: "Dayanıb: mesajlar getmir.", unknown: "Yoxlamaq alınmadı.",
      },
      mail: {
        name: "E-poçt", what: "Dəvətlər, təsdiqlər və bildirişlər.",
        ok: "Qurulub: dəvətlər və bildirişlər e-poçtla gedir.", off: "Qurulmayıb: e-poçtla heç nə getmir.", unknown: "Yoxlanmayıb.",
      },
    },
    latency: "Cavab: {ms} ms",
    lag: { none: "Gecikmə yoxdur", s: "Ən uzun gözləmə: {n} san", min: "Ən uzun gözləmə: {n} dəq" },
    updated: "Son yoxlama: {time}",
    auto: "Hər dəqiqə yenidən yoxlanılır.",
    refresh: "İndi yoxla",
    checking: "Yoxlanılır…",
    version: "Versiya {v}",
    help: {
      title: "Sizdə nəsə işləmir?",
      body: "Bu səhifə hər şeyin işlədiyini desə də, sizdə nəsə xarabdırsa, nə gördüyünüzü bizə yazın.",
      cta: "Bizimlə əlaqə",
    },
  },
  ru: {
    chapter: "Статус",
    title: "Статус HackOS",
    lead: "Работает ли платформа прямо сейчас: API, база данных, фоновые задачи и почта. Страница проверяет заново каждую минуту.",
    overall: {
      ok: { title: "Всё работает", body: "Все проверки пройдены." },
      degraded: { title: "Работает, но с проблемами", body: "Платформа работает, но какая-то её часть медленная или ограничена. Какая — видно в проверках ниже." },
      down: { title: "Платформа не работает", body: "Страницы и действия, которым нужны данные, сейчас не работают." },
      unreachable: { title: "Платформа не отвечает", body: "Эта страница не смогла связаться с HackOS. Если это длится больше нескольких минут, платформа не работает — или эта сеть её блокирует." },
    },
    state: { ok: "Работает", degraded: "С проблемами", down: "Не работает", off: "Выключено", unknown: "Неизвестно" },
    checksLabel: "Проверки",
    checks: {
      api: { name: "API", what: "Сервис, к которому обращаются страницы и приложения.", ok: "Отвечает на запросы.", down: "Не отвечает на запросы.", unknown: "Не проверялось." },
      database: {
        name: "База данных", what: "Здесь хранятся мероприятия, люди и проекты.",
        ok: "Читает и сохраняет данные.", degraded: "Отвечает медленно: страницы загружаются дольше.", down: "Не отвечает: ничего нельзя прочитать или сохранить.", unknown: "Не проверялось.",
      },
      jobs: {
        name: "Фоновые задачи", what: "Объявления, письма, сообщения в Telegram и напоминания.",
        ok: "Сообщения уходят вовремя.", degraded: "Отстают: сообщения уходят с опозданием.", down: "Остановлены: сообщения не уходят.", unknown: "Не удалось проверить.",
      },
      mail: {
        name: "Почта", what: "Приглашения, подтверждения и уведомления.",
        ok: "Настроена: приглашения и уведомления уходят по почте.", off: "Не настроена: по почте ничего не уходит.", unknown: "Не проверялось.",
      },
    },
    latency: "Ответ: {ms} мс",
    lag: { none: "Без задержек", s: "Дольше всех ждёт: {n} с", min: "Дольше всех ждёт: {n} мин" },
    updated: "Последняя проверка: {time}",
    auto: "Проверяется заново каждую минуту.",
    refresh: "Проверить сейчас",
    checking: "Проверяем…",
    version: "Версия {v}",
    help: {
      title: "У вас что-то не работает?",
      body: "Если эта страница говорит, что всё работает, а у вас что-то сломано, напишите нам, что вы видите.",
      cta: "Написать нам",
    },
  },
};

export function statusCopy(lang: string): StatusCopy {
  return lang === "az" || lang === "ru" ? STATUS_COPY[lang] : STATUS_COPY.en;
}

/** The sentence for a check in a state; the "unknown" one when the check has none for it. */
export function checkSentence(copy: StatusCopy, key: CheckKey, state: CheckState): string {
  return copy.checks[key][state] ?? copy.checks[key].unknown;
}
