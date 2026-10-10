// Labels for the main UI in English, Telugu and Hindi. Missing keys fall back to English.
import { createContext, createElement, useCallback, useContext, useMemo, useState } from "react";

export const LANG_NAMES = { en: "English", te: "తెలుగు", hi: "हिन्दी" };

export const dict = {
  en: {
    order_online: "Order online", open_now: "Open for orders", paused: "Orders paused", home: "Home", search: "Search", orders: "Orders", account: "Account",
    delivery: "Delivery", "dine-in": "Dine-in", takeaway: "Takeaway", add: "ADD", sold_out: "Sold out", veg_only: "Veg only", all: "All",
    search_ph: "Search dishes", items: "items", item: "item", view_cart: "View cart", your_cart: "Your cart", checkout: "Checkout", place_order: "Place order",
    total: "Total", subtotal: "Items", discount: "Discount", delivery_fee: "Delivery fee", gst_incl: "incl. GST", coupon: "Coupon code", apply: "Apply",
    address: "Delivery address", landmark: "Landmark (optional)", use_location: "Use my location", saved: "Saved addresses", table: "Table", pick_table: "Pick your table",
    pay_on: "Pay on delivery / at counter", pay_on_hint: "Cash or UPI when your order arrives.", notes: "Notes for the restaurant", note: "Note",
    sign_in: "Sign in", phone: "Mobile number", send_code: "Send code", code: "6-digit code", verify: "Verify", resend_in: "Resend in", resend: "Resend code", your_name: "Your name",
    sign_out: "Sign out", delete_account: "Delete my account", language: "Language", name: "Name", save: "Save", remove: "Remove", cancel: "Cancel", confirm: "Confirm",
    no_orders: "No orders yet", no_orders_hint: "Your orders will show up here.", track: "Track order", reorder: "Order again", cancel_order: "Cancel order",
    delivery_code: "Delivery code", delivery_code_hint: "Tell this code to the delivery partner when you get your food.", call_driver: "Call", open_map: "Open map",
    powered_by: "Powered by", retry: "Retry", offline: "You seem to be offline.", not_found: "We could not find this restaurant", not_found_hint: "Check the link or code and try again.",
    how_it_works: "How it works", popular: "Popular dishes", step1: "Pick your dishes", step2: "Choose delivery, takeaway or dine-in", step3: "Pay when it arrives",
    hours: "Hours", call: "Call", directions: "Directions", min_order: "Minimum order", prep_time: "Preparation time", free_above: "Free delivery above", radius: "We deliver within",
    status_placed: "Order placed", status_preparing: "Being prepared", status_ready: "Ready", status_out_for_delivery: "On the way", status_served: "Served", status_delivered: "Delivered", status_completed: "Completed", status_cancelled: "Cancelled",
    empty_cart: "Your cart is empty", empty_cart_hint: "Add a few dishes to get started.", browse_menu: "Browse the menu", add_address: "Add address", privacy: "Privacy policy", terms: "Terms of use",
    search_empty: "No dishes match your search", min: "min", about: "About", mins_away: "Away", fee: "Fee", up_to: "up to", km: "km", close: "Close", add_to_cart: "Add to cart", update_cart: "Update",
    sign_in_to_order: "Sign in to place your order", order_placed: "Order placed", thanks: "Thank you! We have received your order.", items_label: "Items", paid_note: "To pay",
    continue: "Continue", contact: "Contact", enter_code_title: "Open a restaurant", enter_code_hint: "Type the restaurant code from its link or QR.", open: "Open", delivering_to: "Deliver to", type_label: "Order type",
    status_pending_payment: "Waiting for payment", pay_now: "Pay now", pay_amount: "Pay", pay_online: "Pay now (UPI, card, netbanking)", pay_how: "How do you want to pay?",
    pay_cod_delivery: "Pay on delivery / at the counter", paid_online: "Paid online", payment_not_done: "Payment not completed", payment_not_done_hint: "Your order is saved but the restaurant will not start it until it is paid.",
    try_again: "Try again", wait_pay: "Pay within", expired: "Expired", expired_hint: "This order was not paid in time and has been cancelled.", checking_payment: "We are checking your payment",
    checking_payment_hint: "If money was taken from your account, your order will turn to Placed in a moment. You do not need to pay again.", refund_text: "Refund of {amt} is on its way",
    wa_updates: "Send my order updates on WhatsApp", wa_note: "Messages come from Nova's WhatsApp number on the restaurant's behalf.", code_on_whatsapp: "We sent a code to your WhatsApp", code_via_whatsapp: "The code arrives on WhatsApp.", opening_payment: "Opening payment...", verifying_payment: "Confirming your payment...",
  },
  te: {
    order_online: "ఆన్‌లైన్‌లో ఆర్డర్ చేయండి", open_now: "ఆర్డర్లు తెరిచి ఉన్నాయి", paused: "ఆర్డర్లు నిలిపివేయబడ్డాయి", home: "హోమ్", search: "వెతుకు", orders: "ఆర్డర్లు", account: "ఖాతా",
    delivery: "డెలివరీ", "dine-in": "డైన్-ఇన్", takeaway: "టేక్‌అవే", add: "జోడించు", sold_out: "అయిపోయింది", veg_only: "శాకాహారం మాత్రమే", all: "అన్నీ",
    search_ph: "వంటకాలను వెతకండి", items: "వస్తువులు", item: "వస్తువు", view_cart: "కార్ట్ చూడండి", your_cart: "మీ కార్ట్", checkout: "చెక్‌అవుట్", place_order: "ఆర్డర్ చేయండి",
    total: "మొత్తం", subtotal: "వస్తువులు", discount: "తగ్గింపు", delivery_fee: "డెలివరీ ఛార్జ్", gst_incl: "GST సహా", coupon: "కూపన్ కోడ్", apply: "వర్తింపజేయి",
    address: "డెలివరీ చిరునామా", landmark: "ల్యాండ్‌మార్క్ (ఐచ్ఛికం)", use_location: "నా లొకేషన్ ఉపయోగించు", saved: "సేవ్ చేసిన చిరునామాలు", table: "టేబుల్", pick_table: "మీ టేబుల్ ఎంచుకోండి",
    pay_on: "డెలివరీ / కౌంటర్ వద్ద చెల్లింపు", pay_on_hint: "ఆర్డర్ వచ్చినప్పుడు నగదు లేదా UPI.", notes: "రెస్టారెంట్‌కు గమనికలు", note: "గమనిక",
    sign_in: "సైన్ ఇన్", phone: "మొబైల్ నంబర్", send_code: "కోడ్ పంపు", code: "6 అంకెల కోడ్", verify: "ధృవీకరించు", resend_in: "మళ్లీ పంపడానికి", resend: "కోడ్ మళ్లీ పంపు", your_name: "మీ పేరు",
    sign_out: "సైన్ అవుట్", delete_account: "నా ఖాతాను తొలగించు", language: "భాష", name: "పేరు", save: "సేవ్", remove: "తొలగించు", cancel: "రద్దు", confirm: "నిర్ధారించు",
    no_orders: "ఇంకా ఆర్డర్లు లేవు", no_orders_hint: "మీ ఆర్డర్లు ఇక్కడ కనిపిస్తాయి.", track: "ఆర్డర్ ట్రాక్ చేయండి", reorder: "మళ్లీ ఆర్డర్ చేయండి", cancel_order: "ఆర్డర్ రద్దు చేయండి",
    delivery_code: "డెలివరీ కోడ్", delivery_code_hint: "ఆహారం అందుకున్నప్పుడు ఈ కోడ్‌ను డెలివరీ వ్యక్తికి చెప్పండి.", call_driver: "కాల్", open_map: "మ్యాప్ తెరవండి",
    powered_by: "అందించినది", retry: "మళ్లీ ప్రయత్నించు", offline: "మీరు ఆఫ్‌లైన్‌లో ఉన్నట్లున్నారు.", not_found: "ఈ రెస్టారెంట్ దొరకలేదు", not_found_hint: "లింక్ లేదా కోడ్ సరిచూసుకోండి.",
    how_it_works: "ఎలా పనిచేస్తుంది", popular: "ప్రసిద్ధ వంటకాలు", step1: "వంటకాలు ఎంచుకోండి", step2: "డెలివరీ, టేక్‌అవే లేదా డైన్-ఇన్ ఎంచుకోండి", step3: "ఆహారం వచ్చాక చెల్లించండి",
    hours: "సమయాలు", call: "కాల్", directions: "దారి", min_order: "కనీస ఆర్డర్", prep_time: "తయారీ సమయం", free_above: "ఉచిత డెలివరీ", radius: "డెలివరీ పరిధి",
    status_placed: "ఆర్డర్ అయింది", status_preparing: "తయారవుతోంది", status_ready: "సిద్ధం", status_out_for_delivery: "దారిలో ఉంది", status_served: "వడ్డించారు", status_delivered: "అందింది", status_completed: "పూర్తయింది", status_cancelled: "రద్దయింది",
    empty_cart: "మీ కార్ట్ ఖాళీగా ఉంది", empty_cart_hint: "కొన్ని వంటకాలు జోడించండి.", browse_menu: "మెనూ చూడండి", add_address: "చిరునామా జోడించు", privacy: "గోప్యతా విధానం", terms: "ఉపయోగ నిబంధనలు",
    search_empty: "మీ శోధనకు వంటకాలు లేవు", min: "నిమి", about: "గురించి", close: "మూసివేయి", add_to_cart: "కార్ట్‌లో జోడించు", update_cart: "అప్‌డేట్",
    sign_in_to_order: "ఆర్డర్ చేయడానికి సైన్ ఇన్ చేయండి", order_placed: "ఆర్డర్ అయింది", thanks: "ధన్యవాదాలు! మీ ఆర్డర్ అందింది.", continue: "కొనసాగించు", contact: "సంప్రదించండి",
    status_pending_payment: "చెల్లింపు కోసం వేచి ఉంది", pay_now: "ఇప్పుడే చెల్లించండి", pay_amount: "చెల్లించండి", pay_online: "ఇప్పుడే చెల్లించండి (UPI, కార్డ్, నెట్‌బ్యాంకింగ్)", pay_how: "ఎలా చెల్లించాలనుకుంటున్నారు?",
    pay_cod_delivery: "డెలివరీ / కౌంటర్ వద్ద చెల్లింపు", paid_online: "ఆన్‌లైన్‌లో చెల్లించారు", payment_not_done: "చెల్లింపు పూర్తి కాలేదు", payment_not_done_hint: "మీ ఆర్డర్ సేవ్ అయింది, కానీ చెల్లించే వరకు రెస్టారెంట్ తయారీ మొదలుపెట్టదు.",
    try_again: "మళ్లీ ప్రయత్నించండి", wait_pay: "చెల్లించాల్సిన సమయం", expired: "గడువు ముగిసింది", expired_hint: "సమయానికి చెల్లించకపోవడంతో ఈ ఆర్డర్ రద్దయింది.", checking_payment: "మేము మీ చెల్లింపును పరిశీలిస్తున్నాము",
    checking_payment_hint: "మీ ఖాతా నుండి డబ్బు తీసుకుంటే, ఆర్డర్ కొద్దిసేపట్లో \"ఆర్డర్ అయింది\" అవుతుంది. మళ్లీ చెల్లించాల్సిన అవసరం లేదు.", refund_text: "{amt} రీఫండ్ మీకు తిరిగి వస్తోంది",
    wa_updates: "నా ఆర్డర్ అప్‌డేట్‌లను WhatsApp లో పంపండి", wa_note: "రెస్టారెంట్ తరపున Nova యొక్క WhatsApp నంబర్ నుండి సందేశాలు వస్తాయి.", code_on_whatsapp: "మేము మీ WhatsApp కు కోడ్ పంపాము", code_via_whatsapp: "కోడ్ WhatsApp లో వస్తుంది.", opening_payment: "చెల్లింపు తెరుస్తోంది...", verifying_payment: "మీ చెల్లింపును నిర్ధారిస్తోంది...",
  },
  hi: {
    order_online: "ऑनलाइन ऑर्डर करें", open_now: "ऑर्डर खुले हैं", paused: "ऑर्डर अभी बंद हैं", home: "होम", search: "खोजें", orders: "ऑर्डर", account: "खाता",
    delivery: "डिलीवरी", "dine-in": "डाइन-इन", takeaway: "टेकअवे", add: "जोड़ें", sold_out: "खत्म", veg_only: "सिर्फ शाकाहारी", all: "सभी",
    search_ph: "व्यंजन खोजें", items: "आइटम", item: "आइटम", view_cart: "कार्ट देखें", your_cart: "आपका कार्ट", checkout: "चेकआउट", place_order: "ऑर्डर करें",
    total: "कुल", subtotal: "आइटम", discount: "छूट", delivery_fee: "डिलीवरी शुल्क", gst_incl: "GST सहित", coupon: "कूपन कोड", apply: "लगाएँ",
    address: "डिलीवरी का पता", landmark: "लैंडमार्क (वैकल्पिक)", use_location: "मेरी लोकेशन इस्तेमाल करें", saved: "सहेजे गए पते", table: "टेबल", pick_table: "अपनी टेबल चुनें",
    pay_on: "डिलीवरी / काउंटर पर भुगतान", pay_on_hint: "ऑर्डर आने पर नकद या UPI।", notes: "रेस्टोरेंट के लिए नोट", note: "नोट",
    sign_in: "साइन इन", phone: "मोबाइल नंबर", send_code: "कोड भेजें", code: "6 अंकों का कोड", verify: "सत्यापित करें", resend_in: "दोबारा भेजें", resend: "कोड दोबारा भेजें", your_name: "आपका नाम",
    sign_out: "साइन आउट", delete_account: "मेरा खाता हटाएँ", language: "भाषा", name: "नाम", save: "सहेजें", remove: "हटाएँ", cancel: "रद्द करें", confirm: "पुष्टि करें",
    no_orders: "अभी कोई ऑर्डर नहीं", no_orders_hint: "आपके ऑर्डर यहाँ दिखेंगे।", track: "ऑर्डर ट्रैक करें", reorder: "दोबारा ऑर्डर करें", cancel_order: "ऑर्डर रद्द करें",
    delivery_code: "डिलीवरी कोड", delivery_code_hint: "खाना मिलने पर यह कोड डिलीवरी पार्टनर को बताएँ।", call_driver: "कॉल", open_map: "नक्शा खोलें",
    powered_by: "संचालित", retry: "फिर कोशिश करें", offline: "आप ऑफलाइन लगते हैं।", not_found: "यह रेस्टोरेंट नहीं मिला", not_found_hint: "लिंक या कोड जाँचकर फिर कोशिश करें।",
    how_it_works: "कैसे काम करता है", popular: "लोकप्रिय व्यंजन", step1: "अपने व्यंजन चुनें", step2: "डिलीवरी, टेकअवे या डाइन-इन चुनें", step3: "खाना आने पर भुगतान करें",
    hours: "समय", call: "कॉल", directions: "रास्ता", min_order: "न्यूनतम ऑर्डर", prep_time: "तैयारी का समय", free_above: "मुफ़्त डिलीवरी", radius: "डिलीवरी दायरा",
    status_placed: "ऑर्डर मिला", status_preparing: "तैयार हो रहा है", status_ready: "तैयार", status_out_for_delivery: "रास्ते में", status_served: "परोसा गया", status_delivered: "पहुँच गया", status_completed: "पूरा हुआ", status_cancelled: "रद्द",
    empty_cart: "आपका कार्ट खाली है", empty_cart_hint: "कुछ व्यंजन जोड़ें।", browse_menu: "मेन्यू देखें", add_address: "पता जोड़ें", privacy: "गोपनीयता नीति", terms: "उपयोग की शर्तें",
    search_empty: "आपकी खोज से कोई व्यंजन नहीं मिला", min: "मिनट", about: "जानकारी", close: "बंद करें", add_to_cart: "कार्ट में जोड़ें", update_cart: "अपडेट",
    sign_in_to_order: "ऑर्डर करने के लिए साइन इन करें", order_placed: "ऑर्डर हो गया", thanks: "धन्यवाद! आपका ऑर्डर मिल गया।", continue: "आगे बढ़ें", contact: "संपर्क",
    status_pending_payment: "भुगतान का इंतज़ार", pay_now: "अभी भुगतान करें", pay_amount: "भुगतान करें", pay_online: "अभी भुगतान करें (UPI, कार्ड, नेटबैंकिंग)", pay_how: "आप कैसे भुगतान करना चाहेंगे?",
    pay_cod_delivery: "डिलीवरी / काउंटर पर भुगतान", paid_online: "ऑनलाइन भुगतान हो गया", payment_not_done: "भुगतान पूरा नहीं हुआ", payment_not_done_hint: "आपका ऑर्डर सहेजा गया है, पर भुगतान होने तक रेस्टोरेंट इसे शुरू नहीं करेगा।",
    try_again: "फिर कोशिश करें", wait_pay: "भुगतान की समय सीमा", expired: "समय समाप्त", expired_hint: "समय पर भुगतान न होने से यह ऑर्डर रद्द हो गया है।", checking_payment: "हम आपका भुगतान जाँच रहे हैं",
    checking_payment_hint: "अगर आपके खाते से पैसे कटे हैं, तो ऑर्डर थोड़ी देर में \"ऑर्डर मिला\" हो जाएगा। दोबारा भुगतान न करें।", refund_text: "{amt} का रिफंड आपके पास आ रहा है",
    wa_updates: "मेरे ऑर्डर अपडेट WhatsApp पर भेजें", wa_note: "संदेश रेस्टोरेंट की ओर से Nova के WhatsApp नंबर से आते हैं।", code_on_whatsapp: "हमने आपके WhatsApp पर कोड भेजा है", code_via_whatsapp: "कोड WhatsApp पर आएगा।", opening_payment: "भुगतान खुल रहा है...", verifying_payment: "आपका भुगतान पक्का हो रहा है...",
  },
};

const Ctx = createContext({ t: (k) => k, lang: "en", setLang: () => {} });
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children, languages = ["en"] }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem("nova.customer.lang") || "en"; } catch { return "en"; }
  });
  const active = languages.includes(lang) ? lang : "en";
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem("nova.customer.lang", l); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => ({
    lang: active, setLang, languages,
    t: (k) => dict[active]?.[k] ?? dict.en[k] ?? k,
  }), [active, setLang, languages]);
  return createElement(Ctx.Provider, { value }, children);
}
