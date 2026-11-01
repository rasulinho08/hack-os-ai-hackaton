/* Prices and discounts on the public pricing page and in checkout — English, the source for these keys. */
import type { TranslationMap } from "../types";

const en: TranslationMap = {
  /* Pricing page: a struck-through price, a campaign, a plan off sale. */
  "price.was": "Was {price}",
  "price.save": "Save {n}%",
  "price.offer": "{name}: {value}",
  "price.offer_until": "Until {date}",
  "price.offer_first": "First order only",
  "price.edu_note": "University or non-profit? {value}, after a quick check at checkout.",
  "price.off_sale": "Not on sale right now",
  "price.off_sale_body": "Talk to us and we will find the right plan for you.",
  "price.off_sale_cta": "Talk to us",

  /* Checkout: the code field. */
  "price.code.toggle": "Have a code?",
  "price.code.label": "Discount code",
  "price.code.placeholder": "e.g. LAUNCH20",
  "price.code.apply": "Apply",
  "price.code.checking": "Checking…",
  "price.code.remove": "Remove code",
  "price.code.applied": "{code} applied: {value}",
  "price.code.better_offer": "{code} works, but the {offer} discount already gives you more. Discounts do not add up.",
  "price.code.err.COUPON_NOT_FOUND": "We do not know this code. Check the spelling.",
  "price.code.err.COUPON_PAUSED": "This code is not active at the moment.",
  "price.code.err.COUPON_NOT_STARTED": "This code is not valid yet.",
  "price.code.err.COUPON_EXPIRED": "This code has expired.",
  "price.code.err.COUPON_USED_UP": "This code has been used as many times as it can be.",
  "price.code.err.COUPON_CUSTOMER_LIMIT": "Your organisation has already used this code.",
  "price.code.err.COUPON_FIRST_PURCHASE": "This code is for an organisation's first order only.",
  "price.code.err.COUPON_PLAN": "This code is not for the {plan} plan.",
  "price.code.err.COUPON_PERIOD": "This code is not for this billing period. Try the other one.",
  "price.code.err.COUPON_NOT_YOURS": "This code was given to another organisation. Sign in and choose the organisation it was given to.",
  "price.code.err.RATE_LIMITED": "Too many codes tried. Wait a few minutes and try again.",
  "price.code.err.generic": "The code could not be checked just now. Try again.",

  /* Checkout: the university / non-profit claim. */
  "price.edu.label": "We are a university, a school or a non-profit",
  "price.edu.hint": "{value} off this plan. We check it before we approve the order; if it does not apply, we tell you before the invoice.",
  "price.edu.education": "A university or a school",
  "price.edu.nonprofit": "A non-profit organisation",
  "price.edu.institution": "Institution or organisation",
  "price.edu.institution_hint": "As registered, e.g. ADA University",

  /* Checkout: the order summary. */
  "price.summary.price": "Plan price",
  "price.summary.discount": "Discount",
  "price.summary.subtotal": "Subtotal",
  "price.summary.review": "Applied after our review",
  "price.review.discount": "Discount",
  "price.done.discount": "Discount: {label}",
  "price.done.discount_review": "Discount {label}, applied after our review",
  "price.plan.off_sale": "Not on sale",
  "price.err.PLAN_NOT_ON_SALE": "This plan is not on sale at the moment. Choose another plan or talk to us.",
};

export default en;
