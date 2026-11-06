import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { MAP_DEFINITIONS, MAP_ORDER, type MapId, type MapMetadata } from '../maps/MapAssets';

export interface OperatorProfile {
  id: string;
  email: string;
  callsign: string;
  verified: boolean;
  isDevMock: boolean;
}

export interface AuthActionResult {
  success: boolean;
  requiresOtp?: boolean;
  email?: string;
  callsign?: string;
  error?: string;
  devOtpCode?: string;
}

interface MockStoredOperator {
  id: string;
  email: string;
  callsign: string;
  password: string;
  verified: boolean;
  otpCode: string;
  otpDispatchedAt: number;
}

const MOCK_OPERATORS_STORAGE_KEY = 'assembly_mock_operators_v1';
export const LAST_AUTH_BG_MAP_STORAGE_KEY = 'last_auth_bg_map';

function sanitizeCallsign(raw: string, fallbackEmail?: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (cleaned.length >= 2) return cleaned.slice(0, 18);
  if (fallbackEmail) {
    const prefix = fallbackEmail.split('@')[0]?.toUpperCase().replace(/[^A-Z0-9_-]/g, '') ?? '';
    if (prefix.length >= 2) return prefix.slice(0, 18);
  }
  return 'OPERATOR-01';
}

export class AuthManager {
  readonly supabase: SupabaseClient | null = null;
  readonly isDevMockMode: boolean;

  private currentOperator: OperatorProfile | null = null;
  private pendingEmail = '';
  private pendingCallsign = '';
  private activeDevOtpCode: string | null = null;

  onAuthStateChanged: ((operator: OperatorProfile | null) => void) | null = null;
  onDevOtpIntercept: ((code: string | null, email: string) => void) | null = null;

  constructor() {
    const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
    const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

    const hasValidSupabaseConfig =
      rawUrl.length > 12 &&
      rawUrl.startsWith('http') &&
      !rawUrl.includes('your-project') &&
      !rawUrl.includes('example.supabase.co') &&
      rawKey.length > 20 &&
      !rawKey.includes('your-anon-key');

    if (hasValidSupabaseConfig) {
      try {
        this.supabase = createClient(rawUrl, rawKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: true,
          },
        });
        this.isDevMockMode = false;
      } catch {
        this.supabase = null;
        this.isDevMockMode = true;
      }
    } else {
      this.supabase = null;
      this.isDevMockMode = true;
    }
  }

  get operator(): OperatorProfile | null {
    return this.currentOperator;
  }

  get isAuthenticated(): boolean {
    return this.currentOperator !== null && this.currentOperator.verified;
  }

  get lastDevOtpCode(): string | null {
    return this.activeDevOtpCode;
  }

  get pendingVerificationEmail(): string {
    return this.pendingEmail;
  }

  /**
   * Selects a DIFFERENT map from the 4-map roster (`Killhouse Alpha`, `Black Site Khyber`,
   * `Severomorsk Dock`, `Bone Yard`) using a rotating index in `localStorage` (`last_auth_bg_map`)
   * combined with random selection so it never repeats the same background map twice in a row.
   */
  selectNextSpectatorBackgroundMap(excludeCurrentMapId?: MapId | null): MapMetadata {
    const count = MAP_ORDER.length;
    let lastIdx = -1;

    try {
      const stored = localStorage.getItem(LAST_AUTH_BG_MAP_STORAGE_KEY);
      if (stored !== null) {
        const byMapId = MAP_ORDER.indexOf(stored as MapId);
        if (byMapId !== -1) {
          lastIdx = byMapId;
        } else {
          const parsed = parseInt(stored, 10);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed < count) {
            lastIdx = parsed;
          }
        }
      }
    } catch {
      // Ignore storage access errors in restricted contexts
    }

    let nextIdx: number;
    if (lastIdx < 0) {
      // First boot: pick random initial index (excluding current map if provided)
      const validInitial = MAP_ORDER.map((id, idx) => ({ id, idx })).filter(
        (item) => item.id !== excludeCurrentMapId,
      );
      const pick = validInitial[Math.floor(Math.random() * validInitial.length)] ?? { idx: 0 };
      nextIdx = pick.idx;
    } else {
      // Rotating index step (+1, +2, or +3 mod 4) combined with random selection,
      // strictly excluding `lastIdx` and `excludeCurrentMapId`.
      const rotatedCandidates: number[] = [];
      for (let step = 1; step < count; step++) {
        const candidateIdx = (lastIdx + step) % count;
        if (MAP_ORDER[candidateIdx] !== excludeCurrentMapId) {
          rotatedCandidates.push(candidateIdx);
        }
      }
      if (rotatedCandidates.length === 0) {
        rotatedCandidates.push((lastIdx + 1) % count);
      }
      // Combine rotating order with random offset among the non-repeating candidates
      const pickIdx =
        Math.random() < 0.65
          ? rotatedCandidates[0]
          : rotatedCandidates[Math.floor(Math.random() * rotatedCandidates.length)];
      nextIdx = pickIdx;
    }

    try {
      localStorage.setItem(LAST_AUTH_BG_MAP_STORAGE_KEY, String(nextIdx));
    } catch {
      // Ignore storage write errors
    }

    const chosenId = MAP_ORDER[nextIdx] ?? 'killhouse_alpha';
    return MAP_DEFINITIONS[chosenId];
  }

  /**
   * Signup wiring:
   * Calls `supabase.auth.signUp({ email, password, options: { data: { callsign } } })`
   * and immediately transitions to the 6-Digit Email OTP Verification View.
   */
  async signUp(callsign: string, email: string, password: string): Promise<AuthActionResult> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCallsign = sanitizeCallsign(callsign, cleanEmail);

    if (callsign.trim().length < 2) {
      return { success: false, error: 'OPERATOR CALLSIGN MUST BE AT LEAST 2 CHARACTERS.' };
    }
    if (!this.isValidEmail(cleanEmail)) {
      return { success: false, error: 'ENTER A VALID TACTICAL EMAIL ADDRESS.' };
    }
    if (password.length < 6) {
      return { success: false, error: 'SECURITY PASSCODE MUST BE AT LEAST 6 CHARACTERS.' };
    }

    this.pendingEmail = cleanEmail;
    this.pendingCallsign = cleanCallsign;

    if (this.supabase && !this.isDevMockMode) {
      try {
        const { error } = await this.supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              callsign: cleanCallsign,
            },
          },
        });
        if (error) {
          return { success: false, error: error.message.toUpperCase() };
        }
        return {
          success: true,
          requiresOtp: true,
          email: cleanEmail,
          callsign: cleanCallsign,
        };
      } catch (err) {
        // Graceful fallback to dev mock mode if network/Supabase unreachable
        return this.signUpMock(cleanCallsign, cleanEmail, password);
      }
    }

    return this.signUpMock(cleanCallsign, cleanEmail, password);
  }

  /**
   * 6-Digit Email OTP Verification wiring:
   * Calls `supabase.auth.verifyOtp({ email, token: sixDigitCode, type: 'signup' })`.
   */
  async verifyOtp(email: string, sixDigitCode: string): Promise<AuthActionResult> {
    const cleanEmail = (email || this.pendingEmail).trim().toLowerCase();
    const cleanCode = sixDigitCode.trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      return { success: false, error: 'ENTER ALL 6 NUMERIC SECURITY DIGITS (0-9).' };
    }

    if (this.supabase && !this.isDevMockMode) {
      try {
        const { data, error } = await this.supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanCode,
          type: 'signup',
        });

        if (error) {
          return { success: false, error: error.message.toUpperCase() };
        }

        const profile = this.extractUserProfile(data.user, cleanEmail, this.pendingCallsign);
        this.setAuthenticatedOperator(profile);
        return {
          success: true,
          email: profile.email,
          callsign: profile.callsign,
        };
      } catch (err) {
        return this.verifyOtpMock(cleanEmail, cleanCode);
      }
    }

    return this.verifyOtpMock(cleanEmail, cleanCode);
  }

  /**
   * Login wiring:
   * Calls `supabase.auth.signInWithPassword({ email, password })`.
   * If the operator's email is unverified, triggers `supabase.auth.resend({ type: 'signup', email })`
   * and opens the 6-Digit OTP Verification View.
   */
  async signInWithPassword(email: string, password: string): Promise<AuthActionResult> {
    const cleanEmail = email.trim().toLowerCase();

    if (!this.isValidEmail(cleanEmail)) {
      return { success: false, error: 'ENTER A VALID TACTICAL EMAIL ADDRESS.' };
    }
    if (password.length < 1) {
      return { success: false, error: 'ENTER YOUR SECURITY PASSWORD.' };
    }

    this.pendingEmail = cleanEmail;

    if (this.supabase && !this.isDevMockMode) {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) {
          const msgLower = error.message.toLowerCase();
          if (
            msgLower.includes('not confirmed') ||
            msgLower.includes('unverified') ||
            msgLower.includes('confirm your email')
          ) {
            await this.supabase.auth.resend({
              type: 'signup',
              email: cleanEmail,
            });
            return {
              success: false,
              requiresOtp: true,
              email: cleanEmail,
              error: 'OPERATOR EMAIL UNVERIFIED // 6-DIGIT CODE REDISPATCHED.',
            };
          }
          return { success: false, error: error.message.toUpperCase() };
        }

        const profile = this.extractUserProfile(data.user, cleanEmail, this.pendingCallsign);
        this.setAuthenticatedOperator(profile);
        return {
          success: true,
          email: profile.email,
          callsign: profile.callsign,
        };
      } catch {
        return this.signInMock(cleanEmail, password);
      }
    }

    return this.signInMock(cleanEmail, password);
  }

  /**
   * Resends the 6-digit signup verification code (`supabase.auth.resend({ type: 'signup', email })`).
   */
  async resendOtp(email?: string): Promise<AuthActionResult> {
    const cleanEmail = (email || this.pendingEmail).trim().toLowerCase();
    if (!this.isValidEmail(cleanEmail)) {
      return { success: false, error: 'INVALID TARGET EMAIL ADDRESS.' };
    }

    if (this.supabase && !this.isDevMockMode) {
      try {
        const { error } = await this.supabase.auth.resend({
          type: 'signup',
          email: cleanEmail,
        });
        if (error) {
          return { success: false, error: error.message.toUpperCase() };
        }
        return { success: true, requiresOtp: true, email: cleanEmail };
      } catch {
        return this.resendOtpMock(cleanEmail);
      }
    }

    return this.resendOtpMock(cleanEmail);
  }

  /**
   * Logs out the current operator and returns to Spectator Attract Mode on a new map.
   */
  async signOut(): Promise<void> {
    if (this.supabase && !this.isDevMockMode) {
      try {
        await this.supabase.auth.signOut();
      } catch {
        // Ignore network errors on signOut
      }
    }
    this.currentOperator = null;
    this.activeDevOtpCode = null;
    this.onDevOtpIntercept?.(null, '');
    this.onAuthStateChanged?.(null);
  }

  // ===========================================================================
  // Local Mock Auth Mode (Graceful Dev Fallback when .env Supabase keys missing)
  // ===========================================================================

  private signUpMock(callsign: string, email: string, password: string): AuthActionResult {
    const code = this.generateSixDigitCode();
    const operators = this.loadMockOperators();
    const existingIdx = operators.findIndex((o) => o.email === email);

    const record: MockStoredOperator = {
      id: `op_${Date.now().toString(36)}`,
      email,
      callsign,
      password,
      verified: false,
      otpCode: code,
      otpDispatchedAt: Date.now(),
    };

    if (existingIdx >= 0) {
      operators[existingIdx] = record;
    } else {
      operators.push(record);
    }
    this.saveMockOperators(operators);

    this.activeDevOtpCode = code;
    this.onDevOtpIntercept?.(code, email);

    return {
      success: true,
      requiresOtp: true,
      email,
      callsign,
      devOtpCode: code,
    };
  }

  private verifyOtpMock(email: string, sixDigitCode: string): AuthActionResult {
    const operators = this.loadMockOperators();
    const record = operators.find((o) => o.email === email);

    const expectedCode = record?.otpCode ?? this.activeDevOtpCode;
    if (!expectedCode || sixDigitCode !== expectedCode) {
      return {
        success: false,
        error: 'INVALID 6-DIGIT SECURITY CODE // CHECK COMMS INTERCEPT.',
      };
    }

    const callsign = record?.callsign || sanitizeCallsign(this.pendingCallsign, email);
    if (record) {
      record.verified = true;
      this.saveMockOperators(operators);
    }

    this.activeDevOtpCode = null;
    this.onDevOtpIntercept?.(null, email);

    const profile: OperatorProfile = {
      id: record?.id ?? `op_${Date.now().toString(36)}`,
      email,
      callsign,
      verified: true,
      isDevMock: true,
    };
    this.setAuthenticatedOperator(profile);

    return {
      success: true,
      email: profile.email,
      callsign: profile.callsign,
    };
  }

  private signInMock(email: string, password: string): AuthActionResult {
    const operators = this.loadMockOperators();
    const record = operators.find((o) => o.email === email);

    if (record) {
      if (record.password !== password) {
        return {
          success: false,
          error: 'INVALID OPERATOR CREDENTIALS // ACCESS DENIED.',
        };
      }

      if (!record.verified) {
        // Trigger resend flow and open 6-digit OTP view
        const newCode = this.generateSixDigitCode();
        record.otpCode = newCode;
        record.otpDispatchedAt = Date.now();
        this.saveMockOperators(operators);

        this.pendingCallsign = record.callsign;
        this.activeDevOtpCode = newCode;
        this.onDevOtpIntercept?.(newCode, email);

        return {
          success: false,
          requiresOtp: true,
          email,
          callsign: record.callsign,
          devOtpCode: newCode,
          error: 'OPERATOR UNVERIFIED // 6-DIGIT SECURITY CODE DISPATCHED.',
        };
      }

      const profile: OperatorProfile = {
        id: record.id,
        email: record.email,
        callsign: record.callsign,
        verified: true,
        isDevMock: true,
      };
      this.activeDevOtpCode = null;
      this.onDevOtpIntercept?.(null, email);
      this.setAuthenticatedOperator(profile);

      return {
        success: true,
        email: profile.email,
        callsign: profile.callsign,
      };
    }

    // In Dev Mode, if an operator logs in directly with a new email/password,
    // authenticate immediately with a callsign derived from their email address.
    const derivedCallsign = sanitizeCallsign('', email);
    const newRecord: MockStoredOperator = {
      id: `op_${Date.now().toString(36)}`,
      email,
      callsign: derivedCallsign,
      password,
      verified: true,
      otpCode: '',
      otpDispatchedAt: Date.now(),
    };
    operators.push(newRecord);
    this.saveMockOperators(operators);

    const profile: OperatorProfile = {
      id: newRecord.id,
      email,
      callsign: derivedCallsign,
      verified: true,
      isDevMock: true,
    };
    this.activeDevOtpCode = null;
    this.onDevOtpIntercept?.(null, email);
    this.setAuthenticatedOperator(profile);

    return {
      success: true,
      email: profile.email,
      callsign: profile.callsign,
    };
  }

  private resendOtpMock(email: string): AuthActionResult {
    const code = this.generateSixDigitCode();
    const operators = this.loadMockOperators();
    const record = operators.find((o) => o.email === email);
    if (record) {
      record.otpCode = code;
      record.otpDispatchedAt = Date.now();
      this.saveMockOperators(operators);
    }
    this.activeDevOtpCode = code;
    this.onDevOtpIntercept?.(code, email);

    return {
      success: true,
      requiresOtp: true,
      email,
      devOtpCode: code,
    };
  }

  private setAuthenticatedOperator(profile: OperatorProfile): void {
    this.currentOperator = profile;
    this.onAuthStateChanged?.(profile);
  }

  private extractUserProfile(user: User | null, fallbackEmail: string, fallbackCallsign: string): OperatorProfile {
    const email = user?.email ?? fallbackEmail;
    const metaCallsign =
      (user?.user_metadata?.callsign as string | undefined) ||
      (user?.user_metadata?.username as string | undefined) ||
      fallbackCallsign;
    return {
      id: user?.id ?? `op_${Date.now().toString(36)}`,
      email,
      callsign: sanitizeCallsign(metaCallsign ?? '', email),
      verified: true,
      isDevMock: false,
    };
  }

  private generateSixDigitCode(): string {
    const n = Math.floor(100000 + Math.random() * 900000);
    return n.toString();
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private loadMockOperators(): MockStoredOperator[] {
    try {
      const raw = localStorage.getItem(MOCK_OPERATORS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveMockOperators(list: MockStoredOperator[]): void {
    try {
      localStorage.setItem(MOCK_OPERATORS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage errors
    }
  }
}
