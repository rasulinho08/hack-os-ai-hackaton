/* Prices and discounts on the public pricing page and in checkout — Russian. */
import type { TranslationMap } from "../types";

const ru: TranslationMap = {
  "price.was": "Было {price}",
  "price.save": "Экономия {n}%",
  "price.offer": "{name}: {value}",
  "price.offer_until": "До {date}",
  "price.offer_first": "Только для первого заказа",
  "price.edu_note": "Университет или некоммерческая организация? {value} после короткой проверки при заказе.",
  "price.off_sale": "Сейчас не продаётся",
  "price.off_sale_body": "Напишите нам, и мы подберём подходящий тариф.",
  "price.off_sale_cta": "Связаться с нами",

  "price.code.toggle": "Есть промокод?",
  "price.code.label": "Промокод",
  "price.code.placeholder": "например, LAUNCH20",
  "price.code.apply": "Применить",
  "price.code.checking": "Проверяем…",
  "price.code.remove": "Убрать код",
  "price.code.applied": "{code} применён: {value}",
  "price.code.better_offer": "{code} действует, но скидка «{offer}» уже даёт больше. Скидки не суммируются.",
  "price.code.err.COUPON_NOT_FOUND": "Такого кода нет. Проверьте написание.",
  "price.code.err.COUPON_PAUSED": "Этот код сейчас не действует.",
  "price.code.err.COUPON_NOT_STARTED": "Этот код ещё не начал действовать.",
  "price.code.err.COUPON_EXPIRED": "Срок действия этого кода истёк.",
  "price.code.err.COUPON_USED_UP": "Этот код уже использован максимальное число раз.",
  "price.code.err.COUPON_CUSTOMER_LIMIT": "Ваша организация уже использовала этот код.",
  "price.code.err.COUPON_FIRST_PURCHASE": "Этот код только для первого заказа организации.",
  "price.code.err.COUPON_PLAN": "Этот код не для тарифа {plan}.",
  "price.code.err.COUPON_PERIOD": "Этот код не для этого периода оплаты. Попробуйте другой.",
  "price.code.err.COUPON_NOT_YOURS": "Этот код выдан другой организации. Войдите и выберите организацию, которой он выдан.",
  "price.code.err.RATE_LIMITED": "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
  "price.code.err.generic": "Не удалось проверить код. Попробуйте ещё раз.",

  "price.edu.label": "Мы университет, школа или некоммерческая организация",
  "price.edu.hint": "Скидка {value} на этот тариф. Мы проверяем это до подтверждения заказа; если скидка не подойдёт, сообщим до выставления счёта.",
  "price.edu.education": "Университет или школа",
  "price.edu.nonprofit": "Некоммерческая организация",
  "price.edu.institution": "Учреждение или организация",
  "price.edu.institution_hint": "Официальное название, например, ADA University",

  "price.summary.price": "Цена тарифа",
  "price.summary.discount": "Скидка",
  "price.summary.subtotal": "Промежуточный итог",
  "price.summary.review": "Применяется после нашей проверки",
  "price.review.discount": "Скидка",
  "price.done.discount": "Скидка: {label}",
  "price.done.discount_review": "Скидка {label}, применяется после нашей проверки",
  "price.plan.off_sale": "Не продаётся",
  "price.err.PLAN_NOT_ON_SALE": "Этот тариф сейчас не продаётся. Выберите другой или напишите нам.",
};

export default ru;
