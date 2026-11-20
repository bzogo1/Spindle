/**
 * English dictionary — the source of truth for every translatable key.
 * Ukrainian (`uk.ts`) must define the same keys; `MessageKey` enforces it.
 *
 * Scope: site chrome — header/nav, footer, auth forms, common actions.
 * Long-form page copy stays in English until a locale rollout covers it.
 */
export const en = {
  // Brand / header chrome
  "nav.home": "Spindle home",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",

  // Top-level nav groups and standalone links
  "nav.product": "Product",
  "nav.solutions": "Solutions",
  "nav.pricing": "Pricing",
  "nav.resources": "Resources",
  "nav.company": "Company",
  "nav.docs": "Docs",
  "nav.blog": "Blog",
  "nav.changelog": "Changelog",
  "nav.searchSite": "Search site",

  // Nav card titles — `nav.link.<id>`; descriptions — `nav.link.<id>.desc`.
  // The same `nav.link.*` titles are reused for matching footer links.
  "nav.link.workspaceOverview": "Workspace overview",
  "nav.link.workspaceOverview.desc": "Every project gets one home",
  "nav.link.files": "Files",
  "nav.link.files.desc": "5 GB free, 100+ inline previews",
  "nav.link.lab": "The Lab",
  "nav.link.lab.desc": "Notebooks, R, SQL, canvas, graphs, and math",
  "nav.link.labPreview": "Lab notebook preview",
  "nav.link.labPreview.desc": "The Lab section on the homepage",
  "nav.link.localSearch": "Local search",
  "nav.link.localSearch.desc": "Academic and Basic modes, self-hosted",
  "nav.link.automations": "Automations",
  "nav.link.automations.desc": "Text it, build it, or write the cron",
  "nav.link.agent": "Agent",
  "nav.link.agent.desc": "Edits files, moves them, runs autonomously",
  "nav.link.teamChat": "Team chat",
  "nav.link.teamChat.desc": "Project channels, optional anonymity",
  "nav.link.collaboration": "Collaboration",
  "nav.link.collaboration.desc": "Live cursors, roles, and shared editing",
  "nav.link.infrastructure": "Infrastructure",
  "nav.link.infrastructure.desc": "Private by design, from TLS to storage",
  "nav.link.allFeatures": "All features",
  "nav.link.allFeatures.desc": "The whole platform on one page",
  "nav.link.researchers": "Individual researchers",
  "nav.link.researchers.desc": "A calm place for one project",
  "nav.link.labs": "Research labs",
  "nav.link.labs.desc": "Shared kernels, notes, and results",
  "nav.link.teams": "Research teams",
  "nav.link.teams.desc": "Channels, roles, and live presence",
  "nav.link.institutions": "Institutions",
  "nav.link.institutions.desc": "Central billing and easy onboarding",
  "nav.link.documentation": "Documentation",
  "nav.link.documentation.desc": "Set up a workspace and learn the tools",
  "nav.link.quickstart": "Quickstart",
  "nav.link.quickstart.desc": "Your first project in a few minutes",
  "nav.link.guides": "Guides",
  "nav.link.guides.desc": "Recipes for search, automations, and lab",
  "nav.link.changelog": "Changelog",
  "nav.link.changelog.desc": "What shipped and what changed",
  "nav.link.faq": "FAQ",
  "nav.link.faq.desc": "Practical questions, answered",
  "nav.link.about": "About",
  "nav.link.about.desc": "What Spindle is and why we built it",
  "nav.link.contact": "Contact",
  "nav.link.contact.desc": "Talk to us about your lab",

  // Footer
  "footer.tagline": "One place for all your research.",
  "footer.workspace": "Workspace",
  "footer.lab": "Lab",
  "footer.search": "Search",
  "footer.platformOverview": "Platform overview",
  "footer.integrations": "Integrations",
  "footer.getStarted": "Get started",
  "footer.referFriend": "Refer a friend",
  "footer.terms": "Terms of Service",
  "footer.privacy": "Privacy",
  "footer.cookiePolicy": "Cookie Policy",
  "footer.acceptableUse": "Acceptable use",
  "footer.dpa": "DPA & subprocessors",
  "footer.security": "Security",
  "footer.accessibility": "Accessibility",
  "footer.github": "GitHub",
  "footer.copyright": "© {year} Spindle Labs. Built for curious people.",

  // Auth
  "auth.signIn": "Sign in",
  "auth.signUp": "Sign up",
  "auth.signOut": "Sign out",
  "auth.startFree": "Start free",
  "auth.forgotPassword": "Forgot password?",
  "auth.welcomeBack": "Welcome back, {name}",
  "auth.createWorkspace": "Create workspace",
  "auth.createFreeWorkspace": "Create free workspace",
  "auth.creatingWorkspace": "Creating workspace…",
  "auth.resetPassword": "Reset password",
  "auth.sendResetLink": "Send reset link",
  "auth.keepSignedIn": "Keep me signed in",
  "auth.backToSignIn": "Back to sign in",
  "auth.signingIn": "Signing in…",
  "auth.sendingLink": "Sending link…",
  "auth.verify": "Verify",
  "auth.verifying": "Verifying…",
  "auth.twoFactor": "Two-factor verification",
  "auth.twoFactorHint":
    "This account uses two-factor authentication. Enter the 6-digit code from your authenticator app, or a backup code.",
  "auth.authCode": "Authentication code",
  "auth.workEmail": "Work email",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm password",
  "auth.workspaceName": "Workspace name",
  "auth.workspaceNameHint": "Lowercase letters, numbers and single dashes.",
  "auth.agreeTo": "I agree to the",
  "auth.termsOfService": "Terms of Service",
  "auth.and": "and",
  "auth.privacyPolicy": "Privacy Policy",
  "auth.freeTierNote": "5 GB free. No credit card.",
  "auth.orContinueWithEmail": "or continue with email",
  "auth.emailSignInLink": "Email me a sign-in link instead",
  "auth.signInLinkSent": "Sign-in link sent — check your inbox",
  "auth.securityKeySignIn": "Sign in with a passkey or security key",
  "auth.securityKeyWorking": "Waiting for passkey or security key…",
  "auth.securityKeyHint":
    "Works with passkeys and security keys. Security keys that aren't discoverable can't be offered here — sign in with your password or a passkey first.",
  "auth.passwordRequirements": "Password requirements",
  "auth.rule.length": "At least {min} characters",
  "auth.rule.letter": "Contains a letter",
  "auth.rule.number": "Contains a number",
  "auth.passwordStrength": "Password strength",
  "auth.passwordStrengthValue": "Password strength: {label}",
  "auth.strength.weak": "Weak",
  "auth.strength.fair": "Fair",
  "auth.strength.good": "Good",
  "auth.strength.strong": "Strong",

  // Session menu
  "auth.accountMenu": "Account menu",
  "auth.openApp": "Open app",
  "auth.accountSettings": "Account settings",
  "auth.verifyEmail": "Verify your email",
  "auth.sendingVerification": "Sending verification email…",

  // Password reset (token page)
  "auth.recoveryEyebrow": "Account recovery",
  "auth.chooseNewPassword": "Choose a new password",
  "auth.chooseNewPasswordDesc":
    "Pick a strong password for your Spindle account, then sign in with it.",
  "auth.newPassword": "New password",
  "auth.confirmNewPassword": "Confirm new password",
  "auth.passwordMinHint": "At least {min} characters.",
  "auth.updatePassword": "Update password",
  "auth.updatingPassword": "Updating password…",
  "auth.passwordUpdated": "Password updated",
  "auth.passwordUpdatedDesc":
    "Your password has been changed. Sign in with your new password to get back to your workspace.",
  "auth.requestNewLink": "Request a new link",
  "auth.contactSupport": "Contact support",
  "auth.link.expired.label": "Link expired",
  "auth.link.expired.title": "This reset link has expired",
  "auth.link.expired.description":
    "Password reset links expire quickly to keep accounts safe. Request a fresh link and we'll email it to you.",
  "auth.link.used.label": "Link already used",
  "auth.link.used.title": "This reset link has already been used",
  "auth.link.used.description":
    "If you already changed your password, sign in with the new one. Otherwise, request another link.",
  "auth.link.invalid.label": "Invalid link",
  "auth.link.invalid.title": "This reset link isn't valid",
  "auth.link.invalid.description":
    "The link is incomplete or may have been copied incorrectly. Request a new link to continue.",

  // Auth page shells (sign-in / sign-up split and centered shells)
  "auth.shell.signIn.eyebrow": "Account access",
  "auth.shell.signIn.title": "Welcome back",
  "auth.shell.signIn.description": "Sign in to continue to your workspace, files, and projects.",
  "auth.shell.signIn.switchPrompt": "New to Spindle?",
  "auth.shell.signIn.switchLabel": "Create an account",
  "auth.shell.signUp.eyebrow": "Get started",
  "auth.shell.signUp.title": "Create your workspace",
  "auth.shell.signUp.description":
    "Start with 5 GB of storage, shared projects, and a calm research home.",
  "auth.shell.signUp.switchPrompt": "Already have an account?",
  "auth.shell.signUp.switchLabel": "Sign in instead",
  "auth.shell.terms": "Terms",

  // Validation messages — validators in site/auth/validation.ts return these
  // keys; forms translate them through t() at render time.
  "auth.validation.emailRequired": "Enter your work email.",
  "auth.validation.emailInvalid": "Enter a valid email address, like you@lab.edu.",
  "auth.validation.passwordRequired": "Enter your password.",
  "auth.validation.passwordCreateRequired": "Create a password.",
  "auth.validation.passwordTooShort": "Use at least {min} characters.",
  "auth.validation.passwordLetterNumber": "Include a letter and a number.",
  "auth.validation.confirmRequired": "Confirm your password.",
  "auth.validation.passwordsDontMatch": "Passwords don't match.",
  "auth.validation.workspaceNameRequired": "Name your workspace.",
  "auth.validation.workspaceNameLength": "Use {wmin}–{wmax} characters.",
  "auth.validation.workspaceNameFormat": "Use lowercase letters, numbers and single dashes.",
  "auth.validation.workspaceNameReserved": "That workspace name is reserved. Try another.",
  "auth.validation.termsRequired": "Accept the Terms of Service and Privacy Policy to continue.",

  // Form-level error messages (client-side literals only — server-returned
  // error messages pass through untranslated).
  "auth.error.invalidCredentials": "Invalid email or password. Check your details and try again.",
  "auth.error.connection": "Something went wrong. Check your connection and try again.",
  "auth.error.emailForLink": "Enter a valid email address to get a sign-in link.",
  "auth.error.emailTaken":
    "An account already exists for this email. Try signing in instead, or use a different email.",
  "auth.error.finishSignIn":
    "We couldn't reach the server to finish signing you in. Check your connection and try again.",
  "auth.error.accountLocked": "Too many failed sign-in attempts. Try again in {time}.",

  // Proof-of-work captcha widget (auto-solving; no user interaction needed)
  "auth.captcha.verifying": "Verifying your browser…",
  "auth.captcha.passed": "Security check passed.",
  "auth.captcha.failed": "Security check unavailable.",
  "auth.captcha.retry": "Retry",

  // Site command menu (⌘K palette)
  "search.title": "Search Spindle",
  "search.placeholder": "Search pages, docs, changelog…",
  "search.noResults": "No results for “{query}”.",
  "search.group.pages": "Pages",
  "search.action": "Action",
  "search.group.actions": "Actions",
  "search.group.recent": "Recent",

  // Common actions
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.search": "Search",
  "common.language": "Language",
  "common.navigate": "Navigate",
  "common.select": "Select",
  "common.error": "Something went wrong. Please try again.",

  // Toasts
  "toast.verificationSent": "Verification email sent",
  "toast.verificationSentHint": "Check {email} for a link to confirm your address.",
  "toast.verificationFailed": "Couldn't send the verification email",
  "toast.tryAgain": "Please try again.",

  // Auth recovery screens — shared email-link form, password-reset request,
  // verify-email, magic-link, and OAuth callback states. Server-returned
  // error messages still pass through untranslated.
  "auth.backToSpindle": "Back to Spindle",
  "auth.checkInbox": "Check your inbox",
  "auth.signedInTitle": "You're signed in",
  "auth.linkIncompleteTitle": "This link is incomplete",
  "auth.error.generic": "Something went wrong. Try again.",
  "auth.emailLink.resend": "Resend email",
  "auth.emailLink.resendIn": "Resend in {seconds}s",
  "auth.emailLink.resendSent": "A new link is on its way to {email}.",
  "auth.emailLink.differentEmail": "Use a different email",
  "auth.emailLink.sending": "Sending…",
  "auth.resetRequest.title": "Reset your password",
  "auth.resetRequest.description":
    "Enter the work email on your Spindle account. If it matches, we'll send a link to choose a new password.",
  "auth.resetRequest.sentMessage":
    "We sent a reset link to {email}. The link expires in 30 minutes.",
  "auth.verify.verifyingTitle": "Verifying your email",
  "auth.verify.verifyingDescription":
    "Hold on while we confirm this link. This only takes a moment.",
  "auth.verify.verifiedTitle": "Email verified",
  "auth.verify.verifiedDescription":
    "Your address is confirmed. You can close this tab and get back to your workspace.",
  "auth.verify.continueToSpindle": "Continue to Spindle",
  "auth.verify.eyebrow": "Account security",
  "auth.verify.description": "Enter your work email and we'll send a fresh verification link.",
  "auth.verify.sentEyebrow": "Link sent",
  "auth.verify.sentDescription": "Open the link we just sent to finish verifying your address.",
  "auth.verify.expiredTitle": "This verification link has expired",
  "auth.verify.expiredDescription":
    "Verification links expire quickly to keep accounts safe. Send yourself a fresh one below.",
  "auth.verify.usedTitle": "This verification link has already been used",
  "auth.verify.usedDescription":
    "If your email is already verified, you can sign in from the homepage. Otherwise, send yourself a new link.",
  "auth.verify.invalidTitle": "This verification link isn't valid",
  "auth.verify.invalidDescription":
    "The link is incomplete or may have been copied incorrectly. Send a new verification email to continue.",
  "auth.verify.sendEmail": "Send verification email",
  "auth.verify.sentMessage": "A fresh verification link is on its way to {email}.",
  "auth.magicLink.verifyingTitle": "Signing you in",
  "auth.magicLink.verifyingDescription": "Hold on while we confirm your link.",
  "auth.magicLink.signedInDescription": "Taking you back to Spindle…",
  "auth.magicLink.missingDescription":
    "The sign-in link is missing its token. Request a fresh one from the sign-in dialog.",
  "auth.magicLink.invalidTitle": "This link didn't work",
  "auth.magicLink.invalidDescription": "The link is invalid or has expired. Request a fresh one.",
  "auth.magicLink.expiresHint": "This link expires in {expiry}.",
  "auth.magicLink.expiredTitle": "This sign-in link has expired",
  "auth.magicLink.expiredDescription":
    "For your security, sign-in links only work for {expiry}. Request a fresh one below.",
  "auth.magicLink.usedTitle": "This sign-in link was already used",
  "auth.magicLink.usedDescription":
    "Sign-in links work once. If you just signed in you can close this tab; otherwise request a fresh link below.",
  "auth.magicLink.resendLabel": "Email me a new link",
  "auth.magicLink.resendSent": "A new sign-in link is on its way to {email}.",
  "auth.magicLink.continueNow": "Continue now",
  "auth.oauth.providersLabel": "Single sign-on providers",
  "auth.oauth.continueWith": "Continue with {provider}",
  "auth.oauth.notConfigured": "{provider} sign-in isn't configured yet",
  "auth.oauth.soon": "Soon",
  "auth.oauth.providerDenied": "The provider cancelled or denied the sign-in.",
  "auth.oauth.verifyingTitle": "Finishing sign-in",
  "auth.oauth.verifyingDescription": "Hold on while we confirm with the provider.",
  "auth.oauth.signedInDescription": "Taking you to your workspace…",
  "auth.oauth.missingDescription":
    "The callback is missing its parameters. Start the sign-in again.",
  "auth.oauth.invalidTitle": "Sign-in didn't finish",
  "auth.oauth.invalidDescription": "The sign-in link is invalid or has expired. Try again.",

  // Onboarding wizard (/app/onboarding)
  "onboarding.eyebrow": "Welcome to Spindle",
  "onboarding.title": "Set up your workspace",
  "onboarding.progressLabel": "Setup progress",
  "onboarding.stepStatus": "Step {current} of {total}",
  "onboarding.steps.welcome": "Welcome",
  "onboarding.steps.profile": "Profile",
  "onboarding.steps.preferences": "Preferences",
  "onboarding.steps.tour": "Tour",
  "onboarding.back": "Back",
  "onboarding.next": "Next",
  "onboarding.getStarted": "Get started",
  "onboarding.skip": "Skip setup",
  "onboarding.later": "I'll do this later",
  "onboarding.finish": "Finish setup",
  "onboarding.finishing": "Finishing…",
  "onboarding.loading": "Loading setup…",
  "onboarding.welcome.title": "Welcome to Spindle",
  "onboarding.welcome.description":
    "Spindle is your workspace for projects, files, notebooks, and automations. This quick tour takes a couple of minutes — you can skip it at any time.",
  "onboarding.profile.title": "What should we call you?",
  "onboarding.profile.description":
    "This is the name your teammates will see across the workspace.",
  "onboarding.profile.displayName": "Display name",
  "onboarding.profile.displayNameHint":
    "Optional — shown to your teammates. You can change it later in profile settings.",
  "onboarding.preferences.title": "How will you use Spindle?",
  "onboarding.preferences.description":
    "Pick what fits best — you can adjust this later in workspace settings.",
  "onboarding.preferences.roleLabel": "I work as a…",
  "onboarding.role.individual": "Individual researcher",
  "onboarding.role.lab": "Research lab",
  "onboarding.role.team": "Research team",
  "onboarding.role.institution": "Institution",
  "onboarding.tour.title": "You're all set",
  "onboarding.tour.description":
    "Here's a quick look at where everything lives. You can revisit any of these from the sidebar.",
  "onboarding.tour.projects.title": "Projects and files",
  "onboarding.tour.projects.description":
    "Every project gets one home — notebooks, datasets, and documents together.",
  "onboarding.tour.lab.title": "The Lab",
  "onboarding.tour.lab.description": "Notebooks with R, SQL, canvas, and graphs, all in one place.",
  "onboarding.tour.automations.title": "Automations and agent",
  "onboarding.tour.automations.description":
    "Schedule recurring jobs or let the agent move work for you.",

  // Account recovery wizard (/account-recovery) — guided email → token →
  // verified steps → complete flow. Server-returned errors pass through.
  "auth.accountRecovery.request.title": "Recover your account",
  "auth.accountRecovery.request.description":
    "Enter the email on your Spindle account. If it matches, we'll send a secure recovery link.",
  "auth.accountRecovery.request.submit": "Send recovery link",
  "auth.accountRecovery.request.sentTitle": "Check your inbox",
  "auth.accountRecovery.request.sentMessage":
    "We sent a recovery link to {email}. It expires in 30 minutes and works once.",
  "auth.accountRecovery.verifyingTitle": "Verifying your recovery link",
  "auth.accountRecovery.verifyingDescription":
    "Hold on while we confirm this link. This only takes a moment.",
  "auth.accountRecovery.link.expired.label": "Link expired",
  "auth.accountRecovery.link.expired.title": "This recovery link has expired",
  "auth.accountRecovery.link.expired.description":
    "Recovery links expire quickly to keep accounts safe. Request a fresh one below.",
  "auth.accountRecovery.link.used.label": "Link already used",
  "auth.accountRecovery.link.used.title": "This recovery link has already been used",
  "auth.accountRecovery.link.used.description":
    "Recovery links work once. If you already finished recovering, sign in with your new password; otherwise request another link.",
  "auth.accountRecovery.link.invalid.label": "Invalid link",
  "auth.accountRecovery.link.invalid.title": "This recovery link isn't valid",
  "auth.accountRecovery.link.invalid.description":
    "The link is incomplete or may have been copied incorrectly. Request a new recovery link to continue.",
  "auth.accountRecovery.steps.title": "Secure your account",
  "auth.accountRecovery.steps.description":
    "Your inbox is verified. Work through these steps for {email} to finish recovering your account.",
  "auth.accountRecovery.step.password.title": "Set a new password",
  "auth.accountRecovery.step.password.description":
    "Choose a strong password — you'll use it to sign in from now on.",
  "auth.accountRecovery.step.email.title": "Confirm your email",
  "auth.accountRecovery.step.email.description":
    "Mark your address as verified — opening the recovery link already proved you control it.",
  "auth.accountRecovery.step.security.title": "Review security activity",
  "auth.accountRecovery.step.security.description":
    "Check recent sign-ins and account events. If anything looks unfamiliar, finish recovery and change your password right away.",
  "auth.accountRecovery.step.finish.title": "Finish recovery",
  "auth.accountRecovery.step.finish.description":
    "Completing recovery signs out every existing session, including this one.",
  "auth.accountRecovery.confirmEmail": "Mark email as verified",
  "auth.accountRecovery.emailVerified": "Email verified",
  "auth.accountRecovery.securityEventsTitle": "Recent security activity",
  "auth.accountRecovery.securityEventsEmpty": "No recent account activity to review.",
  "auth.accountRecovery.finish": "Finish recovery",
  "auth.accountRecovery.finishing": "Finishing…",
  "auth.accountRecovery.sessionHint":
    "This recovery session expires in about {minutes} minutes. Finish before then or start again.",
  "auth.accountRecovery.done.title": "Account secured",
  "auth.accountRecovery.done.description":
    "Recovery is complete and every other session was signed out. Sign in with your new password to continue.",

  // INTENTIONALLY UNWIRED / DELIBERATELY ENGLISH — see notes inline:
  //   "nav.blog"      — no top-level Blog link exists in header/footer/nav.
  //   "nav.signUp"    — the header CTA is "Start free"; shells say "Create an account".
  //   "auth.signUp"   — same as nav.signUp; no standalone "Sign up" label rendered.
  //   "auth.welcomeBack" — session menu shows the raw display name, not a greeting.
  //   "common.save" / "common.cancel" / "common.retry" / "common.error" —
  //     generic actions with no owned consumer yet (forms use auth.error.*).
  //
  // Deliberately left English (not dictionary keys):
  //   - All page body content: marketing copy, docs guides, changelog
  //     entries, blog posts, legal pages. Only chrome + auth UI is localized.
  //   - Search-index item titles/descriptions: docs/changelog content is
  //     authored in English; only group labels and action items translate.
  //   - Server-returned error messages (AuthApiError.message, API error
  //     payloads) pass through untranslated by design.
  //   - Provider/brand names (Google, GitHub) and the "you@lab.edu"
  //     email placeholder are locale-neutral.
  //   - Cookie-consent banner, PWA install prompt, and toasts raised by
  //     non-auth flows keep their existing English copy.
} as const

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
