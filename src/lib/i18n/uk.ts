import type { Messages } from "./en"

/** Ukrainian chrome dictionary — same keys as `en`. */
export const uk: Messages = {
  // Brand / header chrome
  "nav.home": "Spindle — на головну",
  "nav.openMenu": "Відкрити меню",
  "nav.closeMenu": "Закрити меню",

  // Top-level nav groups and standalone links
  "nav.product": "Продукт",
  "nav.solutions": "Рішення",
  "nav.pricing": "Тарифи",
  "nav.resources": "Ресурси",
  "nav.company": "Компанія",
  "nav.docs": "Документація",
  "nav.blog": "Блог",
  "nav.changelog": "Журнал змін",
  "nav.searchSite": "Пошук по сайту",

  // Nav card titles — `nav.link.<id>`; descriptions — `nav.link.<id>.desc`.
  "nav.link.workspaceOverview": "Огляд робочого простору",
  "nav.link.workspaceOverview.desc": "Кожен проєкт отримує власний дім",
  "nav.link.files": "Файли",
  "nav.link.files.desc": "5 ГБ безкоштовно, 100+ формати для перегляду",
  "nav.link.lab": "Лабораторія",
  "nav.link.lab.desc": "Нотатки, R, SQL, канвас, графіки та математика",
  "nav.link.labPreview": "Попередній перегляд блокнота Лабораторії",
  "nav.link.labPreview.desc": "Розділ Лабораторії на головній сторінці",
  "nav.link.localSearch": "Локальний пошук",
  "nav.link.localSearch.desc": "Академічний і базовий режими, self-hosted",
  "nav.link.automations": "Автоматизації",
  "nav.link.automations.desc": "Надішліть SMS, створіть або напишіть cron",
  "nav.link.agent": "Агент",
  "nav.link.agent.desc": "Редагує файли, переміщує їх, працює автономно",
  "nav.link.teamChat": "Командний чат",
  "nav.link.teamChat.desc": "Канали проєктів, опційна анонімність",
  "nav.link.collaboration": "Співпраця",
  "nav.link.collaboration.desc": "Курсори в реальному часі, ролі та спільне редагування",
  "nav.link.infrastructure": "Інфраструктура",
  "nav.link.infrastructure.desc": "Приватність за задумом — від TLS до сховища",
  "nav.link.allFeatures": "Усі можливості",
  "nav.link.allFeatures.desc": "Вся платформа на одній сторінці",
  "nav.link.researchers": "Окремі дослідники",
  "nav.link.researchers.desc": "Спокійне місце для одного проєкту",
  "nav.link.labs": "Дослідницькі лабораторії",
  "nav.link.labs.desc": "Спільні ядра, нотатки та результати",
  "nav.link.teams": "Дослідницькі команди",
  "nav.link.teams.desc": "Канали, ролі та присутність у реальному часі",
  "nav.link.institutions": "Установи",
  "nav.link.institutions.desc": "Централізована оплата та просте підключення",
  "nav.link.documentation": "Документація",
  "nav.link.documentation.desc": "Налаштуйте робочий простір і вивчіть інструменти",
  "nav.link.quickstart": "Швидкий старт",
  "nav.link.quickstart.desc": "Ваш перший проєкт за кілька хвилин",
  "nav.link.guides": "Посібники",
  "nav.link.guides.desc": "Рецепти для пошуку, автоматизацій і Лабораторії",
  "nav.link.changelog": "Журнал змін",
  "nav.link.changelog.desc": "Що вийшло та що змінилося",
  "nav.link.faq": "FAQ",
  "nav.link.faq.desc": "Практичні запитання з відповідями",
  "nav.link.about": "Про нас",
  "nav.link.about.desc": "Що таке Spindle і чому ми його створили",
  "nav.link.contact": "Контакти",
  "nav.link.contact.desc": "Поговоріть з нами про вашу лабораторію",

  // Footer
  "footer.tagline": "Єдине місце для всіх ваших досліджень",
  "footer.workspace": "Робочий простір",
  "footer.lab": "Лабораторія",
  "footer.search": "Пошук",
  "footer.platformOverview": "Огляд платформи",
  "footer.integrations": "Інтеграції",
  "footer.getStarted": "Розпочати",
  "footer.referFriend": "Запросити друга",
  "footer.terms": "Умови надання послуг",
  "footer.privacy": "Конфіденційність",
  "footer.cookiePolicy": "Політика cookie",
  "footer.acceptableUse": "Допустиме використання",
  "footer.dpa": "DPA та субобробники",
  "footer.security": "Безпека",
  "footer.accessibility": "Доступність",
  "footer.github": "GitHub",
  "footer.copyright": "© {year} Spindle Labs. Створено для допитливих.",

  // Auth
  "auth.signIn": "Увійти",
  "auth.signUp": "Зареєструватися",
  "auth.signOut": "Вийти",
  "auth.startFree": "Почати безкоштовно",
  "auth.forgotPassword": "Забули пароль?",
  "auth.welcomeBack": "З поверненням, {name}",
  "auth.createWorkspace": "Створити робочий простір",
  "auth.createFreeWorkspace": "Створити безкоштовний простір",
  "auth.creatingWorkspace": "Створення простору…",
  "auth.resetPassword": "Скинути пароль",
  "auth.sendResetLink": "Надіслати посилання для скидання",
  "auth.keepSignedIn": "Залишити мене в системі",
  "auth.backToSignIn": "Назад до входу",
  "auth.signingIn": "Вхід…",
  "auth.sendingLink": "Надсилання посилання…",
  "auth.verify": "Підтвердити",
  "auth.verifying": "Перевірка…",
  "auth.twoFactor": "Двофакторна автентифікація",
  "auth.twoFactorHint":
    "Цей обліковий запис використовує двофакторну автентифікацію. Введіть 6-значний код із застосунку автентифікації або резервний код.",
  "auth.authCode": "Код автентифікації",
  "auth.workEmail": "Робоча електронна пошта",
  "auth.password": "Пароль",
  "auth.confirmPassword": "Підтвердіть пароль",
  "auth.workspaceName": "Назва робочого простору",
  "auth.workspaceNameHint": "Малі літери, цифри та одинарні дефіси.",
  "auth.agreeTo": "Я погоджуюся з",
  "auth.termsOfService": "Умовами надання послуг",
  "auth.and": "та",
  "auth.privacyPolicy": "Політикою конфіденційності",
  "auth.freeTierNote": "5 ГБ безкоштовно. Без кредитної картки.",
  "auth.orContinueWithEmail": "або продовжте з електронною поштою",
  "auth.emailSignInLink": "Надіслати мені посилання для входу",
  "auth.signInLinkSent": "Посилання надіслано — перевірте пошту",
  "auth.securityKeySignIn": "Увійти за допомогою парольного ключа або ключа безпеки",
  "auth.securityKeyWorking": "Очікування парольного ключа або ключа безпеки…",
  "auth.securityKeyHint":
    "Працює з парольними ключами та ключами безпеки. Нерезидентні ключі безпеки тут не пропонуються — спочатку увійдіть за паролем або парольним ключем.",
  "auth.passwordRequirements": "Вимоги до пароля",
  "auth.rule.length": "Щонайменше {min} символів",
  "auth.rule.letter": "Містить літеру",
  "auth.rule.number": "Містить цифру",
  "auth.passwordStrength": "Стійкість пароля",
  "auth.passwordStrengthValue": "Стійкість пароля: {label}",
  "auth.strength.weak": "Слабкий",
  "auth.strength.fair": "Задовільний",
  "auth.strength.good": "Гарний",
  "auth.strength.strong": "Сильний",

  // Session menu
  "auth.accountMenu": "Меню облікового запису",
  "auth.openApp": "Відкрити застосунок",
  "auth.accountSettings": "Налаштування облікового запису",
  "auth.verifyEmail": "Підтвердіть електронну пошту",
  "auth.sendingVerification": "Надсилання листа для підтвердження…",

  // Password reset (token page)
  "auth.recoveryEyebrow": "Відновлення облікового запису",
  "auth.chooseNewPassword": "Оберіть новий пароль",
  "auth.chooseNewPasswordDesc":
    "Придумайте надійний пароль для облікового запису Spindle, потім увійдіть із ним.",
  "auth.newPassword": "Новий пароль",
  "auth.confirmNewPassword": "Підтвердіть новий пароль",
  "auth.passwordMinHint": "Щонайменше {min} символів.",
  "auth.updatePassword": "Оновити пароль",
  "auth.updatingPassword": "Оновлення пароля…",
  "auth.passwordUpdated": "Пароль оновлено",
  "auth.passwordUpdatedDesc":
    "Ваш пароль змінено. Увійдіть із новим паролем, щоб повернутися до робочого простору.",
  "auth.requestNewLink": "Запросити нове посилання",
  "auth.contactSupport": "Зв'язатися з підтримкою",
  "auth.link.expired.label": "Термін дії посилання минув",
  "auth.link.expired.title": "Термін дії цього посилання минув",
  "auth.link.expired.description":
    "Посилання для скидання пароля швидко згорають задля безпеки облікових записів. Запросіть нове посилання — ми надішлемо його вам.",
  "auth.link.used.label": "Посилання вже використано",
  "auth.link.used.title": "Це посилання вже використано",
  "auth.link.used.description":
    "Якщо ви вже змінили пароль, увійдіть із новим. Інакше запросіть інше посилання.",
  "auth.link.invalid.label": "Недійсне посилання",
  "auth.link.invalid.title": "Це посилання недійсне",
  "auth.link.invalid.description":
    "Посилання неповне або могло бути скопійоване з помилкою. Запросіть нове посилання, щоб продовжити.",

  // Auth page shells (sign-in / sign-up split and centered shells)
  "auth.shell.signIn.eyebrow": "Доступ до облікового запису",
  "auth.shell.signIn.title": "З поверненням",
  "auth.shell.signIn.description":
    "Увійдіть, щоб продовжити роботу з простором, файлами та проєктами.",
  "auth.shell.signIn.switchPrompt": "Вперше в Spindle?",
  "auth.shell.signIn.switchLabel": "Створити обліковий запис",
  "auth.shell.signUp.eyebrow": "Початок роботи",
  "auth.shell.signUp.title": "Створіть робочий простір",
  "auth.shell.signUp.description":
    "Почніть із 5 ГБ сховища, спільних проєктів і спокійного дослідницького дому.",
  "auth.shell.signUp.switchPrompt": "Вже маєте обліковий запис?",
  "auth.shell.signUp.switchLabel": "Увійти натомість",
  "auth.shell.terms": "Умови",

  // Validation messages — keys returned by site/auth/validation.ts.
  "auth.validation.emailRequired": "Вкажіть робочу електронну пошту.",
  "auth.validation.emailInvalid": "Введіть дійсну адресу, наприклад you@lab.edu.",
  "auth.validation.passwordRequired": "Введіть пароль.",
  "auth.validation.passwordCreateRequired": "Створіть пароль.",
  "auth.validation.passwordTooShort": "Використайте щонайменше {min} символів.",
  "auth.validation.passwordLetterNumber": "Додайте літеру та цифру.",
  "auth.validation.confirmRequired": "Підтвердіть пароль.",
  "auth.validation.passwordsDontMatch": "Паролі не збігаються.",
  "auth.validation.workspaceNameRequired": "Назвіть робочий простір.",
  "auth.validation.workspaceNameLength": "Використайте {wmin}–{wmax} символів.",
  "auth.validation.workspaceNameFormat": "Малі літери, цифри та одинарні дефіси.",
  "auth.validation.workspaceNameReserved": "Ця назва простору зайнята. Спробуйте іншу.",
  "auth.validation.termsRequired":
    "Щоб продовжити, прийміть Умови надання послуг і Політику конфіденційності.",

  // Form-level error messages (client-side literals only).
  "auth.error.invalidCredentials":
    "Невірна електронна пошта або пароль. Перевірте дані та спробуйте ще раз.",
  "auth.error.connection": "Щось пішло не так. Перевірте з'єднання та спробуйте ще раз.",
  "auth.error.emailForLink":
    "Введіть дійсну адресу електронної пошти, щоб отримати посилання для входу.",
  "auth.error.emailTaken":
    "Обліковий запис із цією поштою вже існує. Спробуйте увійти або вкажіть іншу адресу.",
  "auth.error.finishSignIn":
    "Не вдалося зв'язатися із сервером, щоб завершити вхід. Перевірте з'єднання та спробуйте ще раз.",
  "auth.error.accountLocked": "Забагато невдалих спроб входу. Спробуйте ще раз за {time}.",

  // Proof-of-work captcha widget (auto-solving; no user interaction needed)
  "auth.captcha.verifying": "Перевірка браузера…",
  "auth.captcha.passed": "Перевірку безпеки пройдено.",
  "auth.captcha.failed": "Перевірка безпеки недоступна.",
  "auth.captcha.retry": "Повторити",

  // Site command menu (⌘K palette)
  "search.title": "Пошук у Spindle",
  "search.placeholder": "Пошук сторінок, документації, журналу змін…",
  "search.noResults": "Немає результатів для «{query}».",
  "search.group.pages": "Сторінки",
  "search.action": "Дія",
  "search.group.actions": "Дії",
  "search.group.recent": "Нещодавні",

  // Common actions
  "common.save": "Зберегти",
  "common.cancel": "Скасувати",
  "common.close": "Закрити",
  "common.loading": "Завантаження…",
  "common.retry": "Повторити",
  "common.search": "Пошук",
  "common.language": "Мова",
  "common.navigate": "Навігація",
  "common.select": "Вибрати",
  "common.error": "Щось пішло не так. Спробуйте ще раз.",

  // Toasts
  "toast.verificationSent": "Лист підтвердження надіслано",
  "toast.verificationSentHint": "Перевірте {email} — там посилання для підтвердження адреси.",
  "toast.verificationFailed": "Не вдалося надіслати лист підтвердження",
  "toast.tryAgain": "Спробуйте ще раз.",

  // Auth recovery screens — shared email-link form, password-reset request,
  // verify-email, magic-link, and OAuth callback states.
  "auth.backToSpindle": "Назад до Spindle",
  "auth.checkInbox": "Перевірте пошту",
  "auth.signedInTitle": "Ви увійшли",
  "auth.linkIncompleteTitle": "Це посилання неповне",
  "auth.error.generic": "Щось пішло не так. Спробуйте ще раз.",
  "auth.emailLink.resend": "Надіслати ще раз",
  "auth.emailLink.resendIn": "Повторно через {seconds} с",
  "auth.emailLink.resendSent": "Нове посилання вже в дорозі на {email}.",
  "auth.emailLink.differentEmail": "Використати іншу адресу",
  "auth.emailLink.sending": "Надсилання…",
  "auth.resetRequest.title": "Скинути пароль",
  "auth.resetRequest.description":
    "Введіть робочу адресу електронної пошти вашого акаунта Spindle. Якщо вона збігається, ми надішлемо посилання для вибору нового пароля.",
  "auth.resetRequest.sentMessage":
    "Ми надіслали посилання для скидання на {email}. Воно дійсне 30 хвилин.",
  "auth.verify.verifyingTitle": "Підтвердження електронної пошти",
  "auth.verify.verifyingDescription":
    "Зачекайте, поки ми підтвердимо це посилання. Це займе лише мить.",
  "auth.verify.verifiedTitle": "Пошту підтверджено",
  "auth.verify.verifiedDescription":
    "Ваша адреса підтверджена. Можете закрити цю вкладку та повернутися до робочого простору.",
  "auth.verify.continueToSpindle": "Продовжити до Spindle",
  "auth.verify.eyebrow": "Безпека акаунта",
  "auth.verify.description":
    "Введіть робочу адресу електронної пошти, і ми надішлемо нове посилання для підтвердження.",
  "auth.verify.sentEyebrow": "Посилання надіслано",
  "auth.verify.sentDescription":
    "Відкрийте щойно надіслане посилання, щоб завершити підтвердження адреси.",
  "auth.verify.expiredTitle": "Термін дії цього посилання для підтвердження минув",
  "auth.verify.expiredDescription":
    "Посилання для підтвердження швидко згорають, щоб захистити акаунти. Надішліть собі нове нижче.",
  "auth.verify.usedTitle": "Це посилання для підтвердження вже використано",
  "auth.verify.usedDescription":
    "Якщо вашу пошту вже підтверджено, увійдіть з головної сторінки. Інакше надішліть собі нове посилання.",
  "auth.verify.invalidTitle": "Це посилання для підтвердження недійсне",
  "auth.verify.invalidDescription":
    "Посилання неповне або могло бути скопійоване з помилкою. Надішліть новий лист для підтвердження, щоб продовжити.",
  "auth.verify.sendEmail": "Надіслати лист для підтвердження",
  "auth.verify.sentMessage": "Нове посилання для підтвердження вже в дорозі на {email}.",
  "auth.magicLink.verifyingTitle": "Вхід у акаунт",
  "auth.magicLink.verifyingDescription": "Зачекайте, поки ми підтвердимо ваше посилання.",
  "auth.magicLink.signedInDescription": "Повертаємо вас до Spindle…",
  "auth.magicLink.missingDescription":
    "У посиланні для входу відсутній токен. Запросіть нове зі спливаючого вікна входу.",
  "auth.magicLink.invalidTitle": "Це посилання не спрацювало",
  "auth.magicLink.invalidDescription":
    "Посилання недійсне або термін його дії минув. Запросіть нове.",
  "auth.magicLink.expiresHint": "Термін дії посилання — {expiry}.",
  "auth.magicLink.expiredTitle": "Термін дії цього посилання для входу минув",
  "auth.magicLink.expiredDescription":
    "З міркувань безпеки посилання для входу діють лише {expiry}. Запросіть нове нижче.",
  "auth.magicLink.usedTitle": "Це посилання для входу вже використано",
  "auth.magicLink.usedDescription":
    "Посилання для входу працюють один раз. Якщо ви щойно увійшли, можете закрити вкладку; інакше запросіть нове посилання нижче.",
  "auth.magicLink.resendLabel": "Надіслати нове посилання",
  "auth.magicLink.resendSent": "Нове посилання для входу вже в дорозі на {email}.",
  "auth.magicLink.continueNow": "Продовжити зараз",
  "auth.oauth.providersLabel": "Провайдери єдиного входу",
  "auth.oauth.continueWith": "Продовжити через {provider}",
  "auth.oauth.notConfigured": "Вхід через {provider} ще не налаштовано",
  "auth.oauth.soon": "Скоро",
  "auth.oauth.providerDenied": "Провайдер скасував або відхилив вхід.",
  "auth.oauth.verifyingTitle": "Завершення входу",
  "auth.oauth.verifyingDescription": "Зачекайте, поки ми підтвердимо з провайдером.",
  "auth.oauth.signedInDescription": "Перенаправляємо вас до робочого простору…",
  "auth.oauth.missingDescription":
    "У зворотному виклику відсутні параметри. Розпочніть вхід ще раз.",
  "auth.oauth.invalidTitle": "Вхід не завершено",
  "auth.oauth.invalidDescription":
    "Посилання для входу недійсне або термін його дії минув. Спробуйте ще раз.",

  // Onboarding wizard (/app/onboarding)
  "onboarding.eyebrow": "Ласкаво просимо до Spindle",
  "onboarding.title": "Налаштуйте робочий простір",
  "onboarding.progressLabel": "Прогрес налаштування",
  "onboarding.stepStatus": "Крок {current} з {total}",
  "onboarding.steps.welcome": "Вітання",
  "onboarding.steps.profile": "Профіль",
  "onboarding.steps.preferences": "Налаштування",
  "onboarding.steps.tour": "Огляд",
  "onboarding.back": "Назад",
  "onboarding.next": "Далі",
  "onboarding.getStarted": "Почати",
  "onboarding.skip": "Пропустити налаштування",
  "onboarding.later": "Зроблю це пізніше",
  "onboarding.finish": "Завершити налаштування",
  "onboarding.finishing": "Завершення…",
  "onboarding.loading": "Завантаження налаштування…",
  "onboarding.welcome.title": "Ласкаво просимо до Spindle",
  "onboarding.welcome.description":
    "Spindle — ваш робочий простір для проєктів, файлів, блокнотів і автоматизацій. Цей короткий огляд займе кілька хвилин — його можна пропустити будь-коли.",
  "onboarding.profile.title": "Як до вас звертатися?",
  "onboarding.profile.description": "Це ім'я бачитимуть ваші колеги в усьому робочому просторі.",
  "onboarding.profile.displayName": "Відображуване ім'я",
  "onboarding.profile.displayNameHint":
    "Необов'язково — показується колегам. Пізніше його можна змінити в налаштуваннях профілю.",
  "onboarding.preferences.title": "Як ви використовуватимете Spindle?",
  "onboarding.preferences.description":
    "Оберіть найближче — пізніше це можна змінити в налаштуваннях робочого простору.",
  "onboarding.preferences.roleLabel": "Я працюю як…",
  "onboarding.role.individual": "Окремий дослідник",
  "onboarding.role.lab": "Дослідницька лабораторія",
  "onboarding.role.team": "Команда",
  "onboarding.role.institution": "Установа",
  "onboarding.tour.title": "Усе готово",
  "onboarding.tour.description":
    "Ось короткий огляд, де що знаходиться. До будь-якого розділу можна повернутися з бічної панелі.",
  "onboarding.tour.projects.title": "Проєкти та файли",
  "onboarding.tour.projects.description":
    "Кожен проєкт має свій дім — блокноти, набори даних і документи разом.",
  "onboarding.tour.lab.title": "Лабораторія",
  "onboarding.tour.lab.description":
    "Блокноти з R, SQL, полотном і графіками — усе в одному місці.",
  "onboarding.tour.automations.title": "Автоматизації та агент",
  "onboarding.tour.automations.description":
    "Плануйте повторювані завдання або дозвольте агенту виконувати роботу за вас.",

  // Account recovery wizard (/account-recovery)
  "auth.accountRecovery.request.title": "Відновіть доступ до облікового запису",
  "auth.accountRecovery.request.description":
    "Введіть email вашого облікового запису Spindle. Якщо він збігається, ми надішлемо безпечне посилання для відновлення.",
  "auth.accountRecovery.request.submit": "Надіслати посилання для відновлення",
  "auth.accountRecovery.request.sentTitle": "Перевірте пошту",
  "auth.accountRecovery.request.sentMessage":
    "Ми надіслали посилання для відновлення на {email}. Воно діє 30 хвилин і працює один раз.",
  "auth.accountRecovery.verifyingTitle": "Перевірка посилання для відновлення",
  "auth.accountRecovery.verifyingDescription":
    "Зачекайте, поки ми підтвердимо це посилання. Це займе лише мить.",
  "auth.accountRecovery.link.expired.label": "Термін дії минув",
  "auth.accountRecovery.link.expired.title": "Термін дії цього посилання минув",
  "auth.accountRecovery.link.expired.description":
    "Посилання для відновлення швидко згорають задля безпеки. Замовте нове нижче.",
  "auth.accountRecovery.link.used.label": "Посилання вже використано",
  "auth.accountRecovery.link.used.title": "Це посилання для відновлення вже використано",
  "auth.accountRecovery.link.used.description":
    "Посилання працює один раз. Якщо ви вже завершили відновлення, увійдіть з новим паролем; інакше замовте інше посилання.",
  "auth.accountRecovery.link.invalid.label": "Недійсне посилання",
  "auth.accountRecovery.link.invalid.title": "Це посилання для відновлення недійсне",
  "auth.accountRecovery.link.invalid.description":
    "Посилання неповне або могло бути скопійоване з помилкою. Замовте нове посилання, щоб продовжити.",
  "auth.accountRecovery.steps.title": "Захистіть свій обліковий запис",
  "auth.accountRecovery.steps.description":
    "Вашу пошту підтверджено. Виконайте ці кроки для {email}, щоб завершити відновлення.",
  "auth.accountRecovery.step.password.title": "Встановіть новий пароль",
  "auth.accountRecovery.step.password.description":
    "Оберіть надійний пароль — ви використовуватимете його для входу надалі.",
  "auth.accountRecovery.step.email.title": "Підтвердьте email",
  "auth.accountRecovery.step.email.description":
    "Позначте адресу як підтверджену — відкриття посилання вже довело, що ви контролюєте її.",
  "auth.accountRecovery.step.security.title": "Перегляньте активність безпеки",
  "auth.accountRecovery.step.security.description":
    "Перевірте останні входи та події облікового запису. Якщо щось виглядає незнайомим, завершіть відновлення й одразу змініть пароль.",
  "auth.accountRecovery.step.finish.title": "Завершіть відновлення",
  "auth.accountRecovery.step.finish.description":
    "Завершення відновлення виходить з усіх активних сесій, включно з цією.",
  "auth.accountRecovery.confirmEmail": "Позначити email як підтверджений",
  "auth.accountRecovery.emailVerified": "Email підтверджено",
  "auth.accountRecovery.securityEventsTitle": "Остання активність безпеки",
  "auth.accountRecovery.securityEventsEmpty":
    "Немає останньої активності облікового запису для перегляду.",
  "auth.accountRecovery.finish": "Завершити відновлення",
  "auth.accountRecovery.finishing": "Завершення…",
  "auth.accountRecovery.sessionHint":
    "Ця сесія відновлення діє приблизно {minutes} хв. Завершіть до того часу або почніть спочатку.",
  "auth.accountRecovery.done.title": "Обліковий запис захищено",
  "auth.accountRecovery.done.description":
    "Відновлення завершено, усі інші сесії вийшли. Увійдіть з новим паролем, щоб продовжити.",
}
