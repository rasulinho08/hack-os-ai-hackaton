/**
 * The words of the hackathon directory (/hackathons) in the site's three
 * languages. The events themselves are written by their organisers.
 */

import type { DirectoryFormat, DirectoryStatus, StatusWords } from "@/lib/directory";

export type DirectoryLang = "az" | "en" | "ru";

export interface DirectoryCopy {
  chapter: string;
  title: string;
  lead: string;
  meta: { title: string; description: string };
  search: { label: string; placeholder: string; submit: string; clear: string };
  filters: {
    label: string;
    status: string;
    format: string;
    city: string;
    all: string;
    allCities: string;
    statuses: Record<DirectoryStatus, string>;
    reset: string;
  };
  formats: Record<DirectoryFormat, string>;
  status: StatusWords;
  team: { range: string; upTo: string; exactly: string; any: string };
  facts: { when: string; where: string; team: string };
  /** The mark on an event HackOS pinned to the top. */
  featured: string;
  organisedBy: string;
  open: string;
  count: { one: string; many: string };
  sections: { now: string; past: string };
  empty: { title: string; body: string; filtered: string };
  failed: { title: string; body: string; retry: string };
  pager: { label: string; prev: string; next: string; page: string };
  cta: { title: string; body: string; primary: string; secondary: string };
}

export const DIRECTORY_COPY: Record<DirectoryLang, DirectoryCopy> = {
  en: {
    chapter: "Hackathons",
    title: "Hackathons on HackOS",
    lead: "Upcoming and past hackathons run by universities, companies and public bodies. Find one, see the dates and register on its page.",
    meta: {
      title: "Hackathons",
      description: "Upcoming, running and past hackathons on HackOS: dates, format, place and team size. Register on the event's page.",
    },
    search: { label: "Search hackathons", placeholder: "Name, organiser or city", submit: "Search", clear: "Clear search" },
    filters: {
      label: "Filters",
      status: "Status",
      format: "Format",
      city: "City",
      all: "All",
      allCities: "All cities",
      statuses: { open: "Registration open", upcoming: "Upcoming", running: "Running", past: "Finished" },
      reset: "Clear filters",
    },
    formats: { online: "Online", offline: "In person", hybrid: "Hybrid" },
    status: {
      openUntil: "Registration open until {date}",
      open: "Registration open",
      opens: "Registration opens {date}",
      closed: "Registration closed",
      running: "Running now",
      past: "Finished",
    },
    team: { range: "Teams of {min}–{max}", upTo: "Solo or teams up to {n}", exactly: "Teams of {n}", any: "Any team size" },
    facts: { when: "When", where: "Where", team: "Team size" },
    featured: "Featured",
    organisedBy: "by {who}",
    open: "Open the event page",
    count: { one: "{n} hackathon", many: "{n} hackathons" },
    sections: { now: "Open and upcoming", past: "Finished" },
    empty: {
      title: "No hackathons listed yet",
      body: "Events appear here when their organisers publish them. Check back soon.",
      filtered: "Nothing matches these filters. Try another city or status.",
    },
    failed: { title: "The list did not load", body: "Check the connection and try again.", retry: "Try again" },
    pager: { label: "Pages", prev: "Previous", next: "Next", page: "Page {n} of {total}" },
    cta: {
      title: "Organising a hackathon?",
      body: "Publish it on HackOS and it appears here: registration, teams, judging and certificates in one place.",
      primary: "See the plans",
      secondary: "Try the walkthrough",
    },
  },
  az: {
    chapter: "Hackathonlar",
    title: "HackOS-da hackathonlar",
    lead: "Universitetlərin, şirkətlərin və dövlət qurumlarının keçirdiyi qarşıdakı və keçmiş hackathonlar. Birini seçin, tarixlərə baxın və tədbirin səhifəsində qeydiyyatdan keçin.",
    meta: {
      title: "Hackathonlar",
      description: "HackOS-da qarşıdakı, davam edən və keçmiş hackathonlar: tarixlər, format, məkan və komanda ölçüsü. Qeydiyyat tədbirin səhifəsindədir.",
    },
    search: { label: "Hackathon axtarışı", placeholder: "Ad, təşkilatçı və ya şəhər", submit: "Axtar", clear: "Axtarışı təmizlə" },
    filters: {
      label: "Filtrlər",
      status: "Status",
      format: "Format",
      city: "Şəhər",
      all: "Hamısı",
      allCities: "Bütün şəhərlər",
      statuses: { open: "Qeydiyyat açıqdır", upcoming: "Qarşıdakı", running: "Davam edir", past: "Başa çatıb" },
      reset: "Filtrləri təmizlə",
    },
    formats: { online: "Onlayn", offline: "Əyani", hybrid: "Hibrid" },
    status: {
      openUntil: "Qeydiyyat {date} tarixinədək açıqdır",
      open: "Qeydiyyat açıqdır",
      opens: "Qeydiyyat {date} tarixində açılır",
      closed: "Qeydiyyat bağlanıb",
      running: "Hazırda davam edir",
      past: "Başa çatıb",
    },
    team: { range: "{min}–{max} nəfərlik komandalar", upTo: "Fərdi və ya {n} nəfərədək komanda", exactly: "{n} nəfərlik komandalar", any: "İstənilən komanda ölçüsü" },
    facts: { when: "Nə vaxt", where: "Harada", team: "Komanda ölçüsü" },
    featured: "Seçilmiş",
    organisedBy: "Təşkilatçı: {who}",
    open: "Tədbirin səhifəsini aç",
    count: { one: "{n} hackathon", many: "{n} hackathon" },
    sections: { now: "Açıq və qarşıdakı", past: "Başa çatanlar" },
    empty: {
      title: "Hələ siyahıda hackathon yoxdur",
      body: "Təşkilatçılar tədbirlərini dərc etdikdə onlar burada görünür. Tezliklə yenidən baxın.",
      filtered: "Bu filtrlərə uyğun tədbir tapılmadı. Başqa şəhər və ya status seçin.",
    },
    failed: { title: "Siyahı yüklənmədi", body: "Bağlantını yoxlayın və yenidən cəhd edin.", retry: "Yenidən cəhd edin" },
    pager: { label: "Səhifələr", prev: "Əvvəlki", next: "Növbəti", page: "Səhifə {n} / {total}" },
    cta: {
      title: "Hackathon təşkil edirsiniz?",
      body: "Tədbiri HackOS-da dərc edin və o, burada görünsün: qeydiyyat, komandalar, qiymətləndirmə və sertifikatlar bir yerdə.",
      primary: "Planlara baxın",
      secondary: "Nümayişi açın",
    },
  },
  ru: {
    chapter: "Хакатоны",
    title: "Хакатоны на HackOS",
    lead: "Предстоящие и прошедшие хакатоны университетов, компаний и государственных организаций. Выберите хакатон, посмотрите даты и зарегистрируйтесь на его странице.",
    meta: {
      title: "Хакатоны",
      description: "Предстоящие, текущие и прошедшие хакатоны на HackOS: даты, формат, место и размер команды. Регистрация — на странице мероприятия.",
    },
    search: { label: "Поиск хакатонов", placeholder: "Название, организатор или город", submit: "Найти", clear: "Очистить поиск" },
    filters: {
      label: "Фильтры",
      status: "Статус",
      format: "Формат",
      city: "Город",
      all: "Все",
      allCities: "Все города",
      statuses: { open: "Идёт регистрация", upcoming: "Предстоящие", running: "Идут сейчас", past: "Завершённые" },
      reset: "Сбросить фильтры",
    },
    formats: { online: "Онлайн", offline: "Очно", hybrid: "Гибрид" },
    status: {
      openUntil: "Регистрация открыта до {date}",
      open: "Регистрация открыта",
      opens: "Регистрация откроется {date}",
      closed: "Регистрация закрыта",
      running: "Идёт сейчас",
      past: "Завершён",
    },
    team: { range: "Команды по {min}–{max} человек", upTo: "Соло или команды до {n} человек", exactly: "Команды по {n} человек", any: "Любой размер команды" },
    facts: { when: "Когда", where: "Где", team: "Размер команды" },
    featured: "Рекомендуем",
    organisedBy: "Организатор: {who}",
    open: "Открыть страницу мероприятия",
    count: { one: "Хакатонов: {n}", many: "Хакатонов: {n}" },
    sections: { now: "Открытые и предстоящие", past: "Завершённые" },
    empty: {
      title: "Пока здесь нет хакатонов",
      body: "Мероприятия появляются здесь, когда организаторы их публикуют. Загляните позже.",
      filtered: "По этим фильтрам ничего не найдено. Попробуйте другой город или статус.",
    },
    failed: { title: "Список не загрузился", body: "Проверьте соединение и попробуйте снова.", retry: "Попробовать снова" },
    pager: { label: "Страницы", prev: "Назад", next: "Вперёд", page: "Страница {n} из {total}" },
    cta: {
      title: "Организуете хакатон?",
      body: "Опубликуйте его на HackOS, и он появится здесь: регистрация, команды, оценка и сертификаты в одном месте.",
      primary: "Посмотреть тарифы",
      secondary: "Открыть демо",
    },
  },
};

export function directoryCopy(lang: string): DirectoryCopy {
  return DIRECTORY_COPY[(lang in DIRECTORY_COPY ? lang : "en") as DirectoryLang];
}

export function countText(copy: DirectoryCopy, n: number): string {
  return (n === 1 ? copy.count.one : copy.count.many).replace("{n}", String(n));
}
