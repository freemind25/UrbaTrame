/* Écran de connexion commun à UrbaTrame et aux ateliers intégrés.
   Il ne conserve aucun OTP ni jeton dans le navigateur : la session est un
   cookie HttpOnly posé par le serveur. Les API restent l'autorité réelle. */
const $ = (selector, root = document) => root.querySelector(selector);
const copy = (fr, en) => document.documentElement.lang === 'en' ? en : fr;

const STYLE = `
.ut-student-gate{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:20px;background:rgba(9,18,16,.92);backdrop-filter:blur(10px);color:#182b24;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
.ut-student-card{width:min(460px,100%);padding:28px;border:1px solid #dce5dd;border-radius:22px;background:#fbfcf8;box-shadow:0 26px 100px rgba(0,0,0,.45)}
.ut-student-brand{display:flex;align-items:center;gap:12px;margin-bottom:18px;color:#153e3d;font-weight:800;font-size:22px;letter-spacing:-.04em}
.ut-student-brand span{display:block;color:#748178;font-size:10px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.ut-student-card h1{margin:0 0 8px;font-size:23px;line-height:1.2;color:#19372d}
.ut-student-card p{margin:0 0 18px;color:#596960;font-size:13px}
.ut-student-card label{display:block;margin:13px 0 6px;color:#46574d;font-size:12px;font-weight:700}
.ut-student-card input{box-sizing:border-box;width:100%;height:46px;padding:0 13px;border:1px solid #ccd7ce;border-radius:10px;background:#fff;color:#192c24;font:15px system-ui,sans-serif;outline:none}
.ut-student-card input:focus{border-color:#397c69;box-shadow:0 0 0 3px rgba(57,124,105,.14)}
.ut-student-card button{min-height:42px;padding:0 15px;border:1px solid #153e3d;border-radius:10px;background:#153e3d;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer}
.ut-student-card button:hover{background:#21564d}
.ut-student-card button:disabled{opacity:.55;cursor:wait}
.ut-student-card .ut-secondary{border-color:#d2dbd2;background:#fff;color:#33483c}
.ut-student-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.ut-student-message{min-height:22px;margin:12px 0 0!important;color:#3f6754!important;font-size:12px!important}
.ut-student-message.error{color:#9c342e!important}
.ut-student-note{margin:20px 0 0!important;padding-top:13px;border-top:1px solid #e5eae4;color:#758078!important;font-size:11px!important}
.ut-student-user{position:fixed;z-index:99998;top:10px;right:12px;display:flex;align-items:center;gap:9px;max-width:min(92vw,520px);padding:7px 9px 7px 12px;border:1px solid rgba(208,225,215,.35);border-radius:999px;background:rgba(16,42,35,.94);color:#eff6f0;box-shadow:0 5px 20px rgba(0,0,0,.18);font:12px system-ui,sans-serif}
.ut-student-user strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
.ut-student-user small{flex:none;color:#c1dfc7;font:700 9px ui-monospace,monospace;letter-spacing:.05em}
.ut-student-user button{flex:none;padding:5px 8px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:transparent;color:#fff;font:11px system-ui,sans-serif;cursor:pointer}
@media(max-width:520px){.ut-student-card{padding:22px}.ut-student-user{top:auto;right:8px;bottom:8px;max-width:calc(100vw - 16px)}}
`;

function appendStyle() {
  if ($('#utStudentGateStyle')) return;
  const style = document.createElement('style');
  style.id = 'utStudentGateStyle';
  style.textContent = STYLE;
  document.head.append(style);
}

function make(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'hidden' || key === 'disabled' || key === 'required') node[key] = Boolean(value);
    else if (key.startsWith('aria-') || ['type', 'name', 'autocomplete', 'inputmode', 'maxlength', 'pattern', 'placeholder', 'id', 'for'].includes(key)) node.setAttribute(key, String(value));
    else node.dataset[key] = String(value);
  }
  if (text) node.textContent = text;
  return node;
}

function setMessage(node, text, error = false) {
  node.textContent = text;
  node.classList.toggle('error', error);
}

function showGate({ ready, error = false, ownerLoginReady = false } = {}) {
  appendStyle();
  if ($('#utStudentGate')) return $('#utStudentGate');
  const overlay = make('section', { id: 'utStudentGate', class: 'ut-student-gate', 'aria-modal': 'true', role: 'dialog', 'aria-labelledby': 'utStudentTitle' });
  const card = make('div', { class: 'ut-student-card' });
  const brand = make('div', { class: 'ut-student-brand' });
  brand.append(document.createTextNode('UrbaTrame'));
  brand.append(make('span', {}, 'Designed by M.SADI'));
  card.append(brand);
  card.append(make('h1', { id: 'utStudentTitle' }, ready
    ? copy('Accès étudiant', 'Student access')
    : ownerLoginReady
      ? copy('Accès propriétaire', 'Owner access')
      : copy('Accès temporairement indisponible', 'Access temporarily unavailable')));
  const intro = make('p', {}, ready
    ? copy('Connectez-vous avec l’adresse universitaire qui a été ajoutée à la liste autorisée. Un code à usage unique sera envoyé si elle y figure.', 'Sign in with the university address added to the approved list. A one-time code will be sent if it is on that list.')
    : ownerLoginReady
      ? copy('Le service étudiant est indisponible. Le propriétaire peut se connecter avec son mot de passe dédié, sans adresse e-mail ni code OTP.', 'Student sign-in is unavailable. The owner can use the dedicated password, without an email address or OTP.')
      : copy('Le service d’authentification n’est pas encore configuré. Aucun accès n’est accordé pour le moment.', 'The authentication service is not configured yet. Access is not granted at this time.'));
  card.append(intro);

  const emailForm = make('form', { id: 'utStudentEmailForm', hidden: !ready });
  const emailLabel = make('label', { for: 'utStudentEmail' }, copy('Adresse e-mail universitaire', 'University email address'));
  const emailInput = make('input', { id: 'utStudentEmail', type: 'email', name: 'email', autocomplete: 'email', maxlength: '254', required: true, placeholder: 'matricule@univ-constantine3.dz' });
  const emailButton = make('button', { type: 'submit' }, copy('Recevoir un code', 'Send a code'));
  const emailMessage = make('p', { class: 'ut-student-message', id: 'utStudentEmailMessage', 'aria-live': 'polite' });
  emailForm.append(emailLabel, emailInput, emailButton, emailMessage);

  const codeForm = make('form', { id: 'utStudentCodeForm', hidden: true });
  const codeLabel = make('label', { for: 'utStudentCode' }, copy('Code à 6 chiffres', 'Six-digit code'));
  const codeInput = make('input', { id: 'utStudentCode', type: 'text', name: 'one-time-code', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '6', pattern: '[0-9]{6}', required: true, placeholder: '000000' });
  const codeButton = make('button', { type: 'submit' }, copy('Vérifier et entrer', 'Verify and continue'));
  const codeMessage = make('p', { class: 'ut-student-message', id: 'utStudentCodeMessage', 'aria-live': 'polite' });
  const codeActions = make('div', { class: 'ut-student-actions' });
  const resend = make('button', { class: 'ut-secondary', type: 'button', id: 'utStudentResend', disabled: true }, copy('Renvoyer le code', 'Resend code'));
  const changeEmail = make('button', { class: 'ut-secondary', type: 'button', id: 'utStudentChangeEmail' }, copy('Changer d’adresse', 'Change address'));
  codeActions.append(resend, changeEmail);
  codeForm.append(codeLabel, codeInput, codeButton, codeMessage, codeActions);

  let ownerForm = null, ownerInput = null, ownerButton = null, ownerMessage = null;
  let ownerChoice = null, ownerActions = null;
  if (ownerLoginReady) {
    ownerActions = make('div', { class: 'ut-student-actions' });
    ownerChoice = make('button', { class: 'ut-secondary', type: 'button', id: 'utOwnerAccess' }, copy('Accès propriétaire / administrateur', 'Owner / administrator access'));
    ownerActions.append(ownerChoice);

    ownerForm = make('form', { id: 'utOwnerPasswordForm', hidden: true });
    const ownerLabel = make('label', { for: 'utOwnerPassword' }, copy('Mot de passe propriétaire', 'Owner password'));
    ownerInput = make('input', { id: 'utOwnerPassword', type: 'password', name: 'password', autocomplete: 'current-password', maxlength: '512', required: true });
    ownerButton = make('button', { type: 'submit' }, copy('Se connecter comme administrateur', 'Sign in as administrator'));
    ownerMessage = make('p', { class: 'ut-student-message', id: 'utOwnerPasswordMessage', 'aria-live': 'polite' });
    const ownerFormActions = make('div', { class: 'ut-student-actions' });
    const ownerBack = make('button', { class: 'ut-secondary', type: 'button' }, copy('Retour à l’accès étudiant', 'Back to student access'));
    ownerBack.addEventListener('click', () => {
      ownerForm.hidden = true;
      ownerActions.hidden = false;
      emailForm.hidden = !ready;
      codeForm.hidden = true;
      if (ready) emailInput.focus();
    });
    ownerFormActions.append(ownerBack);
    ownerForm.append(ownerLabel, ownerInput, ownerButton, ownerMessage, ownerFormActions);
    ownerChoice.addEventListener('click', () => {
      emailForm.hidden = true;
      codeForm.hidden = true;
      ownerActions.hidden = true;
      ownerForm.hidden = false;
      ownerInput.focus();
    });
  }

  const note = make('p', { class: 'ut-student-note' }, copy('Les étudiants autorisés bénéficient automatiquement du niveau Max, incluant Pro. Le code n’est jamais demandé par l’équipe UrbaTrame.', 'Approved students automatically receive Max, including Pro. The UrbaTrame team will never ask you for this code.'));
  card.append(emailForm, codeForm);
  if (ownerActions) card.append(ownerActions, ownerForm);
  if (!ready) {
    const retry = make('button', { type: 'button' }, copy('Réessayer', 'Try again'));
    retry.addEventListener('click', () => window.location.reload());
    card.append(retry);
  }
  card.append(note);
  overlay.append(card);
  document.body.append(overlay);

  let selectedEmail = '';
  let resendTimer = null;
  let resendSeconds = 0;
  const updateResend = () => {
    resend.disabled = resendSeconds > 0;
    resend.textContent = resendSeconds > 0
      ? `${copy('Renvoyer dans', 'Resend in')} ${resendSeconds}s`
      : copy('Renvoyer le code', 'Resend code');
  };
  const startResendTimer = () => {
    clearInterval(resendTimer);
    resendSeconds = 60;
    updateResend();
    resendTimer = setInterval(() => {
      resendSeconds = Math.max(0, resendSeconds - 1);
      updateResend();
      if (!resendSeconds) clearInterval(resendTimer);
    }, 1000);
  };
  const requestCode = async () => {
    emailButton.disabled = true;
    try {
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ email: selectedEmail })
      });
      if (response.status === 503) throw new Error('SERVICE_UNAVAILABLE');
      if (!response.ok) throw new Error('REQUEST_FAILED');
      setMessage(codeMessage, copy('Si cette adresse est autorisée, un code lui sera envoyé. Vérifiez aussi vos courriers indésirables.', 'If this address is approved, a code will be sent. Check your spam folder too.'));
      emailForm.hidden = true;
      codeForm.hidden = false;
      codeInput.focus();
      startResendTimer();
    } catch {
      setMessage(emailMessage, copy('Impossible de demander un code pour le moment. Réessayez plus tard.', 'A code cannot be requested right now. Please try again later.'), true);
    } finally { emailButton.disabled = false; }
  };

  emailForm.addEventListener('submit', event => {
    event.preventDefault();
    selectedEmail = emailInput.value.trim().toLowerCase();
    if (!emailInput.reportValidity()) return;
    requestCode();
  });
  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      setMessage(codeMessage, copy('Saisissez les six chiffres reçus.', 'Enter the six digits you received.'), true);
      return;
    }
    codeButton.disabled = true;
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ email: selectedEmail, code })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        const error = new Error(result.error || 'INVALID_OR_EXPIRED_CODE');
        /* Le serveur ne fournit debug que sur Preview; ne montrer que stage/code
           assainis, jamais le message SQL, l’adresse, l’OTP ou les secrets. */
        error.debug = result.debug && typeof result.debug === 'object' ? result.debug : null;
        throw error;
      }
      setMessage(codeMessage, copy('Connexion réussie. Ouverture d’UrbaTrame…', 'Signed in. Opening UrbaTrame…'));
      window.location.reload();
    } catch (error) {
      const unavailable = error.message === 'STUDENT_AUTH_UNAVAILABLE';
      const stage = typeof error.debug?.stage === 'string' ? error.debug.stage : '';
      const diagnosticCode = typeof error.debug?.code === 'string' ? error.debug.code : '';
      const diagnostic = stage ? ` (${stage}${diagnosticCode ? `/${diagnosticCode}` : ''})` : '';
      const message = unavailable
        ? copy(`Service momentanément indisponible${diagnostic}.`, `Service temporarily unavailable${diagnostic}.`)
        : copy('Code incorrect ou expiré. Vérifiez-le ou demandez-en un nouveau.', 'The code is incorrect or expired. Check it or request a new one.');
      setMessage(codeMessage, message, true);
      codeInput.select();
    } finally { codeButton.disabled = false; }
  });
  if (ownerForm) ownerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!ownerInput.reportValidity()) return;
    ownerButton.disabled = true;
    setMessage(ownerMessage, '');
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ password: ownerInput.value })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        const failure = new Error(result.error || 'OWNER_AUTH_UNAVAILABLE');
        failure.status = response.status;
        throw failure;
      }
      ownerInput.value = '';
      setMessage(ownerMessage, copy('Connexion réussie. Ouverture d’UrbaTrame…', 'Signed in. Opening UrbaTrame…'));
      window.location.reload();
    } catch (failure) {
      const message = failure.status === 429
        ? copy('Trop de tentatives. Réessayez dans 15 minutes.', 'Too many attempts. Try again in 15 minutes.')
        : failure.status === 401
          ? copy('Mot de passe incorrect.', 'Incorrect password.')
          : copy('La connexion propriétaire est temporairement indisponible.', 'Owner sign-in is temporarily unavailable.');
      setMessage(ownerMessage, message, true);
      ownerInput.select();
    } finally { ownerButton.disabled = false; }
  });
  resend.addEventListener('click', () => { if (!resend.disabled) requestCode(); });
  changeEmail.addEventListener('click', () => {
    clearInterval(resendTimer);
    codeForm.hidden = true; emailForm.hidden = false; codeInput.value = '';
    setMessage(emailMessage, ''); emailInput.focus();
  });
  emailInput.focus();
  return overlay;
}

function showUser(user) {
  if ($('#utStudentUser') || !user) return;
  appendStyle();
  const owner = user.isOwner === true && user.role === 'admin';
  const badge = make('div', { id: 'utStudentUser', class: 'ut-student-user', 'aria-label': owner ? copy('Session propriétaire', 'Owner session') : copy('Session étudiante', 'Student session') });
  badge.append(make('strong', {}, owner ? copy('Propriétaire', 'Owner') : (user.email || '')));
  badge.append(make('small', {}, owner ? 'ADMIN · MAX' : 'MAX · PRO'));
  const logout = make('button', { type: 'button' }, copy('Déconnexion', 'Sign out'));
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store', body: '{}'
      });
    } finally { window.location.reload(); }
  });
  badge.append(logout);
  document.body.append(badge);
}

export const studentAuthReady = (async () => {
  try {
    const statusResponse = await fetch('/api/status', { cache: 'no-store', credentials: 'same-origin' });
    if (!statusResponse.ok) {
      showGate({ ready: false });
      return { required: true, ready: false, authenticated: false, user: null };
    }
    const status = await statusResponse.json();
    const required = status.auth?.required === true;
    if (!required) return { required: false, ready: status.auth?.ready !== false, user: null };
    const ready = status.auth?.ready === true;
    const ownerLoginReady = status.auth?.ownerLoginReady === true;
    if (!ready && !ownerLoginReady) {
      showGate({ ready: false });
      return { required: true, ready: false, authenticated: false, user: null };
    }
    const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!sessionResponse.ok) {
      showGate({ ready: false, error: true, ownerLoginReady });
      return { required: true, ready: false, authenticated: false, user: null };
    }
    const session = await sessionResponse.json();
    if (session.authenticated && session.user) {
      showUser(session.user);
      return { required: true, ready: true, authenticated: true, user: session.user };
    }
    showGate({ ready, ownerLoginReady });
    return { required: true, ready, authenticated: false, user: null };
  } catch {
    showGate({ ready: false });
    return { required: true, ready: false, authenticated: false, user: null };
  }
})();
