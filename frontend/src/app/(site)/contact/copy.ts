/**
 * The contact page's words, in three languages, kept next to the page like
 * the home page's copy (../welcome/copy.ts).
 *
 * The enquiry itself still reaches the sales inbox in English: the select
 * boxes send their English values, and only what the visitor reads changes.
 */

export type Lang = "en" | "az" | "ru";

/** What the form sends for each option (read in the inbox); the labels are below. */
export const ROLE_VALUES = ["Organiser", "Career centre", "HR / recruitment", "Public sector", "Other"] as const;
export const SIZE_VALUES = ["Under 100", "100–300", "300–600", "Over 600", "Not sure yet"] as const;

export interface ContactCopy {
  eyebrow: string;
  title: string;
  lead: string;
  info: { email: string; based: string; basedValue: string; response: string; responseValue: string; languages: string };
  lookAround: string;
  seePlans: string;
  form: {
    title: string;
    minutes: string;
    sentTitle: string;
    /** "{email}" is the address the reply goes to. */
    sentBody: string;
    name: string;
    org: string;
    email: string;
    youAre: string;
    /** Same order as ROLE_VALUES. */
    roles: string[];
    participants: string;
    /** Same order as SIZE_VALUES. */
    sizes: string[];
    dates: string;
    datesPlaceholder: string;
    more: string;
    morePlaceholder: string;
    sending: string;
    send: string;
    failed: string;
    /** "{email}" becomes a link to the address. */
    writeTo: string;
    privacy: string;
    /** Shown above the form when it was opened from an Enterprise link (?topic=enterprise). */
    topicEnterprise: string;
    /** Shown above the form when it was opened from the Community card's "Apply" (?topic=community). */
    topicCommunity: string;
  };
  next: { title: string; steps: { title: string; body: string }[]; rates: string };
}

const en: ContactCopy = {
  eyebrow: "Contact",
  title: "Tell us about your event",
  lead: "The dates, roughly how many people, and how you judge. That is enough for a quote and a walkthrough — and if the platform is the wrong fit for what you are running, we will say so rather than sell you a plan.",
  info: {
    email: "Email",
    based: "Based in",
    basedValue: "Baku, Azerbaijan",
    response: "Response",
    responseValue: "Usually the same working day",
    languages: "Languages",
  },
  lookAround: "Look around first",
  seePlans: "See plans",
  form: {
    title: "Enquiry",
    minutes: "2 minutes",
    sentTitle: "Thanks — your message is with us.",
    sentBody: "We reply to {email}, usually the same working day.",
    name: "Your name",
    org: "Organisation",
    email: "Work email",
    youAre: "You are",
    roles: ["Organiser", "Career centre", "HR / recruitment", "Public sector", "Other"],
    participants: "Participants",
    sizes: ["Under 100", "100–300", "300–600", "Over 600", "Not sure yet"],
    dates: "Approximate dates",
    datesPlaceholder: "e.g. second week of March",
    more: "Anything else",
    morePlaceholder: "How you judge, whether you need it on your own infrastructure, anything procurement will ask.",
    sending: "Sending…",
    send: "Send enquiry",
    failed: "The message could not be sent.",
    writeTo: "You can also write to {email}.",
    privacy: "Name, organisation and a work e-mail are enough. We use them only to reply.",
    topicEnterprise: "About the Enterprise plan",
    topicCommunity: "Applying for the free Community plan",
  },
  next: {
    title: "What happens after you write",
    steps: [
      { title: "We read it properly", body: "Someone who knows the product replies, usually the same working day, with questions if we have them." },
      { title: "A walkthrough", body: "Thirty to forty-five minutes on your actual event: your dates, your judging, your roles." },
      { title: "A figure, not a range", body: "A quote for your programme, and if the fit is wrong we say that instead." },
    ],
    rates: "University and non-profit rates exist — say which you are and it will be in the quote.",
  },
};

const az: ContactCopy = {
  eyebrow: "Əlaqə",
  title: "Tədbirin haqqında danış",
  lead: "Tarixlər, təxminən neçə nəfər və necə qiymətləndirirsən. Qiymət təklifi və nümayiş üçün bu kifayətdir — platforma apardığın işə uyğun deyilsə, sənə plan satmaq əvəzinə bunu açıq deyəcəyik.",
  info: {
    email: "E-poçt",
    based: "Yerləşirik",
    basedValue: "Bakı, Azərbaycan",
    response: "Cavab",
    responseValue: "Adətən həmin iş günü",
    languages: "Dillər",
  },
  lookAround: "Əvvəlcə platformaya bax",
  seePlans: "Planlara bax",
  form: {
    title: "Sorğu",
    minutes: "2 dəqiqə",
    sentTitle: "Təşəkkürlər — mesajın bizə çatdı.",
    sentBody: "{email} ünvanına adətən həmin iş günü cavab veririk.",
    name: "Adın",
    org: "Təşkilat",
    email: "İş e-poçtu",
    youAre: "Rolun",
    roles: ["Təşkilatçı", "Karyera mərkəzi", "HR / işə qəbul", "Dövlət sektoru", "Digər"],
    participants: "İştirakçılar",
    sizes: ["100-dən az", "100–300", "300–600", "600-dən çox", "Hələ bilmirəm"],
    dates: "Təxmini tarixlər",
    datesPlaceholder: "məs. martın ikinci həftəsi",
    more: "Əlavə qeydlər",
    morePlaceholder: "Necə qiymətləndirirsən, öz infrastrukturunda lazımdırmı, satınalma şöbəsinin soruşacağı hər şey.",
    sending: "Göndərilir…",
    send: "Sorğunu göndər",
    failed: "Mesaj göndərilmədi.",
    writeTo: "{email} ünvanına birbaşa da yaza bilərsən.",
    privacy: "Ad, təşkilat və iş e-poçtu kifayətdir. Onlardan yalnız cavab vermək üçün istifadə edirik.",
    topicEnterprise: "Enterprise planı haqqında",
    topicCommunity: "Pulsuz Community planına müraciət",
  },
  next: {
    title: "Yazdıqdan sonra nə olur",
    steps: [
      { title: "Diqqətlə oxuyuruq", body: "Məhsulu bilən biri adətən həmin iş günü cavab verir; sualımız olsa, soruşuruq." },
      { title: "Nümayiş", body: "Sənin real tədbirin üzərində otuz-qırx beş dəqiqə: tarixlərin, qiymətləndirmən, rolların." },
      { title: "Diapazon yox, konkret rəqəm", body: "Proqramın üçün qiymət təklifi; uyğun deyiliksə, bunu açıq deyirik." },
    ],
    rates: "Universitet və qeyri-kommersiya təşkilatları üçün xüsusi qiymətlər var — kim olduğunu yaz, təklifdə nəzərə alınacaq.",
  },
};

const ru: ContactCopy = {
  eyebrow: "Контакты",
  title: "Расскажите о вашем событии",
  lead: "Даты, примерное число людей и как вы оцениваете работы. Этого достаточно для расчёта и демонстрации — а если платформа не подходит под ваше событие, мы так и скажем, а не будем продавать тариф.",
  info: {
    email: "Почта",
    based: "Где мы",
    basedValue: "Баку, Азербайджан",
    response: "Ответ",
    responseValue: "Обычно в тот же рабочий день",
    languages: "Языки",
  },
  lookAround: "Сначала посмотреть",
  seePlans: "Посмотреть тарифы",
  form: {
    title: "Запрос",
    minutes: "2 минуты",
    sentTitle: "Спасибо — ваше сообщение у нас.",
    sentBody: "Мы ответим на {email}, обычно в тот же рабочий день.",
    name: "Ваше имя",
    org: "Организация",
    email: "Рабочая почта",
    youAre: "Вы",
    roles: ["Организатор", "Карьерный центр", "HR / рекрутинг", "Госсектор", "Другое"],
    participants: "Участники",
    sizes: ["Меньше 100", "100–300", "300–600", "Больше 600", "Пока не знаю"],
    dates: "Примерные даты",
    datesPlaceholder: "например, вторая неделя марта",
    more: "Что-то ещё",
    morePlaceholder: "Как вы оцениваете, нужна ли своя инфраструктура, всё, о чём спросят закупки.",
    sending: "Отправка…",
    send: "Отправить запрос",
    failed: "Не удалось отправить сообщение.",
    writeTo: "Можно также написать на {email}.",
    privacy: "Достаточно имени, организации и рабочей почты. Мы используем их только для ответа.",
    topicEnterprise: "О тарифе Enterprise",
    topicCommunity: "Заявка на бесплатный тариф Community",
  },
  next: {
    title: "Что происходит после вашего письма",
    steps: [
      { title: "Мы внимательно читаем", body: "Отвечает человек, который знает продукт, — обычно в тот же рабочий день, с вопросами, если они есть." },
      { title: "Демонстрация", body: "Тридцать–сорок пять минут о вашем реальном событии: ваши даты, ваша оценка, ваши роли." },
      { title: "Цифра, а не диапазон", body: "Расчёт для вашей программы, а если мы не подходим — так и скажем." },
    ],
    rates: "Для университетов и некоммерческих организаций есть отдельные условия — укажите, кто вы, и это будет в расчёте.",
  },
};

export const CONTACT_COPY: Record<Lang, ContactCopy> = { en, az, ru };
