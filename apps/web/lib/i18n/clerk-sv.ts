import { svSE } from '@clerk/localizations';

/**
 * Swedish Clerk localization = Clerk's svSE pack + overrides for keys the pack leaves
 * untranslated (Clerk then falls back to English). Covers every flow a FastighetsRadar
 * user can reach: sign-in/up edge cases, password reset, two-step setup, account and
 * organization menus, and Clerk's error messages. Enterprise SSO, billing and API-key
 * screens are not enabled for this application and are intentionally not translated.
 */
const overrides = {
  actionBlocked: {
    title: 'Vi kunde inte slutföra begäran',
    subtitle: 'Av säkerhetsskäl kunde begäran inte slutföras.',
    traceIdLabel: 'Referens',
  },
  formFieldInputPlaceholder__signUpPassword: 'Skapa ett lösenord',
  formFieldInput__emailAddress_format: 'Exempel: namn@exempel.se',
  identityPreviewEditButton__emailAddress: 'Ändra e-postadress',
  identityPreviewEditButton__identifier: 'Ändra användaruppgift',
  identityPreviewEditButton__phoneNumber: 'Ändra telefonnummer',
  searchInput: { action__clear: 'Rensa sökning' },
  userButton: { action__openUserMenu: 'Öppna användarmenyn', action__closeUserMenu: 'Stäng användarmenyn' },
  organizationSwitcher: {
    action__openOrganizationSwitcher: 'Öppna organisationsväljaren',
    action__closeOrganizationSwitcher: 'Stäng organisationsväljaren',
  },
  organizationProfile: {
    membersPage: { action__search: 'Sök' },
    start: { membershipSeatUsageLabel: '{{count}} av {{limit}} platser används' },
  },
  userProfile: {
    emailAddressPage: { formHint: 'Du behöver verifiera e-postadressen innan den kan läggas till på ditt konto.' },
  },
  signIn: {
    start: { titleCombined: 'Fortsätt till {{applicationName}}' },
    emailLink: { verifiedTransferable: { title: 'E-postadressen är verifierad', subtitle: 'Gå tillbaka till den ursprungliga fliken för att fortsätta' } },
    passwordCompromised: { title: 'Lösenordet har läckt' },
    passwordUntrusted: { title: 'Lösenordet är inte betrott' },
    protectCheck: { title: 'Vi verifierar din begäran', subtitle: 'Vänta medan vi verifierar din begäran.', loading: 'Laddar…', retryButton: 'Försök igen' },
  },
  signUp: {
    protectCheck: { title: 'Vi verifierar din begäran', subtitle: 'Vänta medan vi verifierar din begäran.', loading: 'Laddar…', retryButton: 'Försök igen' },
    restrictedAccess: { actionText: 'Har du redan ett konto?', blockButton__emailSupport: 'Mejla supporten' },
  },
  taskResetPassword: {
    title: 'Återställ ditt lösenord',
    subtitle: 'Ditt konto kräver ett nytt lösenord innan du kan fortsätta',
    formButtonPrimary: 'Återställ lösenord',
    signOut: { actionText: 'Inloggad som {{identifier}}', actionLink: 'Logga ut' },
  },
  taskSetupMfa: {
    badge: 'Konfigurera tvåstegsverifiering',
    signOut: { actionText: 'Inloggad som {{identifier}}', actionLink: 'Logga ut' },
    start: {
      title: 'Konfigurera tvåstegsverifiering',
      subtitle: 'Välj vilken metod du vill använda för att skydda ditt konto med ett extra säkerhetslager',
      methodSelection: { phoneCode: 'SMS-kod', totp: 'Autentiseringsapp' },
    },
    smsCode: {
      title: 'Lägg till verifiering med SMS-kod',
      subtitle: 'Välj vilket telefonnummer du vill använda för tvåstegsverifiering med SMS-kod',
      addPhoneNumber: 'Lägg till telefonnummer',
      cancel: 'Avbryt',
      addPhone: {
        formButtonPrimary: 'Fortsätt',
        infoText: 'Ett sms med en verifieringskod skickas till det här telefonnumret. Avgifter för meddelanden och data kan tillkomma.',
      },
      verifyPhone: {
        title: 'Verifiera ditt telefonnummer',
        subtitle: 'Ange verifieringskoden som skickades till',
        formTitle: 'Verifieringskod',
        formButtonPrimary: 'Fortsätt',
        resendButton: 'Fick du ingen kod? Skicka igen',
      },
      success: {
        title: 'Verifiering med SMS-kod är aktiverad',
        message1: 'Tvåstegsverifiering är nu aktiverad. När du loggar in behöver du ange en verifieringskod som skickas till det här telefonnumret som ett extra steg.',
        message2: 'Spara de här reservkoderna på ett säkert ställe. Om du förlorar åtkomsten till din autentiseringsenhet kan du använda reservkoderna för att logga in.',
        finishButton: 'Fortsätt',
      },
    },
    totpCode: {
      title: 'Lägg till autentiseringsapp',
      addAuthenticatorApp: {
        infoText__ableToScan: 'Lägg till en ny inloggningsmetod i din autentiseringsapp och skanna följande QR-kod för att koppla den till ditt konto.',
        infoText__unableToScan: 'Lägg till en ny inloggningsmetod i din autentiseringsapp och ange nyckeln nedan.',
        inputLabel__unableToScan1: 'Kontrollera att tidsbaserade eller engångslösenord är aktiverade och slutför sedan kopplingen av ditt konto.',
        buttonAbleToScan__nonPrimary: 'Skanna QR-kod i stället',
        buttonUnableToScan__nonPrimary: 'Kan du inte skanna QR-koden?',
        formButtonPrimary: 'Fortsätt',
        formButtonReset: 'Avbryt',
      },
      verifyTotp: {
        title: 'Lägg till autentiseringsapp',
        subtitle: 'Ange verifieringskoden som genereras av din autentiseringsapp',
        formTitle: 'Verifieringskod',
        formButtonPrimary: 'Fortsätt',
        formButtonReset: 'Avbryt',
      },
      success: {
        title: 'Verifiering med autentiseringsapp är aktiverad',
        message1: 'Tvåstegsverifiering är nu aktiverad. När du loggar in behöver du ange en verifieringskod från den här autentiseringsappen som ett extra steg.',
        message2: 'Spara de här reservkoderna på ett säkert ställe. Om du förlorar åtkomsten till din autentiseringsenhet kan du använda reservkoderna för att logga in.',
        finishButton: 'Fortsätt',
      },
    },
  },
  unstable__errors: {
    action_blocked: 'Åtgärden kunde inte slutföras. Försök igen senare eller kontakta supporten om problemet kvarstår.',
    external_account_not_found: 'Kontot hittades inte. Skapa ett konto eller logga in med ett annat konto.',
    form_new_password_matches_current: 'Det nya lösenordet får inte vara samma som det nuvarande.',
    form_password_matches_identifier: 'Lösenordet får inte vara samma som din e-postadress, ditt telefonnummer eller användarnamn. Välj ett annat lösenord för kontots säkerhet.',
    form_password_untrusted__sign_in: 'Ditt lösenord kan ha läckt. Fortsätt med en annan inloggningsmetod för att skydda ditt konto.',
    insufficient_seats_change_plan: 'Organisationen har inte tillräckligt många platser för att bjuda in så många medlemmar. Byt till en plan med fler platser.',
    insufficient_seats_contact_support: 'Organisationen har inte tillräckligt många platser för att bjuda in så många medlemmar. Kontakta supporten.',
    oauth_access_denied: 'Du gav inte åtkomst till ditt konto.',
    organization_not_found_or_unauthorized: 'Du är inte längre medlem i den här organisationen. Välj eller skapa en annan.',
    organization_not_found_or_unauthorized_with_create_organization_disabled: 'Du är inte längre medlem i den här organisationen. Välj en annan.',
    protect_check_execution_failed: 'Verifieringen slutfördes inte. Försök igen.',
    protect_check_invalid_script: 'Verifieringen kunde inte laddas. Kontakta supporten om problemet kvarstår.',
    protect_check_invalid_sdk_url: 'Verifieringen kunde inte starta. Kontakta supporten.',
    protect_check_required: 'Inloggningen kräver ett extra verifieringssteg som inte kan visas här. Försök igen eller använd en annan inloggningsmetod.',
    protect_check_script_load_failed: 'Verifieringen kunde inte laddas. Det kan bero på ett nätverksproblem eller en säkerhetspolicy som blockerar skriptet.',
    protect_check_timed_out: 'Verifieringen hann inte slutföras. Försök igen.',
    protect_check_unsupported_environment: 'Verifieringen stöds inte i den här miljön. Fortsätt i en vanlig webbläsare eller kontakta supporten.',
    signup_rate_limit_exceeded: 'För många förfrågningar. Försök igen om en stund.',
    ticket_expired_code: 'Länken har gått ut. Börja om eller begär en ny länk.',
    ticket_invalid_code: 'Länken är inte längre giltig eller har redan använts. Börja om eller begär en ny länk.',
    too_many_requests: 'För många förfrågningar. Försök igen om en stund.',
    too_many_unverified_identifications: 'För många verifieringar väntar på kontot. Ta bort en overifierad e-postadress eller ett overifierat telefonnummer och försök igen.',
  },
};

type Dict = { [k: string]: unknown };
const isObj = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k] as Dict, v) : isObj(v) ? merge({}, v) : v;
  return out;
}

export const clerkSv = merge(svSE as unknown as Dict, overrides) as unknown as typeof svSE;
