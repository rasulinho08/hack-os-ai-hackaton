/* Prices and discounts on the public pricing page and in checkout — Azerbaijani. */
import type { TranslationMap } from "../types";

const az: TranslationMap = {
  "price.was": "Əvvəl {price}",
  "price.save": "{n}% qənaət",
  "price.offer": "{name}: {value}",
  "price.offer_until": "{date} tarixinədək",
  "price.offer_first": "Yalnız ilk sifariş üçün",
  "price.edu_note": "Universitet və ya qeyri-kommersiya təşkilatısınız? Sifarişdə qısa yoxlamadan sonra {value}.",
  "price.off_sale": "Hazırda satışda deyil",
  "price.off_sale_body": "Bizə yazın, sizə uyğun planı birlikdə seçək.",
  "price.off_sale_cta": "Bizimlə əlaqə",

  "price.code.toggle": "Kodunuz var?",
  "price.code.label": "Endirim kodu",
  "price.code.placeholder": "məs. LAUNCH20",
  "price.code.apply": "Tətbiq et",
  "price.code.checking": "Yoxlanılır…",
  "price.code.remove": "Kodu sil",
  "price.code.applied": "{code} tətbiq edildi: {value}",
  "price.code.better_offer": "{code} keçərlidir, amma {offer} endirimi sizə artıq daha çox qazandırır. Endirimlər toplanmır.",
  "price.code.err.COUPON_NOT_FOUND": "Belə kod tapılmadı. Yazılışı yoxlayın.",
  "price.code.err.COUPON_PAUSED": "Bu kod hazırda aktiv deyil.",
  "price.code.err.COUPON_NOT_STARTED": "Bu kod hələ qüvvədə deyil.",
  "price.code.err.COUPON_EXPIRED": "Bu kodun müddəti bitib.",
  "price.code.err.COUPON_USED_UP": "Bu koddan icazə verilən sayda istifadə olunub.",
  "price.code.err.COUPON_CUSTOMER_LIMIT": "Təşkilatınız bu koddan artıq istifadə edib.",
  "price.code.err.COUPON_FIRST_PURCHASE": "Bu kod yalnız təşkilatın ilk sifarişi üçündür.",
  "price.code.err.COUPON_PLAN": "Bu kod {plan} planı üçün deyil.",
  "price.code.err.COUPON_PERIOD": "Bu kod bu ödəniş dövrü üçün deyil. Digərini yoxlayın.",
  "price.code.err.COUPON_NOT_YOURS": "Bu kod başqa təşkilata verilib. Daxil olun və kodun verildiyi təşkilatı seçin.",
  "price.code.err.RATE_LIMITED": "Çox sayda kod yoxlanıldı. Bir neçə dəqiqə gözləyib yenidən cəhd edin.",
  "price.code.err.generic": "Kodu indi yoxlamaq alınmadı. Yenidən cəhd edin.",

  "price.edu.label": "Biz universitet, məktəb və ya qeyri-kommersiya təşkilatıyıq",
  "price.edu.hint": "Bu plana {value} endirim. Sifarişi təsdiqləməzdən əvvəl yoxlayırıq; uyğun gəlməzsə, hesab-fakturadan əvvəl sizə bildiririk.",
  "price.edu.education": "Universitet və ya məktəb",
  "price.edu.nonprofit": "Qeyri-kommersiya təşkilatı",
  "price.edu.institution": "Müəssisə və ya təşkilat",
  "price.edu.institution_hint": "Qeydiyyatdakı adı, məs. ADA Universiteti",

  "price.summary.price": "Planın qiyməti",
  "price.summary.discount": "Endirim",
  "price.summary.subtotal": "Aralıq cəm",
  "price.summary.review": "Yoxlamamızdan sonra tətbiq olunur",
  "price.review.discount": "Endirim",
  "price.done.discount": "Endirim: {label}",
  "price.done.discount_review": "Endirim {label}, yoxlamamızdan sonra tətbiq olunur",
  "price.plan.off_sale": "Satışda deyil",
  "price.err.PLAN_NOT_ON_SALE": "Bu plan hazırda satışda deyil. Başqa plan seçin və ya bizə yazın.",
};

export default az;
