/*
 * Refund policy. It states only what the order flow does (review, invoice on
 * approval paid by bank transfer, no card payment, refused orders not
 * invoiced) and where to write; the
 * commercial terms of a refund are the order's own, not invented here.
 */
import type { LegalDocSet } from "./types";

export const REFUNDS: LegalDocSet = {
  en: {
    title: "Refund policy",
    summary:
      "How orders are reviewed and activated, what happens to a payment when an order is not activated, and how to ask for a refund.",
    updated: "23 October 2026",
    sections: [
      {
        id: "orders",
        title: "How an order works",
        blocks: [
          {
            kind: "p",
            text: "An order placed on the website is reviewed before anything is activated. If it is approved, the organisation becomes active and the person who placed the order receives a setup link by e-mail. If it is refused, the order is cancelled and you are told why.",
          },
        ],
      },
      {
        id: "payment",
        title: "Payment",
        blocks: [
          {
            kind: "list",
            items: [
              "Bank transfer against an invoice: we issue the invoice when we approve the order, and it is payable within 14 days with the order code as the reference. Before approval you can download an order confirmation, which is not an invoice. We record the payment when it arrives.",
              "Card: card payment is not offered at the moment. Orders placed earlier with a card were not charged; they are paid by invoice like any other.",
            ],
          },
          {
            kind: "p",
            text: "An organisation can be activated before a transfer arrives, and a transfer can arrive for an order that is already active.",
          },
        ],
      },
      {
        id: "refused",
        title: "When an order is not activated",
        blocks: [
          {
            kind: "p",
            text: "A refused order is not invoiced and nothing is owed. If you have already paid for an order that is then not activated, the payment is returned to you.",
          },
        ],
      },
      {
        id: "request",
        title: "Asking for a refund",
        blocks: [
          {
            kind: "p",
            text: "In any other case, write to {email} with your order number — you will find it in your account and on your invoice. Each request is handled according to the agreement for that order: the plan, the period and the terms you accepted when you ordered.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        operator: true,
        blocks: [{ kind: "p", text: "Questions about an order or a payment: write to {email}." }],
      },
    ],
  },

  az: {
    title: "Geri ödəmə siyasəti",
    summary:
      "Sifarişlər necə yoxlanılır və aktivləşdirilir, sifariş aktivləşdirilmədikdə ödənişlə nə olur və geri ödəməni necə istəmək olar.",
    updated: "23 oktyabr 2026",
    sections: [
      {
        id: "orders",
        title: "Sifariş necə işləyir",
        blocks: [
          {
            kind: "p",
            text: "Saytda verilən sifariş hər hansı bir şey aktivləşdirilməzdən əvvəl yoxlanılır. Təsdiqlənərsə, təşkilat aktiv olur və sifarişi verən şəxs e-poçtla quraşdırma linki alır. Rədd edilərsə, sifariş ləğv olunur və səbəbi sizə bildirilir.",
          },
        ],
      },
      {
        id: "payment",
        title: "Ödəniş",
        blocks: [
          {
            kind: "list",
            items: [
              "Hesab-faktura əsasında bank köçürməsi: hesab-fakturanı sifarişi təsdiqləyəndə veririk və o, sifariş kodu təyinatda göstərilməklə 14 gün ərzində ödənilir. Təsdiqdən əvvəl sifariş təsdiqini yükləyə bilərsiniz — bu, hesab-faktura deyil. Ödəniş daxil olanda onu qeydə alırıq.",
              "Kart: hazırda kartla ödəniş təklif olunmur. Əvvəllər kartla verilmiş sifarişlərdən pul tutulmayıb; onlar da digərləri kimi hesab-faktura ilə ödənilir.",
            ],
          },
          {
            kind: "p",
            text: "Təşkilat köçürmə daxil olmamışdan əvvəl aktivləşdirilə bilər, köçürmə isə artıq aktiv olan sifariş üçün də daxil ola bilər.",
          },
        ],
      },
      {
        id: "refused",
        title: "Sifariş aktivləşdirilmədikdə",
        blocks: [
          {
            kind: "p",
            text: "Rədd edilən sifariş üçün hesab-faktura verilmir və heç bir borc yaranmır. Sonradan aktivləşdirilməyən sifariş üçün artıq ödəniş etmisinizsə, ödəniş sizə qaytarılır.",
          },
        ],
      },
      {
        id: "request",
        title: "Geri ödəməni necə istəmək olar",
        blocks: [
          {
            kind: "p",
            text: "Digər hallarda sifariş nömrəsini göstərərək {email} ünvanına yazın — onu hesabınızda və fakturanızda tapa bilərsiniz. Hər müraciətə həmin sifarişin şərtlərinə uyğun baxılır: sifariş verərkən qəbul etdiyiniz plan, müddət və şərtlər.",
          },
        ],
      },
      {
        id: "contact",
        title: "Əlaqə",
        operator: true,
        blocks: [{ kind: "p", text: "Sifariş və ya ödənişlə bağlı suallar üçün {email} ünvanına yazın." }],
      },
    ],
  },

  ru: {
    title: "Политика возврата средств",
    summary:
      "Как проверяются и активируются заказы, что происходит с оплатой, если заказ не активирован, и как запросить возврат.",
    updated: "23 октября 2026 г.",
    sections: [
      {
        id: "orders",
        title: "Как работает заказ",
        blocks: [
          {
            kind: "p",
            text: "Заказ, оформленный на сайте, проверяется до того, как что-либо будет активировано. Если его одобряют, организация становится активной, а человек, оформивший заказ, получает по почте ссылку для настройки. Если его отклоняют, заказ отменяется, и вам сообщают причину.",
          },
        ],
      },
      {
        id: "payment",
        title: "Оплата",
        blocks: [
          {
            kind: "list",
            items: [
              "Банковский перевод по счёту: счёт выставляется при одобрении заказа и оплачивается в течение 14 дней, с кодом заказа в назначении платежа. До одобрения можно скачать подтверждение заказа — это не счёт. Мы фиксируем оплату, когда она поступает.",
              "Карта: оплата картой сейчас не принимается. По заказам, оформленным раньше с картой, деньги не списывались; они оплачиваются по счёту, как и остальные.",
            ],
          },
          {
            kind: "p",
            text: "Организация может быть активирована до поступления перевода, а перевод может поступить по заказу, который уже активен.",
          },
        ],
      },
      {
        id: "refused",
        title: "Если заказ не активирован",
        blocks: [
          {
            kind: "p",
            text: "По отклонённому заказу счёт не выставляется, и вы ничего не должны. Если вы уже оплатили заказ, который затем не был активирован, деньги вам возвращаются.",
          },
        ],
      },
      {
        id: "request",
        title: "Как запросить возврат",
        blocks: [
          {
            kind: "p",
            text: "В остальных случаях напишите на {email}, указав номер заказа, — он есть в вашем кабинете и в счёте. Каждый запрос рассматривается по условиям этого заказа: тарифу, периоду и условиям, которые вы приняли при оформлении.",
          },
        ],
      },
      {
        id: "contact",
        title: "Контакты",
        operator: true,
        blocks: [{ kind: "p", text: "Вопросы о заказе или оплате: напишите на {email}." }],
      },
    ],
  },
};
