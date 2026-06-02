export interface DeliveryInfoItem {
  text: string;
  visible: boolean;
}

export interface CheckoutSettings {
  pageTitle: string;
  successTitle: string;
  successDescription: string;
  successButtonText: string;
  emptyCartText: string;
  emptyCartButtonText: string;
  deliverySectionTitle: string;
  deliverySectionTitleWholesale: string;
  paymentSectionTitle: string;
  contactsSectionTitle: string;
  orderSummaryTitle: string;
  wholesaleBadgeText: string;
  wholesaleTransportTitle: string;
  wholesaleTransportDescription: string;
  wholesaleMinOrderText: string;
  cdekOptionTitle: string;
  cdekOptionDescription: string;
  citySearchPlaceholder: string;
  citySearchLabel: string;
  pvzLabel: string;
  selectedPointLabel: string;
  deliveryCostLabel: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  addressPlaceholder: string;
  addressWholesaleDescription: string;
  offerAgreementText: string;
  offerLinkText: string;
  offerLinkUrl: string;
  policyAgreementText: string;
  policyLinkText: string;
  policyLinkUrl: string;
  consentText: string;
  submitButtonText: string;
  deliveryInfoButtonText: string;
  deliveryInfoTitle: string;
  retailDeliveryInfoItems: DeliveryInfoItem[];
  wholesaleDeliveryInfoText: string;
  promoCodeLabel: string;
  promoCodePlaceholder: string;
  promoCodeApplyText: string;
  giftCardLabel: string;
  giftCardPlaceholder: string;
  giftCardApplyText: string;
  summarySubtotalLabel: string;
  summaryPromoLabel: string;
  summaryLoyaltyLabel: string;
  summaryGiftCardLabel: string;
  summaryDeliveryLabel: string;
  summaryDeliveryLabelWholesale: string;
  summaryDeliveryWholesaleValue: string;
  summaryTotalLabel: string;
  selectCityHint: string;
  selectPointHint: string;
  freeDeliveryText: string;
  showFreeDeliveryBanner: boolean;
  freeDeliveryThreshold: number;
  yandexDeliveryEnabled: boolean;
}

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  pageTitle: "Оформление заказа",
  successTitle: "Заказ подтвержден",
  successDescription: "Спасибо за ваш заказ! Мы отправили подтверждение на вашу почту.",
  successButtonText: "На главную",
  emptyCartText: "Загрузка корзины...",
  emptyCartButtonText: "Вернуться в корзину",
  deliverySectionTitle: "Способ доставки",
  deliverySectionTitleWholesale: "Адрес доставки",
  paymentSectionTitle: "Способ оплаты",
  contactsSectionTitle: "Контактные данные",
  orderSummaryTitle: "Ваш заказ",
  wholesaleBadgeText: "Оптовый заказ",
  wholesaleTransportTitle: "Транспортная компания",
  wholesaleTransportDescription: "Выберите предпочтительную транспортную компанию для отгрузки",
  wholesaleMinOrderText: "Минимальная сумма оптового заказа",
  cdekOptionTitle: "СДЭК",
  cdekOptionDescription: "Доставка в пункт выдачи или до двери",
  citySearchPlaceholder: "Начните вводить название города...",
  citySearchLabel: "Город доставки",
  pvzLabel: "Выберите пункт выдачи на карте",
  selectedPointLabel: "Выбранный пункт:",
  deliveryCostLabel: "Стоимость доставки",
  nameLabel: "Полное имя",
  namePlaceholder: "Иван Иванов",
  emailLabel: "Email",
  emailPlaceholder: "email@example.com",
  phoneLabel: "Телефон",
  phonePlaceholder: "+7 (999) 000-00-00",
  addressPlaceholder: "Город, улица, дом, офис/склад, индекс...",
  addressWholesaleDescription: "Укажите полный адрес для отгрузки через выбранную транспортную компанию",
  offerAgreementText: "Я ознакомлен с",
  offerLinkText: "Публичной офертой",
  offerLinkUrl: "https://booomerangs.ru/offer",
  policyAgreementText: "Я согласен с",
  policyLinkText: "Политикой персональных данных",
  policyLinkUrl: "https://booomerangs.ru/policy",
  consentText: "Оформляя заказ, вы подтверждаете своё согласие на обработку персональных данных, включая ФИО, контактный телефон, e-mail и адрес доставки, в целях выполнения заказа, доставки, обратной связи и маркетинговых уведомлений. Персональные данные обрабатываются в соответствии с",
  submitButtonText: "Заказать",
  deliveryInfoButtonText: "Информация о доставке",
  deliveryInfoTitle: "Информация о доставке",
  retailDeliveryInfoItems: [
    { text: "Доставка по всей России через СДЭК и Яндекс Доставку. Выберите удобный способ при оформлении заказа.", visible: true },
    { text: "Сроки и стоимость доставки рассчитываются автоматически в зависимости от вашего региона.", visible: true },
    { text: "При доставке одежды через СДЭК доступна функция примерки. Если вещь не подошла — можно отказаться прямо на месте.", visible: true },
    { text: "Носки возврату и обмену не подлежат в соответствии с Постановлением Правительства РФ № 55.", visible: true },
    { text: "При заказе от 5000 ₽ доставка бесплатная.", visible: true },
  ],
  wholesaleDeliveryInfoText: "Доставка товаров Покупателю осуществляется силами Транспортной компании (ТК). Поставщик осуществляет доставку до ТК за свой счет в течение 5 рабочих дней со дня оплаты Покупателем стоимости товаров в размере 100%.",
  promoCodeLabel: "Промокод",
  promoCodePlaceholder: "Введите код",
  promoCodeApplyText: "Применить",
  giftCardLabel: "Подарочный сертификат",
  giftCardPlaceholder: "BOOO-XXXX-XXXX-XXXX",
  giftCardApplyText: "Применить",
  summarySubtotalLabel: "Сумма",
  summaryPromoLabel: "Скидка по промокоду",
  summaryLoyaltyLabel: "Накопительная скидка",
  summaryGiftCardLabel: "Подарочный сертификат",
  summaryDeliveryLabel: "Доставка СДЭК",
  summaryDeliveryLabelWholesale: "Доставка",
  summaryDeliveryWholesaleValue: "по тарифам ТК",
  summaryTotalLabel: "Всего",
  selectCityHint: "Выберите город доставки",
  selectPointHint: "Выберите пункт выдачи для продолжения",
  freeDeliveryText: "При заказе от {threshold} доставка бесплатная",
  showFreeDeliveryBanner: true,
  freeDeliveryThreshold: 500000,
  yandexDeliveryEnabled: true,
};
