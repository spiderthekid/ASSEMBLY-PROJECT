import type { AuthManager, OperatorProfile } from '../core/AuthManager';
import type { AudioManager } from '../core/AudioManager';

export type AuthViewMode = 'login' | 'signup' | 'otp';

export class AuthUI {
  readonly rootEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly viewLoginEl: HTMLElement;
  private readonly viewSignupEl: HTMLElement;
  private readonly viewOtpEl: HTMLElement;

  private readonly statusBannerEl: HTMLElement;
  private readonly droneMapNameEl: HTMLElement;
  private readonly devInterceptEl: HTMLElement;
  private readonly devInterceptCodeEl: HTMLElement;

  // Login inputs
  private readonly loginForm: HTMLFormElement;
  private readonly loginEmailInp: HTMLInputElement;
  private readonly loginPassInp: HTMLInputElement;
  private readonly loginSubmitBtn: HTMLButtonElement;

  // Signup inputs
  private readonly signupForm: HTMLFormElement;
  private readonly signupCallsignInp: HTMLInputElement;
  private readonly signupEmailInp: HTMLInputElement;
  private readonly signupPassInp: HTMLInputElement;
  private readonly signupSubmitBtn: HTMLButtonElement;

  // 6-Digit OTP inputs
  private readonly otpForm: HTMLFormElement;
  private readonly otpPromptEl: HTMLElement;
  private readonly otpDigitInputs: HTMLInputElement[] = [];
  private readonly otpVerifyBtn: HTMLButtonElement;
  private readonly otpResendBtn: HTMLButtonElement;
  private readonly otpChangeEmailBtn: HTMLButtonElement;

  private currentView: AuthViewMode = 'login';
  private targetEmail = '';
  private resendCooldownSec = 0;
  private resendIntervalId: number | null = null;
  private visible = true;

  constructor(
    container: HTMLElement,
    private readonly authManager: AuthManager,
    private readonly audio: AudioManager,
    private readonly callbacks: {
      onAuthenticated: (operator: OperatorProfile) => void;
    },
  ) {
    const root = document.createElement('div');
    root.id = 'auth-screen-root';
    root.className = 'auth-screen-root';
    root.innerHTML = `
      <div class="auth-vignette-layer"></div>
      <div class="auth-scanline-layer"></div>

      <!-- Top-Left Tactical Classification Header -->
      <div class="auth-top-left-telemetry">
        <div class="auth-sys-badge">
          <span class="auth-sys-dot"></span>
          <span>ASSEMBLY // TACTICAL OPERATOR NETWORK v2.4</span>
        </div>
        <div class="auth-sys-sub">SATCOM UPLINK: ENCRYPTED · PERMADEATH SCAVENGER PROTOCOL</div>
      </div>

      <!-- Top-Right Dev Mode Comms Intercept Toast -->
      <div class="auth-dev-intercept" id="auth-dev-intercept" style="display:none" title="Click to auto-fill 6-digit security code">
        <div class="dev-intercept-header">
          <span class="dev-intercept-pulse"></span>
          <span id="auth-dev-intercept-text">[COMMS INTERCEPT - DEV MODE]: Your 6-Digit Code is <b id="auth-dev-code">000000</b></span>
        </div>
        <div class="dev-intercept-sub">CLICK BANNER OR PRESS CTRL+V TO INPUT DISPATCHED OTP</div>
      </div>

      <!-- Center Glassmorphic Military Terminal Card -->
      <div class="auth-terminal-card" id="auth-terminal-card">
        <!-- Corner Reticle Brackets [ ] -->
        <span class="reticle-corner tl" aria-hidden="true"></span>
        <span class="reticle-corner tr" aria-hidden="true"></span>
        <span class="reticle-corner bl" aria-hidden="true"></span>
        <span class="reticle-corner br" aria-hidden="true"></span>

        <div class="auth-card-header">
          <div class="auth-card-kicker">
            <span class="kicker-bracket">[</span>
            <span>OPERATOR AUTHENTICATION TERMINAL</span>
            <span class="kicker-bracket">]</span>
          </div>
          <h1 class="auth-card-title">ASSEMBLY</h1>
          <div class="auth-card-subtitle">TACTICAL ARENA FPS // 1-LIFE PERMADEATH SANDBOX</div>
        </div>

        <div class="auth-status-banner" id="auth-status-banner" style="display:none"></div>

        <!-- VIEW 1: LOGIN VIEW -->
        <div class="auth-view active" id="auth-view-login" data-view="login">
          <div class="auth-section-tag">// 01 · EXISTING OPERATOR CLEARANCE</div>
          <form id="auth-login-form" autocomplete="on" novalidate>
            <div class="auth-field">
              <label for="auth-login-email">EMAIL ADDRESS</label>
              <div class="auth-input-wrap">
                <input
                  id="auth-login-email"
                  type="email"
                  class="auth-input"
                  placeholder="operator@taskforce.mil"
                  autocomplete="email"
                  required
                />
              </div>
            </div>

            <div class="auth-field">
              <label for="auth-login-password">PASSWORD</label>
              <div class="auth-input-wrap">
                <input
                  id="auth-login-password"
                  type="password"
                  class="auth-input has-toggle"
                  placeholder="••••••••••••"
                  autocomplete="current-password"
                  required
                />
                <button
                  type="button"
                  class="auth-pw-toggle"
                  data-target="auth-login-password"
                  aria-label="Toggle password visibility"
                >SHOW</button>
              </div>
            </div>

            <button type="submit" class="auth-btn-primary" id="auth-login-submit">
              [ DEPLOY TO LOBBY ]
            </button>
          </form>

          <div class="auth-switch-row">
            <button type="button" class="auth-switch-link" id="auth-goto-signup">
              New Operator? -&gt; <span>INITIALIZE CALLSIGN (SIGN UP)</span>
            </button>
          </div>
        </div>

        <!-- VIEW 2: SIGNUP VIEW -->
        <div class="auth-view" id="auth-view-signup" data-view="signup" style="display:none">
          <div class="auth-section-tag">// 02 · NEW OPERATOR CALLSIGN REGISTRATION</div>
          <form id="auth-signup-form" autocomplete="on" novalidate>
            <div class="auth-field">
              <label for="auth-signup-callsign">OPERATOR CALLSIGN</label>
              <div class="auth-input-wrap">
                <input
                  id="auth-signup-callsign"
                  type="text"
                  class="auth-input"
                  placeholder="GHOST-01"
                  maxlength="18"
                  autocomplete="username"
                  required
                />
              </div>
            </div>

            <div class="auth-field">
              <label for="auth-signup-email">EMAIL ADDRESS</label>
              <div class="auth-input-wrap">
                <input
                  id="auth-signup-email"
                  type="email"
                  class="auth-input"
                  placeholder="operator@taskforce.mil"
                  autocomplete="email"
                  required
                />
              </div>
            </div>

            <div class="auth-field">
              <label for="auth-signup-password">PASSWORD</label>
              <div class="auth-input-wrap">
                <input
                  id="auth-signup-password"
                  type="password"
                  class="auth-input has-toggle"
                  placeholder="Min. 6 characters"
                  autocomplete="new-password"
                  required
                />
                <button
                  type="button"
                  class="auth-pw-toggle"
                  data-target="auth-signup-password"
                  aria-label="Toggle password visibility"
                >SHOW</button>
              </div>
            </div>

            <button type="submit" class="auth-btn-primary" id="auth-signup-submit">
              [ SEND 6-DIGIT SECURITY CODE ]
            </button>
          </form>

          <div class="auth-switch-row">
            <button type="button" class="auth-switch-link" id="auth-goto-login">
              Existing Operator? -&gt; <span>RETURN TO LOGIN</span>
            </button>
          </div>
        </div>

        <!-- VIEW 3: 6-DIGIT EMAIL OTP VERIFICATION VIEW (NO LINKS) -->
        <div class="auth-view" id="auth-view-otp" data-view="otp" style="display:none">
          <div class="auth-section-tag">// 03 · TWO-FACTOR TACTICAL COMMS VERIFICATION</div>
          <p class="auth-otp-prompt" id="auth-otp-prompt">
            ENTER 6-DIGIT VERIFICATION CODE DISPATCHED TO OPERATOR@TASKFORCE.MIL
          </p>

          <form id="auth-otp-form" autocomplete="off" novalidate>
            <div class="auth-otp-boxes" id="auth-otp-boxes">
              <input type="text" inputmode="numeric" maxlength="1" class="auth-otp-digit" data-idx="0" aria-label="Digit 1" />
              <input type="text" inputmode="numeric" maxlength="1" class="auth-otp-digit" data-idx="1" aria-label="Digit 2" />
              <input type="text" inputmode="numeric" maxlength="1" class="auth-otp-digit" data-idx="2" aria-label="Digit 3" />
              <input type="text" inputmode="numeric" maxlength="1" class="auth-otp-digit" data-idx="3" aria-label="Digit 4" />
              <input type="text" inputmode="numeric" maxlength="1" class="auth-otp-digit" data-idx="4" aria-label="Digit 5" />
              <input type="text" inputmode="numeric" maxlength="1" class="auth-otp-digit" data-idx="5" aria-label="Digit 6" />
            </div>

            <button type="submit" class="auth-btn-primary" id="auth-otp-submit">
              [ VERIFY &amp; UNLOCK SANDBOX ]
            </button>
          </form>

          <div class="auth-otp-secondary-actions">
            <button type="button" class="auth-btn-secondary" id="auth-otp-resend">
              RESEND CODE
            </button>
            <button type="button" class="auth-btn-secondary" id="auth-otp-change-email">
              CHANGE EMAIL
            </button>
          </div>
        </div>
      </div>

      <!-- Bottom-Left Live Camera Telemetry Tag -->
      <div class="auth-drone-telemetry" id="auth-drone-telemetry">
        <span class="drone-rec-dot"></span>
        <span class="drone-feed-text">
          LIVE DRONE FEED // SECTOR: <b id="auth-drone-map-name">KILLHOUSE ALPHA</b> // AI COMBATANTS ACTIVE
        </span>
      </div>
    `;

    container.appendChild(root);
    this.rootEl = root;
    this.cardEl = root.querySelector('#auth-terminal-card') as HTMLElement;
    this.viewLoginEl = root.querySelector('#auth-view-login') as HTMLElement;
    this.viewSignupEl = root.querySelector('#auth-view-signup') as HTMLElement;
    this.viewOtpEl = root.querySelector('#auth-view-otp') as HTMLElement;

    this.statusBannerEl = root.querySelector('#auth-status-banner') as HTMLElement;
    this.droneMapNameEl = root.querySelector('#auth-drone-map-name') as HTMLElement;
    this.devInterceptEl = root.querySelector('#auth-dev-intercept') as HTMLElement;
    this.devInterceptCodeEl = root.querySelector('#auth-dev-code') as HTMLElement;

    this.loginForm = root.querySelector('#auth-login-form') as HTMLFormElement;
    this.loginEmailInp = root.querySelector('#auth-login-email') as HTMLInputElement;
    this.loginPassInp = root.querySelector('#auth-login-password') as HTMLInputElement;
    this.loginSubmitBtn = root.querySelector('#auth-login-submit') as HTMLButtonElement;

    this.signupForm = root.querySelector('#auth-signup-form') as HTMLFormElement;
    this.signupCallsignInp = root.querySelector('#auth-signup-callsign') as HTMLInputElement;
    this.signupEmailInp = root.querySelector('#auth-signup-email') as HTMLInputElement;
    this.signupPassInp = root.querySelector('#auth-signup-password') as HTMLInputElement;
    this.signupSubmitBtn = root.querySelector('#auth-signup-submit') as HTMLButtonElement;

    this.otpForm = root.querySelector('#auth-otp-form') as HTMLFormElement;
    this.otpPromptEl = root.querySelector('#auth-otp-prompt') as HTMLElement;
    this.otpVerifyBtn = root.querySelector('#auth-otp-submit') as HTMLButtonElement;
    this.otpResendBtn = root.querySelector('#auth-otp-resend') as HTMLButtonElement;
    this.otpChangeEmailBtn = root.querySelector('#auth-otp-change-email') as HTMLButtonElement;

    root.querySelectorAll('.auth-otp-digit').forEach((el) => {
      this.otpDigitInputs.push(el as HTMLInputElement);
    });

    this.bindEvents();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get activeView(): AuthViewMode {
    return this.currentView;
  }

  /**
   * Updates the bottom-left live drone telemetry tag with the current 3D background map name.
   */
  setSectorMapName(mapName: string): void {
    this.droneMapNameEl.textContent = mapName.toUpperCase();
  }

  /**
   * Displays or hides the top-right `[COMMS INTERCEPT - DEV MODE]: Your 6-Digit Code is <CODE>` banner.
   */
  showDevCommsIntercept(code: string | null): void {
    if (!code) {
      this.devInterceptEl.style.display = 'none';
      return;
    }
    this.devInterceptCodeEl.textContent = code;
    this.devInterceptEl.style.display = 'flex';
  }

  /**
   * Shows the AuthUI overlay and blurs the live 3D bot-fight canvas behind it.
   */
  show(initialView: AuthViewMode = 'login'): void {
    this.visible = true;
    this.rootEl.classList.remove('auth-hidden');
    this.rootEl.style.display = 'flex';
    this.switchView(initialView);
  }

  /**
   * Smoothly removes the canvas blur and hides the AuthUI once authenticated.
   */
  hide(): void {
    this.visible = false;
    this.rootEl.classList.add('auth-hidden');
    this.showDevCommsIntercept(null);
    this.clearStatusBanner();
    window.setTimeout(() => {
      if (!this.visible) {
        this.rootEl.style.display = 'none';
      }
    }, 280);
  }

  /**
   * Switches between the 3 views: `'login'`, `'signup'`, and `'otp'`.
   */
  switchView(view: AuthViewMode, emailForOtp?: string): void {
    this.currentView = view;
    this.clearStatusBanner();

    this.viewLoginEl.style.display = view === 'login' ? 'block' : 'none';
    this.viewSignupEl.style.display = view === 'signup' ? 'block' : 'none';
    this.viewOtpEl.style.display = view === 'otp' ? 'block' : 'none';

    this.viewLoginEl.classList.toggle('active', view === 'login');
    this.viewSignupEl.classList.toggle('active', view === 'signup');
    this.viewOtpEl.classList.toggle('active', view === 'otp');

    if (view === 'otp') {
      if (emailForOtp) {
        this.targetEmail = emailForOtp.trim().toUpperCase();
      }
      const shownEmail = this.targetEmail || 'OPERATOR@TASKFORCE.MIL';
      this.otpPromptEl.textContent = `ENTER 6-DIGIT VERIFICATION CODE DISPATCHED TO ${shownEmail}`;
      this.clearOtpDigits();
      window.setTimeout(() => {
        this.otpDigitInputs[0]?.focus();
      }, 40);
    } else if (view === 'login') {
      window.setTimeout(() => {
        this.loginEmailInp.focus();
      }, 40);
    } else if (view === 'signup') {
      window.setTimeout(() => {
        this.signupCallsignInp.focus();
      }, 40);
    }
  }

  private bindEvents(): void {
    // Prevent keyboard shortcuts from leaking to game loop when typing in AuthUI
    this.rootEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    // Unlock WebAudio on first user click inside AuthUI so 15% muffled ambient gunfire is audible
    this.rootEl.addEventListener('pointerdown', () => {
      this.audio.unlock();
    });

    // Show/Hide Password Toggles
    this.rootEl.querySelectorAll('.auth-pw-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = (btn as HTMLElement).dataset.target;
        if (!targetId) return;
        const input = this.rootEl.querySelector(`#${targetId}`) as HTMLInputElement | null;
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? 'HIDE' : 'SHOW';
      });
    });

    // View Switch Links
    const gotoSignupBtn = this.rootEl.querySelector('#auth-goto-signup') as HTMLButtonElement;
    gotoSignupBtn.addEventListener('click', () => {
      this.audio.playMechanical(1350, 0.14);
      if (this.loginEmailInp.value && !this.signupEmailInp.value) {
        this.signupEmailInp.value = this.loginEmailInp.value;
      }
      this.switchView('signup');
    });

    const gotoLoginBtn = this.rootEl.querySelector('#auth-goto-login') as HTMLButtonElement;
    gotoLoginBtn.addEventListener('click', () => {
      this.audio.playMechanical(1250, 0.14);
      if (this.signupEmailInp.value && !this.loginEmailInp.value) {
        this.loginEmailInp.value = this.signupEmailInp.value;
      }
      this.switchView('login');
    });

    // Dev Intercept Banner click -> auto-populate 6-digit boxes for rapid testing
    this.devInterceptEl.addEventListener('click', () => {
      const code = this.devInterceptCodeEl.textContent?.trim() ?? '';
      if (/^\d{6}$/.test(code) && this.currentView === 'otp') {
        this.fillOtpDigits(code);
        this.audio.playMechanical(1680, 0.18);
      }
    });

    // 1. LOGIN FORM SUBMIT
    this.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.audio.unlock();
      this.audio.playMechanical(1480, 0.18);

      const email = this.loginEmailInp.value.trim();
      const password = this.loginPassInp.value;

      this.loginSubmitBtn.disabled = true;
      this.loginSubmitBtn.textContent = '[ AUTHENTICATING... ]';
      this.clearStatusBanner();

      const res = await this.authManager.signInWithPassword(email, password);

      this.loginSubmitBtn.disabled = false;
      this.loginSubmitBtn.textContent = '[ DEPLOY TO LOBBY ]';

      if (res.requiresOtp) {
        this.targetEmail = (res.email || email).toUpperCase();
        this.switchView('otp', this.targetEmail);
        this.startResendCooldown(30);
        if (res.error) {
          this.showStatusBanner(res.error, 'info');
        }
        return;
      }

      if (!res.success) {
        this.showStatusBanner(res.error || 'AUTHENTICATION FAILED.', 'error');
        return;
      }

      if (this.authManager.operator) {
        this.audio.playEliminationChime(false);
        this.callbacks.onAuthenticated(this.authManager.operator);
      }
    });

    // 2. SIGNUP FORM SUBMIT
    this.signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.audio.unlock();
      this.audio.playMechanical(1520, 0.18);

      const callsign = this.signupCallsignInp.value.trim();
      const email = this.signupEmailInp.value.trim();
      const password = this.signupPassInp.value;

      this.signupSubmitBtn.disabled = true;
      this.signupSubmitBtn.textContent = '[ DISPATCHING 6-DIGIT CODE... ]';
      this.clearStatusBanner();

      const res = await this.authManager.signUp(callsign, email, password);

      this.signupSubmitBtn.disabled = false;
      this.signupSubmitBtn.textContent = '[ SEND 6-DIGIT SECURITY CODE ]';

      if (!res.success) {
        this.showStatusBanner(res.error || 'REGISTRATION FAILED.', 'error');
        return;
      }

      this.targetEmail = (res.email || email).toUpperCase();
      this.switchView('otp', this.targetEmail);
      this.startResendCooldown(30);
      this.showStatusBanner(
        `6-DIGIT SECURITY CODE DISPATCHED TO ${this.targetEmail}.`,
        'info',
      );
    });

    // 3. 6-DIGIT OTP BOXES: Auto-advance on 0-9, Backspace move back, and full 6-digit Ctrl+V paste
    this.otpDigitInputs.forEach((inp, idx) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (inp.value === '' && idx > 0) {
            e.preventDefault();
            const prev = this.otpDigitInputs[idx - 1];
            prev.value = '';
            prev.focus();
            this.updateOtpBoxVisuals();
          } else {
            inp.value = '';
            this.updateOtpBoxVisuals();
          }
          return;
        }

        if (e.key === 'ArrowLeft' && idx > 0) {
          e.preventDefault();
          this.otpDigitInputs[idx - 1].focus();
          return;
        }

        if (e.key === 'ArrowRight' && idx < 5) {
          e.preventDefault();
          this.otpDigitInputs[idx + 1].focus();
          return;
        }
      });

      inp.addEventListener('input', () => {
        const digitsOnly = inp.value.replace(/\D/g, '');
        if (digitsOnly.length === 0) {
          inp.value = '';
          this.updateOtpBoxVisuals();
          return;
        }

        // If multiple digits were entered/auto-filled into a single box
        if (digitsOnly.length > 1) {
          this.fillOtpDigits(digitsOnly, idx);
          return;
        }

        inp.value = digitsOnly[0];
        this.audio.playMechanical(1720 + idx * 70, 0.11);
        this.updateOtpBoxVisuals();

        if (idx < 5) {
          this.otpDigitInputs[idx + 1].focus();
          this.otpDigitInputs[idx + 1].select();
        }
      });

      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
        if (pasted.length > 0) {
          this.fillOtpDigits(pasted, 0);
          this.audio.playMechanical(1850, 0.16);
        }
      });

      inp.addEventListener('focus', () => {
        inp.select();
      });
    });

    // 4. 6-DIGIT OTP VERIFY SUBMIT
    this.otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.audio.unlock();
      const code = this.getEnteredOtpCode();

      if (code.length < 6) {
        this.showStatusBanner('ENTER ALL 6 DIGITS OF YOUR SECURITY CODE.', 'error');
        return;
      }

      this.otpVerifyBtn.disabled = true;
      this.otpVerifyBtn.textContent = '[ VERIFYING CLEARANCE... ]';
      this.clearStatusBanner();

      const res = await this.authManager.verifyOtp(this.targetEmail.toLowerCase(), code);

      this.otpVerifyBtn.disabled = false;
      this.otpVerifyBtn.textContent = '[ VERIFY & UNLOCK SANDBOX ]';

      if (!res.success) {
        this.showStatusBanner(res.error || 'INVALID 6-DIGIT VERIFICATION CODE.', 'error');
        this.cardEl.classList.remove('auth-shake');
        void this.cardEl.offsetWidth;
        this.cardEl.classList.add('auth-shake');
        return;
      }

      if (this.authManager.operator) {
        this.audio.playEliminationChime(true);
        this.callbacks.onAuthenticated(this.authManager.operator);
      }
    });

    // 5. OTP Secondary Actions: RESEND CODE (30s cooldown) & CHANGE EMAIL
    this.otpResendBtn.addEventListener('click', async () => {
      if (this.resendCooldownSec > 0) return;
      this.audio.playMechanical(1500, 0.15);
      const res = await this.authManager.resendOtp(this.targetEmail.toLowerCase());
      if (res.success) {
        this.clearOtpDigits();
        this.otpDigitInputs[0]?.focus();
        this.startResendCooldown(30);
        this.showStatusBanner(`NEW 6-DIGIT CODE DISPATCHED TO ${this.targetEmail}.`, 'info');
      } else {
        this.showStatusBanner(res.error || 'FAILED TO RESEND SECURITY CODE.', 'error');
      }
    });

    this.otpChangeEmailBtn.addEventListener('click', () => {
      this.audio.playMechanical(1250, 0.14);
      this.showDevCommsIntercept(null);
      this.switchView('signup');
    });
  }

  fillOtpDigits(digits: string, startIdx = 0): void {
    const clean = digits.replace(/\D/g, '');
    for (let i = 0; i < clean.length && startIdx + i < 6; i++) {
      this.otpDigitInputs[startIdx + i].value = clean[i];
    }
    this.updateOtpBoxVisuals();
    const nextFocusIdx = Math.min(5, startIdx + clean.length);
    this.otpDigitInputs[nextFocusIdx]?.focus();
  }

  private clearOtpDigits(): void {
    for (const inp of this.otpDigitInputs) {
      inp.value = '';
    }
    this.updateOtpBoxVisuals();
  }

  private getEnteredOtpCode(): string {
    return this.otpDigitInputs.map((i) => i.value.trim()).join('');
  }

  private updateOtpBoxVisuals(): void {
    for (const inp of this.otpDigitInputs) {
      inp.classList.toggle('filled', inp.value.trim().length > 0);
    }
  }

  private startResendCooldown(seconds: number): void {
    this.resendCooldownSec = seconds;
    if (this.resendIntervalId !== null) {
      window.clearInterval(this.resendIntervalId);
    }
    this.updateResendButtonLabel();

    this.resendIntervalId = window.setInterval(() => {
      this.resendCooldownSec = Math.max(0, this.resendCooldownSec - 1);
      this.updateResendButtonLabel();
      if (this.resendCooldownSec <= 0 && this.resendIntervalId !== null) {
        window.clearInterval(this.resendIntervalId);
        this.resendIntervalId = null;
      }
    }, 1000);
  }

  private updateResendButtonLabel(): void {
    if (this.resendCooldownSec > 0) {
      this.otpResendBtn.disabled = true;
      this.otpResendBtn.textContent = `RESEND CODE (${this.resendCooldownSec}s cooldown)`;
    } else {
      this.otpResendBtn.disabled = false;
      this.otpResendBtn.textContent = 'RESEND CODE (30s cooldown)';
    }
  }

  private showStatusBanner(msg: string, kind: 'error' | 'info'): void {
    this.statusBannerEl.textContent = msg;
    this.statusBannerEl.className = `auth-status-banner ${kind}`;
    this.statusBannerEl.style.display = 'block';
  }

  private clearStatusBanner(): void {
    this.statusBannerEl.style.display = 'none';
    this.statusBannerEl.textContent = '';
  }
}
